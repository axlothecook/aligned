// Builds and exports the Express app WITHOUT starting a server, so tests
// (supertest) can import it directly. index.ts adds app.listen().
import express, { type Express } from 'express';
import cors from 'cors';
import { CORE_VERSION } from '@aligned/core';
import { sessionMiddleware } from './auth/session';
import { authRouter } from './auth/routes';
import { profileRouter } from './profile/routes';
import { friendsRouter } from './friends/routes';
import { calendarsRouter } from './calendars/routes';
import { eventsRouter } from './events/routes';

export function createApp(): Express {
  const app = express();

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
  app.use('/', profileRouter);
  app.use('/', friendsRouter);
  app.use('/', calendarsRouter);
  app.use('/', eventsRouter);

  return app;
}
