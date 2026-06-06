/**
 * Row ↔ Config adapters: the worker reads a tenant's full `Config` from its rows
 * each run; the dashboard writes one back. The pure split/merge lives in
 * config-store.ts; this layer just moves it to/from Postgres and (de)crypts the
 * one sensitive column (the webhook URL). Typed against drizzle's base
 * `PgDatabase` so the same code runs on node-postgres (prod) and pglite (tests).
 */
import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { type Config } from '@inky/core/config';
import { channels, configs, installations, tenants } from './schema.js';
import { assembleConfig, disassembleConfig } from './config-store.js';
import { decryptSecret, encryptSecret } from './crypto.js';

/** Any drizzle Postgres database over our schema (node-postgres or pglite). */
type AnyDb = PgDatabase<any, any, any>;

/**
 * Build a tenant's `Config` from its rows, or null if no tenant matches the org.
 * Throws if a tenant exists but is missing its installation/config row — that's a
 * half-provisioned tenant (a bug), not an empty result. The webhook URL is
 * decrypted on the way out. Reconstructs github/discord with only the keys that
 * have values, so the result equals a freshly file-parsed Config.
 */
export async function loadTenantConfigByOrg(
  db: AnyDb,
  org: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.githubLogin, org)).limit(1);
  if (!tenant) return null;

  const [inst] = await db.select().from(installations).where(eq(installations.tenantId, tenant.id)).limit(1);
  const [cfg] = await db.select().from(configs).where(eq(configs.tenantId, tenant.id)).limit(1);
  const [chan] = await db.select().from(channels).where(eq(channels.tenantId, tenant.id)).limit(1);
  if (!inst || !cfg) {
    throw new Error(`tenant "${org}" is missing its installation and/or config row — half-provisioned.`);
  }

  const discord: Config['discord'] = {};
  if (chan) {
    if (chan.discordWebhookUrl) discord.webhookUrl = decryptSecret(chan.discordWebhookUrl, env);
    if (chan.applicationId) discord.applicationId = chan.applicationId;
    if (chan.guildId) discord.guildId = chan.guildId;
    if (chan.channelId) discord.channelId = chan.channelId;
  }

  return assembleConfig({
    org: tenant.githubLogin,
    github: { appId: inst.githubAppId, installationId: inst.githubInstallationId },
    discord,
    settings: cfg.settings,
  });
}

/**
 * Provision (or update) a tenant from a full `Config`. Idempotent: tenant keyed on
 * the org, installation + config upserted per tenant, channels replaced (one
 * primary channel written from `config.discord`; the table stays many-per-tenant
 * for the future multi-channel feature). The webhook URL is encrypted before
 * storage. Returns the tenant id. Hosted tenants authenticate as a GitHub App, so
 * `github.appId` + `github.installationId` are required.
 */
export async function upsertTenantConfig(
  db: AnyDb,
  config: Config,
  opts: { name?: string; channelKind?: 'webhook' | 'bot' } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const parts = disassembleConfig(config);
  if (!parts.github.appId || parts.github.installationId === undefined) {
    throw new Error('a hosted tenant config requires github.appId and github.installationId (GitHub App auth).');
  }
  const appId = parts.github.appId;
  const installationId = parts.github.installationId;

  const [tenant] = await db
    .insert(tenants)
    .values({ githubLogin: parts.org, name: opts.name ?? null })
    .onConflictDoUpdate({ target: tenants.githubLogin, set: { name: opts.name ?? null } })
    .returning();
  if (!tenant) throw new Error('failed to upsert tenant row.');
  const tenantId = tenant.id;

  await db
    .insert(installations)
    .values({ tenantId, githubAppId: appId, githubInstallationId: installationId })
    .onConflictDoUpdate({
      target: installations.tenantId,
      set: { githubAppId: appId, githubInstallationId: installationId, suspendedAt: null },
    });

  // Replace the tenant's channels with the one described by config.discord.
  await db.delete(channels).where(eq(channels.tenantId, tenantId));
  const { webhookUrl, applicationId, guildId, channelId } = parts.discord;
  if (webhookUrl || applicationId || guildId || channelId) {
    await db.insert(channels).values({
      tenantId,
      kind: opts.channelKind ?? 'webhook',
      discordWebhookUrl: webhookUrl ? encryptSecret(webhookUrl, env) : null,
      applicationId: applicationId ?? null,
      guildId: guildId ?? null,
      channelId: channelId ?? null,
    });
  }

  await db
    .insert(configs)
    .values({ tenantId, settings: parts.settings })
    .onConflictDoUpdate({ target: configs.tenantId, set: { settings: parts.settings, updatedAt: new Date() } });

  return tenantId;
}
