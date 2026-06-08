// drizzle-kit config — tells the CLI where the schema lives, where to write
// migration SQL, and how to reach the database.
//   pnpm db:generate  → reads src/db/schema.ts, writes SQL into src/db/migrations
//   pnpm db:migrate   → applies those migrations to the DB at DATABASE_URL
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
