import {
  Connection,
  LAMPORTS_PER_SOL,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");

export const RECEIVER_ADDRESS = new PublicKey(
  process.env.RECEIVER_ADDRESS || "",
);
export const RATE_MALT_PER_SOL = Number(
  process.env.RATE_MALT_PER_SOL || 200000,
);
export const MAX_SOL_PER_PURCHASE = Number(
  process.env.MAX_SOL_PER_PURCHASE || 100,
);

// --- TYPE GUARD ---
function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

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

  // 🔎 pronađi baš SystemProgram.transfer ka treasury-ju
  const ix = tx.transaction.message.instructions.find((i) => {
    if (!isParsedInstruction(i)) return false; // <-- uskočimo u ParsedInstruction
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

  // payer = prvi account (signer) iz poruke
  const payerKeyStr = tx.transaction.message.accountKeys[0].pubkey.toBase58();

  return { payer: new PublicKey(payerKeyStr), amountSol };
}

import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";

const MALT_MINT = new PublicKey(process.env.MALT_MINT || "");
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 9);

// Učitaj treasury keypair iz .env (JSON niz)
export function loadTreasuryKeypair(): Keypair {
  const raw = process.env.TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error("Missing TREASURY_PRIVATE_KEY");
  const arr = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(arr);
}

/**
 * Pošalji MALT (SPL) kupcu (na njegov ATA).
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

  // izračunaj u najmanjim jedinicama (decimals)
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
    Number(units), // OK je number do ~2^53; ako ti trebaju veće vrednosti, koristi spl-token 0.4+ BN varijantu
    [],
    TOKEN_PROGRAM_ID,
  );

  const tx = new (await import("@solana/web3.js")).Transaction().add(ix);
  tx.feePayer = treasury.publicKey;

  const { blockhash, lastValidBlockHeight } = await connection
    .getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  tx.sign(treasury);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });

  await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  }, "confirmed");
  return sig;
}
