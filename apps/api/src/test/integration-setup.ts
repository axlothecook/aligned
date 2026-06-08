// Runs before EACH integration test file. Provides test env defaults and wipes
// the test DB tables before every test so tests are isolated and order-independent.
import { beforeEach } from 'vitest';

// Test secrets (the app requires these). Set before any app code imports them.
process.env['SESSION_SECRET'] ??= 'test_session_secret';
process.env['JWT_SECRET'] ??= 'test_jwt_secret';
process.env['WEB_BASE_URL'] ??= 'http://localhost:3000';
// BREVO_API_KEY intentionally unset → emails log to console (no real send in tests).

// Import the client AFTER env is set so it connects to the test DB.
const { db } = await import('../db/client');
const { sql } = await import('drizzle-orm');

beforeEach(async () => {
  // Wipe all app tables (RESTART IDENTITY + CASCADE). `session` is wiped too so
  // login state never leaks between tests.
  await db.execute(
    sql`TRUNCATE TABLE messages, calendar_shares, events, calendars, blocks, friendships, users, session RESTART IDENTITY CASCADE`,
  );
});
