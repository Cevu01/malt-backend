import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// === RPC (isti kao do sada) ===
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");

// === Config ===
export const RECEIVER_ADDRESS = new PublicKey(
  process.env.RECEIVER_ADDRESS || "",
);
export const RATE_MALT_PER_SOL = Number(
  process.env.RATE_MALT_PER_SOL || 200000,
);
export const MAX_SOL_PER_PURCHASE = Number(
  process.env.MAX_SOL_PER_PURCHASE || 100,
);

// === MALT mint i decimali (za slanje MALT-a kupcu) ===
const MALT_MINT = new PublicKey(process.env.MALT_MINT || "");
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 9);

// --- TYPE GUARD (ostaje isto) ---
function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

// === Treasury keypair (ostaje isto) ===
export function loadTreasuryKeypair(): Keypair {
  const raw = process.env.TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error("Missing TREASURY_PRIVATE_KEY");
  const arr = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(arr);
}

/**
 * (opciono ali bezbedno) — obezbedi da treasury ima ATA za dati mint.
 * Owner je RECEIVER_ADDRESS (treasury wallet).
 */
export async function ensureTreasuryAtaForMint(
  mint: PublicKey,
): Promise<string> {
  const treasury = loadTreasuryKeypair();
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury, // payer za rent
    mint, // USDC/USDT mint
    RECEIVER_ADDRESS, // owner = treasury wallet
  );
  return ata.address.toBase58();
}

/**
 * Verifikacija SOL uplate ka treasury (NE DIRAMO TVOJ LOGIKU)
 */
export async function verifyPureSolTransferToTreasury(
  txSignature: string,
): Promise<{ payer: PublicKey; amountSol: number }> {
  const tx = await connection.getParsedTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) throw new Error("Transaction not found");
  if (tx.meta?.err) throw new Error("Transaction failed on-chain");

  const conf = await connection.getSignatureStatus(txSignature, {
    searchTransactionHistory: true,
  });
  const status = conf?.value?.confirmationStatus;
  if (status !== "confirmed" && status !== "finalized") {
    throw new Error(`Transaction not confirmed (status=${status})`);
  }

  // bas SystemProgram.transfer ka treasury
  const ix = tx.transaction.message.instructions.find((i) => {
    if (!isParsedInstruction(i)) return false;
    return (
      i.program === "system" &&
      i.parsed?.type === "transfer" &&
      i.parsed?.info?.destination === RECEIVER_ADDRESS.toBase58()
    );
  });

  if (!ix || !isParsedInstruction(ix)) {
    throw new Error("No valid SystemProgram.transfer to treasury found");
  }

  const lamports = Number(ix.parsed.info.lamports);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error("Invalid lamports amount");
  }

  const amountSol = lamports / LAMPORTS_PER_SOL;
  if (amountSol > MAX_SOL_PER_PURCHASE) {
    throw new Error(`Amount exceeds max cap (${MAX_SOL_PER_PURCHASE} SOL)`);
  }

  // payer = prvi potpisnik iz poruke
  const payerKeyStr = tx.transaction.message.accountKeys[0].pubkey.toBase58();

  return { payer: new PublicKey(payerKeyStr), amountSol };
}

/**
 * Verifikacija SPL uplate (USDC/USDT) ka treasury ATA
 * - koristi isti commitment ("confirmed") da isprati tvoj SOL flow
 */
