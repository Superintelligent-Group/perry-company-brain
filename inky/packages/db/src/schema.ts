/**
 * Inky's multi-tenant schema (Phase 6, design: docs/planning/phase6-design.md).
 *
 * A self-hosted Inky loads one `Config` from a file. The hosted tier loads the
 * SAME `Config` per tenant, assembled from these rows — so the core pipeline runs
 * unchanged. The decomposition follows the Config shape:
 *   Config.org      → tenants.githubLogin
 *   Config.github   → installations (appId, installationId)
 *   Config.discord  → channels (webhook / bot identity)
 *   everything else → configs.settings (a JSONB blob, validated by ConfigSchema
 *                     on read — see config-store.ts)
 * Secrets (App private key, LLM keys, bot token) are NEVER stored per-tenant here;
 * they remain Inky's own env. The one sensitive column is the webhook URL, which is
 * encrypted at rest by the app layer before it reaches `channels.discordWebhookUrl`.
 */
import { bigint, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Config } from '@inky/core/config';

/** The portion of a `Config` stored as the JSONB settings blob: everything that
 *  isn't the tenant (org), the installation (github), or the channel (discord). */
export type ConfigSettings = Omit<Config, 'org' | 'github' | 'discord'>;

/** One customer org. `githubLogin` is the org slug — the Config.org value. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubLogin: text('github_login').notNull().unique(),
  name: text('name'),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The tenant's GitHub App installation. `githubAppId` is TEXT (Config.github.appId
 * is a string — avoids JSON int-precision loss; review N2). The installation id is
 * BIGINT (numeric, but can exceed int4), read back as a JS number — GitHub ids are
 * well within Number.MAX_SAFE_INTEGER.
 */
export const installations = pgTable('installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // One App installation per tenant (unique) — also the upsert conflict target.
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  githubAppId: text('github_app_id').notNull(),
  githubInstallationId: bigint('github_installation_id', { mode: 'number' }).notNull(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
});

/** Where a tenant's standup is delivered. Webhook-only at first (design); the bot
 *  fields carry the (non-secret) Discord application/guild/channel ids. */
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['webhook', 'bot'] })
    .notNull()
    .default('webhook'),
  /** Sensitive — encrypted at rest by the app layer before storage. */
  discordWebhookUrl: text('discord_webhook_url'),
  applicationId: text('application_id'),
  guildId: text('guild_id'),
  channelId: text('channel_id'),
});

/** The tunable settings (a serialized Config minus org/github/discord), validated
 *  by ConfigSchema on read. JSONB so it evolves with Config without a migration. */
export const configs = pgTable('configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // One settings row per tenant (unique) — also the upsert conflict target.
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').$type<ConfigSettings>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-run history — powers the dashboard's run log, LLM-cost metering, and the
 *  stored-history charts (the >1-window sparklines the in-Discord one can't do). */
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  jobLabel: text('job_label'),
  windowSince: timestamp('window_since', { withTimezone: true }).notNull(),
  windowUntil: timestamp('window_until', { withTimezone: true }).notNull(),
  status: text('status', { enum: ['ok', 'empty', 'error'] }).notNull(),
  postedMessageCount: integer('posted_message_count').notNull().default(0),
  llmTokens: integer('llm_tokens'),
  empty: boolean('empty').notNull().default(false),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Stripe linkage + the tier/cap the plan enforces (flat per-org w/ contributor cap). */
export const billing = pgTable('billing', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  tier: text('tier'),
  status: text('status'),
  contributorCap: integer('contributor_cap'),
});
