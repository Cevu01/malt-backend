import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  RATE_MALT_PER_SOL,
  sendMaltToBuyer,
  verifyPureSolTransferToTreasury,
} from "./solana";

const app = express();

// CORS + JSON
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "malt-backend", ts: Date.now() });
});

// (Privremeno) test endpoint da potvrdimo POST rute
app.post("/api/purchase-test", (req, res) => {
  return res.status(200).json({ ok: true, got: req.body ?? null });
});

// >>>>>> P R O D  ruta — preorder ispred listen
app.post("/api/purchase", async (req, res) => {
  try {
    const { txSignature } = req.body;
    if (!txSignature) {
      return res.status(400).json({
        ok: false,
        error: "txSignature is required",
      });
    }

    const { payer, amountSol } = await verifyPureSolTransferToTreasury(
      txSignature,
    );
    const maltAmount = amountSol * RATE_MALT_PER_SOL;
    const tokenSig = await sendMaltToBuyer(payer, maltAmount);

    return res.json({
      ok: true,
      payer: payer.toBase58(),
      amountSol,
      maltAmount,
      tokenTx: tokenSig,
      msg: "Payment verified and MALT sent.",
    });
  } catch (e: any) {
    console.error("purchase error:", e?.message || e);
    return res.status(400).json({ ok: false, error: e?.message || "Failed" });
  }
});

// Listen NA KRAJU
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ MALT backend listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
