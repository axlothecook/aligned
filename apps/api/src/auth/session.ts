// Session setup (DB-backed via connect-pg-simple) + the requireAuth guard.
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import type { RequestHandler } from 'express';

// Make TypeScript aware that our session stores a userId.
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

const PgStore = connectPgSimple(session);

export function sessionMiddleware(): RequestHandler {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) throw new Error('SESSION_SECRET is not set (see apps/api/.env.example)');

  return session({
    store: new PgStore({
      conString: process.env['DATABASE_URL'],
      tableName: 'session', // the table we created in schema.ts
      createTableIfMissing: false, // our migration owns it
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // JS can't read the cookie (XSS protection)
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production', // HTTPS-only in prod
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  });
}

// Guard for protected routes: 401 unless a user is logged in.
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
};
