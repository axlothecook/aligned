// Aligned API — entry point. Express server.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { CORE_VERSION } from '@aligned/core';
import { sessionMiddleware } from './auth/session';
import { authRouter } from './auth/routes';

const app = express();

// Allow the web app to call the API with cookies.
app.use(
  cors({
    origin: process.env['WEB_BASE_URL'] ?? 'http://localhost:3000',
    credentials: true,
  }),
);
app.use(express.json());
app.use(sessionMiddleware());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'aligned-api', core: CORE_VERSION });
});

app.use('/auth', authRouter);

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`aligned-api listening on http://localhost:${PORT}`);
});
