import "dotenv/config";
import express from "express";
import cors from "cors";
import { RATE_MALT_PER_SOL, verifyPureSolTransferToTreasury } from "./solana";

const app = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "malt-backend", ts: Date.now() });
});

// TODO: ovde ćemo dodati POST /api/purchase i ostalo

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ MALT backend listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});

app.post("/api/purchase", async (req, res) => {
  try {
    const { txSignature } = req.body as { txSignature?: string };
    if (!txSignature) {
      return res.status(400).json({
        ok: false,
        error: "txSignature is required",
      });
    }

    // 1) Verifikuj SOL transfer
    const { payer, amountSol } = await verifyPureSolTransferToTreasury(
      txSignature,
    );

    // 2) Izračunaj koliko MALT ide (još ne šaljemo)
    const maltAmount = amountSol * RATE_MALT_PER_SOL;

    // TODO (korak 3): slanje MALT-a kupcu pa vrati i tokenTxSignature
    return res.json({
      ok: true,
      payer: payer.toBase58(),
      amountSol,
      maltAmount,
      msg: "Payment verified. Token transfer will be implemented in next step.",
    });
  } catch (e: any) {
    console.error("purchase error:", e?.message || e);
    return res.status(400).json({
      ok: false,
      error: e?.message || "Verification failed",
    });
  }
});
