import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  RATE_MALT_PER_SOL,
  sendMaltToBuyer,
  verifyPureSolTransferToTreasury,
} from "./solana";

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

    // 1) Verifikuj SOL uplatu
    const { payer, amountSol } = await verifyPureSolTransferToTreasury(
      txSignature,
    );

    // 2) Koliko MALT ide
    const maltAmount = amountSol * RATE_MALT_PER_SOL;

    // 3) Pošalji MALT kupcu
    const tokenSig = await sendMaltToBuyer(payer, maltAmount);

    // 4) Gotovo
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
