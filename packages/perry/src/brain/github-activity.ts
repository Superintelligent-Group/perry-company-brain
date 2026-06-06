/**
 * Company Brain ⇄ Inky integration: surfaces Inky's GitHub-activity standups
 * inside Perry's brain, so the Company Brain unifies meeting documentation
 * (Perry) with what the team actually shipped in code (Inky).
 *
 * Inky's config loader + domain types come from the built @inky/core barrel
 * (light — no octokit/discord). The heavy collect→summarize→render pipeline
 * lives behind the @inky/core/standup subpath and is loaded lazily, so the
 * brain only pays for those adapters when a standup actually runs.
 */
import { loadConfig, loadSecrets, type Config, type Secrets, type Window } from "@inky/core";

/** The finished standup Inky produces (mirrors @inky/core/standup's BuiltStandup). */
export interface ActivityStandup {
  /** Discord-ready markdown. */
  markdown: string;
  /** How the body was produced — for logging/telemetry. */
  via: { provider: string; model: string } | "mechanical";
  /** The window actually covered. */
  window: Window;
  /** True when nobody had activity in the window. */
  empty: boolean;
}

export interface ActivityStandupOptions {
  /** Override the window length (hours); defaults to Inky's config.windowHours. */
  windowHours?: number;
  /** Skip the AI summary and use Inky's deterministic renderer. */
  mechanical?: boolean;
  /** Path to inky.config.json; defaults to INKY_CONFIG_PATH or ./inky.config.json. */
  configPath?: string;
}

export interface InkyContext {
  config: Config;
  secrets: Secrets;
}

/** Loads Inky's config + secrets (GitHub token/app, org, repos) the way the inky CLI does. */
export function loadInkyContext(configPath = process.env.INKY_CONFIG_PATH ?? "inky.config.json"): InkyContext {
  return { config: loadConfig(configPath), secrets: loadSecrets() };
}

// Loaded by a string-typed specifier so Perry's classic module resolution does
// not try to resolve @inky/core's exports-mapped subpath at build time; Node's
// ESM resolver handles it at runtime (require(esm), Node >= 24).
const STANDUP_ENTRY: string = "@inky/core/standup";

/**
 * Runs Inky's GitHub-activity standup (collect → summarize → render) and returns
 * the rendered result. Requires a GitHub token/App and an inky.config.json that
 * describes the org/repos. The AI summary uses Inky's own provider resolution
 * (BYO key); without one it falls back to the deterministic render.
 */
export async function generateActivityStandup(opts: ActivityStandupOptions = {}): Promise<ActivityStandup> {
  const { config, secrets } = loadInkyContext(opts.configPath);
  const standup = (await import(STANDUP_ENTRY)) as {
    buildStandup: (
      config: Config,
      secrets: Secrets,
      opts: { windowHours?: number; mechanical?: boolean },
    ) => Promise<ActivityStandup>;
  };
  return standup.buildStandup(config, secrets, {
    windowHours: opts.windowHours,
    mechanical: opts.mechanical,
  });
}
