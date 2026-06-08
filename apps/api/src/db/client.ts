// The database client the app uses to run queries.
// `db` is a Drizzle instance wrapping the `postgres` driver, wired to our schema
// so queries are fully typed against the tables in schema.ts.
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (see apps/api/.env.example)');
}

// One shared connection pool for the app.
const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
