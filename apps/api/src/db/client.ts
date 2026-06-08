// The database client the app uses to run queries.
// `db` is a Drizzle instance wrapping the `postgres` driver, wired to our schema
// so queries are fully typed against the tables in schema.ts.
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Integration tests set TEST_DATABASE_URL to point at a separate test DB; prefer
// it so the same app code runs against the test database during those runs.
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (see apps/api/.env.example)');
}

// One shared connection pool for the app.
const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
