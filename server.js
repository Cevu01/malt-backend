const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'malt-backend', ts: Date.now() });
});

app.listen(PORT, () => {
  console.log(`✅ Test backend listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