export async function verifySplTokenTransferToTreasury(
  txSignature: string,
  expectedMint: PublicKey,
): Promise<{ payer: PublicKey; amountTokens: number; decimals: number }> {
  const tx = await connection.getParsedTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) throw new Error("Transaction not found");
  if (tx.meta?.err) throw new Error("Transaction failed on-chain");

  const st = await connection.getSignatureStatus(txSignature, {
    searchTransactionHistory: true,
  });
  const conf = st?.value?.confirmationStatus;
  if (conf !== "confirmed" && conf !== "finalized") {
    throw new Error(`Transaction not confirmed (status=${conf})`);
  }

  // očekivani treasury ATA za dati mint
  const expectedTreasuryAta = getAssociatedTokenAddressSync(
    expectedMint,
    RECEIVER_ADDRESS,
    false,
  );

  // nadji SPL transfer(Checked) ka baš tom ATA, i (ako postoji u parsed) proveri mint
  const ix = tx.transaction.message.instructions.find((i) => {
    // očekujemo ParsedInstruction
    // @ts-ignore
    if (!("parsed" in i)) return false;
    // @ts-ignore
    const programId = i.programId?.toBase58?.();
    if (programId !== TOKEN_PROGRAM_ID.toBase58()) return false;

    // @ts-ignore
    const parsed: any = i.parsed;
    const t = parsed?.type;
    const info = parsed?.info;

    if (t === "transfer" || t === "transferChecked") {
      const dest = info?.destination;
      const mint = info?.mint;
      if (mint && mint !== expectedMint.toBase58()) return false;
      return dest === expectedTreasuryAta.toBase58();
    }
    return false;
  });
  // @ts-ignore
  if (!ix || !("parsed" in ix)) {
    throw new Error("No valid SPL token transfer to treasury ATA found");
  }

  // izračunaj amount + decimals (iz tokenAmount ako postoji, ili iz postTokenBalances)
  // @ts-ignore
  const info: any = ix.parsed?.info;
  let amountInSmallest = 0n;
  let decimals = 0;

  if (
    info?.tokenAmount?.amount && typeof info?.tokenAmount?.decimals === "number"
  ) {
    amountInSmallest = BigInt(info.tokenAmount.amount);
    decimals = info.tokenAmount.decimals;
    if (info?.mint && info.mint !== expectedMint.toBase58()) {
      throw new Error("Mint mismatch");
    }
  } else {
    const post = tx.meta?.postTokenBalances || [];
    const match = post.find(
      (b) =>
        b.owner === RECEIVER_ADDRESS.toBase58() &&
        b.mint === expectedMint.toBase58() &&
        b.uiTokenAmount?.decimals != null,
    );
    if (!match) throw new Error("Cannot resolve token decimals for transfer");
    decimals = match.uiTokenAmount.decimals;

    const amt = info?.amount;
    if (!amt) throw new Error("Missing amount in SPL transfer");
    amountInSmallest = BigInt(String(amt));
  }
  if (amountInSmallest <= 0n) throw new Error("Invalid SPL amount");

  const amountTokens = Number(amountInSmallest) / Math.pow(10, decimals);

  // payer = prvi potpisnik iz poruke
  const payerKeyStr = tx.transaction.message.accountKeys[0].pubkey.toBase58();
  return { payer: new PublicKey(payerKeyStr), amountTokens, decimals };
}

/**
 * Pošalji MALT (SPL) kupcu (ostaje ista logika)
 * - kreira ATA ako ne postoji
 * - amount je u MALT (ne u smallest units)
 * - vraća signature
 */
export async function sendMaltToBuyer(
  buyerPubkey: PublicKey,
  maltAmount: number,
): Promise<string> {
  if (!Number.isFinite(maltAmount) || maltAmount <= 0) {
    throw new Error("Invalid malt amount");
  }

  const treasury = loadTreasuryKeypair();

  // izračun u najmanjim jedinicama
  const units = BigInt(Math.floor(maltAmount * 10 ** TOKEN_DECIMALS));

  // treasury ATA (source)
  const sourceAta = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    MALT_MINT,
    treasury.publicKey,
  );

  // buyer ATA (destination)
  const destAta = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury, // payer za kreaciju ATA
    MALT_MINT,
    buyerPubkey,
  );

  // transfer instrukcija
  const ix = createTransferInstruction(
    sourceAta.address,
    destAta.address,
    treasury.publicKey,
    Number(units),
    [],
    TOKEN_PROGRAM_ID,
  );

  const { Transaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(ix);
  tx.feePayer = treasury.publicKey;

  const { blockhash, lastValidBlockHeight } = await connection
    .getLatestBlockhash(
      "confirmed",
    );
  tx.recentBlockhash = blockhash;

  tx.sign(treasury);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });

  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}
