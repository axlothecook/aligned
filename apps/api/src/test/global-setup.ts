// Runs ONCE before the whole integration test suite:
//   1. ensure a separate `aligned_test` database exists (so tests never touch dev data)
//   2. run all Drizzle migrations against it
// TEST_DATABASE_URL points the app + Drizzle at the test DB during integration runs.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://aligned:aligned_dev_pw@localhost:5433/aligned';
const TEST_DB = 'aligned_test';
const TEST_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

export default async function setup() {
  // Create the test database if it doesn't exist (connect to the default DB first).
  const admin = postgres(ADMIN_URL, { max: 1 });
  const exists =
    await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
  if (exists.length === 0) {
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  }
  await admin.end();

  // Run migrations against the test DB.
  const client = postgres(TEST_URL, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: 'src/db/migrations' });
  await client.end();

  // Make the URL available to the app/client during the test run.
  process.env['TEST_DATABASE_URL'] = TEST_URL;
}
