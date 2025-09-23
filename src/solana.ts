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
