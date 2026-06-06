/**
 * Config-as-data. The same core pipeline runs self-hosted or multi-tenant by
 * loading one config object: which org/repos to read, where to post, the alias
 * map, and tuning. Secrets come from the environment, never the config file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

/** Maps a canonical GitHub login -> alias logins/emails to collapse into it. */
export const AliasMapSchema = z.record(z.string(), z.array(z.string()));
export type AliasMap = z.infer<typeof AliasMapSchema>;

/** One scheduled post: a cron expression + the window it should cover. */
export const ScheduleJobSchema = z.object({
  /** Standard 5-field cron expression (in the schedule's timezone). */
  cron: z.string(),
  /** Window length in hours for this post. Omit to use the top-level windowHours. */
  windowHours: z.number().int().positive().optional(),
  /** Optional label for logs, e.g. "daily" / "weekly". */
  label: z.string().optional(),
});
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>;

export const ConfigSchema = z.object({
  /** GitHub org/owner to read activity from. */
  org: z.string().min(1),
  /**
   * GitHub App auth (optional). Set this to authenticate as a GitHub App
   * installation instead of a personal access token — fine-grained per-org
   * permissions, higher rate limits, no PAT expiry, clean revoke. The App's
   * private key is a SECRET and lives in env (GITHUB_APP_PRIVATE_KEY or
   * GITHUB_APP_PRIVATE_KEY_PATH), never here. With both an App and a PAT
   * configured, the App wins. See docs/github-app-setup.md.
   */
  github: z
    .object({
      /** GitHub App id (a number, but kept as a string). When set, takes precedence over the GITHUB_APP_ID env var. */
      appId: z.string().optional(),
      /**
       * The App's installation id on your org. Optional — when omitted it's
       * looked up from the org on first use (and logged so you can pin it here
       * to skip the lookup).
       */
      installationId: z.number().int().positive().optional(),
    })
    .default({}),
  /**
   * Repos to include. Empty = all repos in the org the token can see.
   * Names are repo-only (no owner prefix); the org is applied.
   */
  repos: z.array(z.string()).default([]),
  /**
   * When auto-discovering all org repos (`repos: []`), skip repos with no recent
   * push so long-dead repos aren't queried. Ignored when `repos` is an explicit list.
   *   - "auto" (recommended): skip a repo with no push since THIS run's window
   *     started — so the daily skips >24h-quiet repos and the weekly skips >7d-quiet,
   *     each correct by construction. No number to tune.
   *   - a number N: fixed threshold — skip repos with no push in N days. Must be
   *     ≥ your longest scheduled window (the filter is per-run but uses a fixed N).
   *   - 0 (default): scan every repo.
   * Based on last *push*, so a repo with only issue/review activity (no commits)
   * in the window is skipped too.
   */
  staleDays: z.union([z.number().int().nonnegative(), z.literal('auto')]).default(0),
  /** Standup window length in hours (default 24). */
  windowHours: z.number().int().positive().default(24),
  /** Exclude bot accounts (logins ending in `[bot]`) from the standup. */
  excludeBots: z.boolean().default(true),
  /**
   * Per-person opt-out (privacy). Canonical GitHub logins to omit entirely from
   * the standup — case-insensitive. An excluded person never appears by name and
   * their activity isn't counted in the team stats, so it's a clean "don't report
   * me." Use the canonical login (the one Inky shows), not an alias.
   */
  excludePeople: z.array(z.string()).default([]),
  /**
   * Extra glob patterns to exclude from LOC counts, on top of the built-in
   * defaults (lockfiles, generated code, venvs, build dirs, caches). Use for
   * repo-specific generated paths, e.g. "**\/*.snapshot" or "db/seed/**".
   */
  extraNoisePatterns: z.array(z.string()).default([]),
  /** Canonical-login -> [alias logins/emails], to merge split identities. */
  aliases: AliasMapSchema.default({}),
  /**
   * Where the standup is posted, and the bot identity for the `/standup` slash
   * command. The webhook URL is sensitive (anyone holding it can post to your
   * channel), so prefer the DISCORD_WEBHOOK_URL env var — env wins over this.
   * The bot TOKEN is also a secret and lives in env (DISCORD_BOT_TOKEN), never
   * here; only the (non-secret) application/guild IDs belong in config.
   */
  discord: z
    .object({
      webhookUrl: z.string().url().optional(),
      channelId: z.string().optional(),
      /** Discord application (client) ID — needed to register the slash command. */
      applicationId: z.string().optional(),
      /**
       * Register the command to this guild for instant availability (great for
       * dev/single-server use). Omit to register globally (can take up to ~1h to
       * appear, but works across every server the bot is in).
       */
      guildId: z.string().optional(),
    })
    .default({}),
  /**
   * When the long-running worker (`inky serve`) posts. `jobs` is one or more
   * scheduled posts, each with its own `cron` (standard 5-field) and optional
   * `windowHours` (defaults to the top-level windowHours). This is how you run,
   * say, a daily standup AND a weekly one. `timezone` is a shared IANA name
   * (DST-aware). Example: daily weekday + weekly Monday:
   *   "jobs": [
   *     { "cron": "0 9 * * 1-5", "windowHours": 24,  "label": "daily" },
   *     { "cron": "0 9 * * 1",   "windowHours": 168, "label": "weekly" }
   *   ]
   */
  schedule: z
    .object({
      timezone: z.string().default('UTC'),
      jobs: z.array(ScheduleJobSchema).default([{ cron: '0 9 * * *', label: 'standup' }]),
    })
    .default({}),
  /**
   * Which LLM provider writes the summary. The core is provider-agnostic (one
   * injected call seam); these just pick the adapter and key:
   *   - anthropic: Claude (best grounded quality; the default). Key: ANTHROPIC_API_KEY.
   *   - groq:      open-weight models on Groq (fast/cheap). Key: GROQ_API_KEY.
   *   - openai:    OpenAI or any OpenAI-compatible endpoint. Key: OPENAI_API_KEY.
   */
  provider: z.enum(['anthropic', 'groq', 'openai']).default('anthropic'),
  /**
   * Override the API base URL (OpenAI-compatible providers only — Groq, OpenAI,
   * OpenRouter, a local Ollama, etc.). Omit to use the provider's default.
   */
  baseUrl: z.string().url().optional(),
  /**
   * Model id. Omit to use a sensible per-provider default (Claude for anthropic,
   * Llama for groq, GPT for openai). Key itself always comes from env, not here.
   */
  model: z.string().optional(),
  /**
   * Team stats panel in the AI standup: 'auto' shows it on weekly+ windows but
   * not the daily pulse; 'on' always; 'off' never. CLI --stats/--no-stats override.
   */
  stats: z.enum(['auto', 'on', 'off']).default('auto'),
  /**
   * Week-over-week trend arrows on the stats panel (direction vs the previous
   * equal-length window). 'auto'/'on' show them wherever the stats panel shows;
   * 'off' never. Costs one extra activity fetch (the prior window), so it only
   * runs when the panel is shown (weekly+). CLI --trends/--no-trends override.
   */
  trends: z.enum(['auto', 'on', 'off']).default('auto'),
  /**
   * Add a per-person stat line under each name. On by default and paired with the
   * team panel (shows wherever team stats show — i.e. weekly+); CLI --stats-per-person
   * forces it on even on the daily pulse. Set false to keep the post team-level only.
   */
  statsPerPerson: z.boolean().default(true),
  /**
   * Per-person output style: 'bullets' (default — scannable bullet points) or
   * 'prose' (narrative paragraph). CLI --format overrides. The project summary
   * stays prose either way.
   */
  format: z.enum(['prose', 'bullets']).default('bullets'),
  /**
   * Roadmap reconciliation (Phase 5): tie activity to the plan and add a
   * "status vs plan" block. Off by default; CLI --roadmap/--no-roadmap override.
   * Two sources:
   *   - "github-milestones" (default, no new setup): open/closed issue counts and
   *     due dates come straight off your milestones.
   *   - "roadmap-md": parse a checklist ROADMAP.md (## headings = goals, `- [ ]`/
   *     `- [x]` = tasks → progress). For teams that don't use Milestones.
   */
  roadmap: z
    .object({
      enabled: z.boolean().default(false),
      /** Where "the plan" lives (future: projects/linear/notion). */
      source: z.enum(['github-milestones', 'roadmap-md']).default('github-milestones'),
      /** Track only items whose title contains this (case-insensitive). Omit = all. */
      milestoneFilter: z.string().optional(),
      /** Flag an item at-risk when its due date is within this many days (or past). */
      atRiskDays: z.number().int().positive().default(7),
      /** roadmap-md: path to the checklist file in the repo. Default "ROADMAP.md". */
      path: z.string().default('ROADMAP.md'),
      /** roadmap-md: repo holding the file. Omit = the first configured repo. */
      repo: z.string().optional(),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Secrets, always from the environment — never the config file. */
export interface Secrets {
  githubToken: string;
  /** GitHub App id from env (GITHUB_APP_ID); config `github.appId` takes precedence. */
  githubAppId?: string;
  /** GitHub App private key (PEM), from GITHUB_APP_PRIVATE_KEY or _PATH. Secret. */
  githubAppPrivateKey?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  /** Discord incoming-webhook URL. Sensitive, so it lives in env, not config. */
  discordWebhookUrl?: string;
  /** Discord bot token for the `/standup` slash command. Secret → env only. */
  discordBotToken?: string;
}

/**
 * The GitHub App private key (PEM) from env: GITHUB_APP_PRIVATE_KEY (inline —
 * literal `\n` sequences are un-escaped so a single-line env var works) or
 * GITHUB_APP_PRIVATE_KEY_PATH (a file, which suits a Render Secret File / mounted
 * key). Inline wins if both are set.
 *
 * Never throws — a missing/unreadable path returns undefined so loadSecrets stays
 * safe for commands that need no GitHub creds (e.g. register-commands). When App
 * auth is actually requested, selectGitHubAuth turns "no key" into a clear error.
 */
function resolveAppPrivateKey(env: NodeJS.ProcessEnv): string | undefined {
  const inline = env.GITHUB_APP_PRIVATE_KEY;
  if (inline) return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  const path = env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined; // surfaced by selectGitHubAuth at the point App auth is chosen
    }
  }
  return undefined;
}

export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  // Presence of the GitHub token is enforced where it's used (collect()), not
  // here, so setup-only commands like `register-commands` don't demand it.
  return {
    githubToken: env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '',
    githubAppId: env.GITHUB_APP_ID,
    githubAppPrivateKey: resolveAppPrivateKey(env),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
    discordBotToken: env.DISCORD_BOT_TOKEN,
  };
}

/**
 * Where to post the standup. The webhook URL is a secret, so the env var
 * (DISCORD_WEBHOOK_URL) takes precedence over config.discord.webhookUrl — that
 * keeps it out of committed config and lets a hosted worker inject it. Returns
 * undefined when neither is set (callers fall back to printing).
 */
export function resolveWebhookUrl(config: Config, secrets: Secrets): string | undefined {
  return secrets.discordWebhookUrl ?? config.discord.webhookUrl;
}

/**
 * Load and validate config from a JSON file. Defaults to inky.config.json in
 * the current directory. Throws a readable error on malformed config.
 */
export function loadConfig(path = 'inky.config.json'): Config {
  if (!existsSync(path)) {
    throw new Error(
      `Config not found at ${path}. Copy inky.config.example.json to ${path} and set your org/repos.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config in ${path}:\n${details}`);
  }
  return result.data;
}
