// Aligned API — entry point. Express server.
// Step 2 scaffold: a single health-check route to prove the server runs.
// Real routes (auth, friends, calendars, events, the free-slot merge) come in
// the feature-build phase (Phase 1 step 4).
import express from 'express';
import { CORE_VERSION } from '@aligned/core';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'aligned-api', core: CORE_VERSION });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`aligned-api listening on http://localhost:${PORT}`);
});
