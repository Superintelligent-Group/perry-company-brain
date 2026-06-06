import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { ConfigSchema } from '@inky/core/config';
import * as schema from './schema.js';
import { loadTenantConfigByOrg, upsertTenantConfig } from './tenant-config.js';

// Hermetic integration tests: an in-process Postgres (pglite, real PG engine in
// WASM) with the committed migration applied. Proves the schema + row adapters +
// migration end-to-end, no external database. A fixed key, injected (no globals).
const ENV = { INKY_DB_ENCRYPTION_KEY: 'c'.repeat(64) } as NodeJS.ProcessEnv;
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

async function freshDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

test('a full Config written to the DB loads back identical (rows ↔ Config)', async () => {
  const db = await freshDb();
  const config = ConfigSchema.parse({
    org: 'your-org',
    repos: ['api', 'web'],
    windowHours: 168,
    excludePeople: ['alice'],
    aliases: { bob: ['bob-work'] },
    github: { appId: '123456', installationId: 78901234 },
    discord: {
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
      applicationId: '999',
      guildId: '888',
      channelId: '777',
    },
    schedule: { timezone: 'America/Los_Angeles', jobs: [{ cron: '0 9 * * 1-5', label: 'daily' }] },
    roadmap: { enabled: true, source: 'roadmap-md', path: 'docs/ROADMAP.md', repo: 'web' },
  });
  await upsertTenantConfig(db, config, { name: 'Your Org' }, ENV);
  const loaded = await loadTenantConfigByOrg(db, 'your-org', ENV);
  assert.deepEqual(loaded, config);
});

test('the webhook URL is encrypted at rest, never stored plaintext', async () => {
  const db = await freshDb();
  const config = ConfigSchema.parse({
    org: 'o',
    github: { appId: '1', installationId: 2 },
    discord: { webhookUrl: 'https://secret.example/hook' },
  });
  await upsertTenantConfig(db, config, {}, ENV);
  const [row] = await db.select().from(schema.channels);
  assert.ok(row);
  assert.ok(!String(row.discordWebhookUrl).includes('secret.example'));
  // ...but it decrypts back through the loader.
  const loaded = await loadTenantConfigByOrg(db, 'o', ENV);
  assert.equal(loaded?.discord.webhookUrl, 'https://secret.example/hook');
});

test('upsert is idempotent — re-writing updates in place (one tenant, latest settings)', async () => {
  const db = await freshDb();
  const base = { org: 'o', github: { appId: '1', installationId: 2 } };
  await upsertTenantConfig(db, ConfigSchema.parse({ ...base, windowHours: 24 }), {}, ENV);
  await upsertTenantConfig(db, ConfigSchema.parse({ ...base, windowHours: 168 }), {}, ENV);
  const loaded = await loadTenantConfigByOrg(db, 'o', ENV);
  assert.equal(loaded?.windowHours, 168);
  assert.equal((await db.select().from(schema.tenants)).length, 1);
  assert.equal((await db.select().from(schema.installations)).length, 1);
  assert.equal((await db.select().from(schema.configs)).length, 1);
});

test('loadTenantConfigByOrg returns null for an unknown org', async () => {
  const db = await freshDb();
  assert.equal(await loadTenantConfigByOrg(db, 'nobody', ENV), null);
});

test('upsert rejects a config without GitHub App credentials (hosted = App auth)', async () => {
  const db = await freshDb();
  const noApp = ConfigSchema.parse({ org: 'o', discord: { webhookUrl: 'https://discord.com/api/webhooks/1/x' } });
  await assert.rejects(() => upsertTenantConfig(db, noApp, {}, ENV), /GitHub App auth/);
});
