/**
 * The Config↔DB seam. The hosted worker builds a core `Config` from tenant rows;
 * the dashboard writes a `Config` back to rows. Both go through these PURE
 * functions, validated by the SAME `ConfigSchema` the file loader uses — so a
 * DB-sourced config is byte-for-byte a file-sourced one, and the core pipeline
 * can't tell the difference. No DB handle here on purpose: this is unit-tested
 * without Postgres (the live store/queries are a separate, thin layer).
 */
import { ConfigSchema, type Config } from '@inky/core/config';
import type { ConfigSettings } from './schema.js';

/**
 * A `Config` split into its storage homes (see schema.ts): the org (tenant), the
 * GitHub App identity (installation), the Discord target (channel), and the
 * tunable settings (configs.settings). The caller maps these to/from actual rows.
 */
export interface ConfigParts {
  /** tenants.githubLogin */
  org: Config['org'];
  /** installations: { appId?, installationId? } */
  github: Config['github'];
  /** channels: { webhookUrl?, channelId?, applicationId?, guildId? } */
  discord: Config['discord'];
  /** configs.settings — everything else. */
  settings: ConfigSettings;
}

/** Split a validated `Config` into its storage parts (lossless — every field lands
 *  in exactly one part). The inverse of {@link assembleConfig}. */
export function disassembleConfig(config: Config): ConfigParts {
  const { org, github, discord, ...settings } = config;
  return { org, github, discord, settings };
}

/**
 * Rebuild a `Config` from its storage parts and validate it through `ConfigSchema`
 * — so a malformed/stale row is caught here with the same readable errors as a bad
 * config file, and any schema defaults are applied identically. The inverse of
 * {@link disassembleConfig}.
 */
export function assembleConfig(parts: ConfigParts): Config {
  return ConfigSchema.parse({
    org: parts.org,
    github: parts.github,
    discord: parts.discord,
    ...parts.settings,
  });
}
