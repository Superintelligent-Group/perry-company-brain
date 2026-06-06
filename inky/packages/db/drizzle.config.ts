import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` (schema → SQL migrations, offline) and `drizzle-kit
// migrate` (apply to DATABASE_URL). The committed migrations in ./drizzle are the
// source of truth and are applied in tests via the pglite migrator.
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
