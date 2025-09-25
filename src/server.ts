import "dotenv/config";
import express from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";

import {
  ensureTreasuryAtaForMint,
  RATE_MALT_PER_SOL,
  sendMaltToBuyer,
  verifyPureSolTransferToTreasury,
  verifySplTokenTransferToTreasury,
} from "./solana";

const app = express();

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// --- Health ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "malt-backend", ts: Date.now() });
});

// (opciono) test rute dok završavamo integraciju
app.get(
  "/api/purchase-test",
  (_req, res) => res.json({ ok: true, via: "GET" }),
);
app.post(
  "/api/purchase-test",
  (req, res) => res.status(200).json({ ok: true, got: req.body ?? null }),
);

// ---------- SOL kupovina (postojeći flow, ne diramo) ----------
app.post("/api/purchase", async (req, res) => {
  try {
    const { txSignature } = req.body as { txSignature?: string };

    if (!txSignature) {
      return res.status(400).json({
        ok: false,
        error: "txSignature is required",
      });
    }

    // 1) Verifikuj SOL transfer ka treasury
    const { payer, amountSol } = await verifyPureSolTransferToTreasury(
      txSignature,
    );

    // 2) Izračunaj MALT
    const maltAmount = amountSol * RATE_MALT_PER_SOL;

    // 3) Pošalji MALT kupcu
    const tokenSig = await sendMaltToBuyer(payer, maltAmount);

    // 4) Odgovor
    return res.json({
      ok: true,
      payer: payer.toBase58(),
      amountSol,
      maltAmount,
      tokenTx: tokenSig,
      msg: "Payment verified and MALT sent.",
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed" });
  }
});

// ---------- USDC/USDT kupovina (novi endpoint) ----------

// Mint-ovi (MAINNET vrednosti u .env)
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const USDT_MINT = new PublicKey(process.env.USDT_MINT!);

// (opciono) obezbedi da treasury ima ATA za USDC/USDT na startu
(async () => {
  try {
    await ensureTreasuryAtaForMint(USDC_MINT);
    await ensureTreasuryAtaForMint(USDT_MINT);
  } catch (e) {
    console.error("Startup init failed:", (e as Error).message);
  }
})();

const RATE_MALT_PER_USDC = Number(process.env.RATE_MALT_PER_USDC || 200000);
const RATE_MALT_PER_USDT = Number(process.env.RATE_MALT_PER_USDT || 200000);

app.post("/api/purchase-token", async (req, res) => {
  try {
    const { txSignature, mintSymbol } = req.body as {
      txSignature?: string;
      mintSymbol?: "USDC" | "USDT";
    };

    if (!txSignature) {
      return res.status(400).json({
        ok: false,
        error: "txSignature is required",
      });
    }
    if (!mintSymbol || (mintSymbol !== "USDC" && mintSymbol !== "USDT")) {
      return res.status(400).json({
        ok: false,
        error: "mintSymbol must be USDC or USDT",
      });
    }

    const expectedMint = mintSymbol === "USDC" ? USDC_MINT : USDT_MINT;
    const ratePerToken = mintSymbol === "USDC"
      ? RATE_MALT_PER_USDC
      : RATE_MALT_PER_USDT;

    // 1) Verifikuj SPL transfer ka treasury ATA
    const { payer, amountTokens, decimals } =
      await verifySplTokenTransferToTreasury(txSignature, expectedMint);

    // 2) Izračunaj MALT
    const maltAmount = amountTokens * ratePerToken;

    // 3) Pošalji MALT kupcu
    const tokenSig = await sendMaltToBuyer(payer, maltAmount);

    // 4) Odgovor
    return res.json({
      ok: true,
      payer: payer.toBase58(),
      mint: expectedMint.toBase58(),
      amountTokens,
      decimals,
      maltAmount,
      tokenTx: tokenSig,
      msg: "Token payment verified and MALT sent.",
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed" });
  }
});

// --- Start server ---
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`malt-backend listening on http://localhost:${PORT}`);
});
