/**
 * buildStandup() — the host-agnostic "produce one standup" step.
 *
 * Collect → (summarize | mechanical) → render, returning the finished markdown
 * plus a little metadata. Delivery is intentionally NOT here: the CLI decides
 * print-vs-post and the worker always posts, but both share this build seam so
 * the trigger layer stays thin. Dependencies (collect, LLM resolution) are
 * injectable so this is unit-tested with fakes — no network — exactly like
 * summarize()'s `create` seam.
 */
import type { Config, Secrets } from './config.js';
import type { MilestoneRecord } from './github.js';
import type { OrgActivity, RoadmapStatus, TeamStats, Window } from './types.js';
import {
  collect as collectImpl,
  collectDeclaredRoadmap as collectDeclaredRoadmapImpl,
  collectRoadmap as collectRoadmapImpl,
  type CollectOptions,
} from './collect.js';
import {
  reconcile as reconcileImpl,
  reconcileDeclared as reconcileDeclaredImpl,
  type ReconcileDeclaredInput,
  type ReconcileInput,
  type ReconcileOptions,
} from './reconcile.js';
import type { DeclaredGoal } from './roadmap-md.js';
import { resolveLlm as resolveLlmImpl, PROVIDER_ENV, type ResolvedLlm } from './llm.js';

export type StandupFormat = 'prose' | 'bullets';

export interface BuildStandupOptions {
  /** Override the window length (hours); defaults to config.windowHours. */
  windowHours?: number;
  /** Skip the AI summary and use the deterministic renderer. */
  mechanical?: boolean;
  /** Per-person style; defaults to config.format. */
  format?: StandupFormat;
  /** Force the team stats panel on/off. undefined = auto (config.stats + window). */
  stats?: boolean;
  /** Force per-person stat lines. undefined = follow config + whether stats show. */
  statsPerPerson?: boolean;
  /** Force week-over-week trend arrows on/off. undefined = config.trends (when stats show). */
  trends?: boolean;
  /** Force the roadmap status block on/off. undefined = config.roadmap.enabled. */
  roadmap?: boolean;
  /** Progress sink (defaults to no-op). */
  log?: (msg: string) => void;
  /** Injectable clock, threaded to collect() for deterministic windows/tests. */
  now?: Date;
  /** Injectable dependencies (tests pass fakes; production uses the real ones). */
  deps?: BuildStandupDeps;
}

export interface BuildStandupDeps {
  collect?: (config: Config, secrets: Secrets, opts: CollectOptions) => Promise<OrgActivity>;
  resolveLlm?: (config: Config, secrets: Secrets) => ResolvedLlm | null;
  collectRoadmap?: (
    config: Config,
    secrets: Secrets,
    opts: { log?: (msg: string) => void },
  ) => Promise<MilestoneRecord[]>;
  reconcile?: (input: ReconcileInput, opts: ReconcileOptions) => RoadmapStatus;
  collectDeclaredRoadmap?: (
    config: Config,
    secrets: Secrets,
    opts: { log?: (msg: string) => void },
  ) => Promise<{ goals: DeclaredGoal[]; sourceUrl: string }>;
  reconcileDeclared?: (input: ReconcileDeclaredInput, opts: ReconcileOptions) => RoadmapStatus;
}

export interface BuiltStandup {
  /** Finished Discord-ready markdown. */
  markdown: string;
  /** How the body was produced — for logging/telemetry. */
  via: { provider: string; model: string } | 'mechanical';
  /** The window actually covered (after any windowHours override). */
  window: Window;
  /** True when nobody had activity in the window. */
  empty: boolean;
}

/**
 * Decide whether the team stats panel shows: --stats/--no-stats (the `stats`
 * arg) force it; otherwise config.stats, where 'auto' shows it on weekly+
 * windows but not the daily pulse.
 */
function shouldShowStats(config: Config, isDaily: boolean, forced: boolean | undefined): boolean {
  if (forced !== undefined) return forced;
  if (config.stats === 'on') return true;
  if (config.stats === 'off') return false;
  return !isDaily; // 'auto'
}

/**
 * Whether to show week-over-week trend arrows. They live on the stats panel, so
 * they require it to be shown; --trends/--no-trends force, else config.trends
 * ('auto'/'on' show; 'off' never).
 */
function shouldShowTrends(config: Config, showStats: boolean, forced: boolean | undefined): boolean {
  if (!showStats) return false;
  if (forced !== undefined) return forced;
  return config.trends !== 'off';
}

export async function buildStandup(
  config: Config,
  secrets: Secrets,
  opts: BuildStandupOptions = {},
): Promise<BuiltStandup> {
  const log = opts.log ?? (() => {});
  const collect = opts.deps?.collect ?? collectImpl;
  const resolveLlm = opts.deps?.resolveLlm ?? resolveLlmImpl;
  const collectRoadmap = opts.deps?.collectRoadmap ?? collectRoadmapImpl;
  const reconcile = opts.deps?.reconcile ?? reconcileImpl;
  const collectDeclaredRoadmap = opts.deps?.collectDeclaredRoadmap ?? collectDeclaredRoadmapImpl;
  const reconcileDeclared = opts.deps?.reconcileDeclared ?? reconcileDeclaredImpl;
  const roadmapEnabled = opts.roadmap ?? config.roadmap.enabled;

  const activity = await collect(config, secrets, {
    windowHours: opts.windowHours,
    now: opts.now,
    log,
  });

  // Render decisions are lazy-imported so neither path pays for the other.
  const { detailForWindow } = await import('./summarize.js');
  const { renderMechanical, renderStandup } = await import('./render.js');
  const isDaily = detailForWindow(activity.window).tier === 'daily';
  const showStats = shouldShowStats(config, isDaily, opts.stats);
  // Per-person stats pair with the team panel by default (show where it shows);
  // --stats-per-person forces them on regardless.
  const showPerPerson = opts.statsPerPerson ?? (config.statsPerPerson && showStats);

  const meta = { window: activity.window, empty: activity.people.length === 0 };

  // AI summary when a provider key is present and not opted out; otherwise the
  // deterministic render (also the failure fallback).
  const llm = opts.mechanical ? null : resolveLlm(config, secrets);
  if (llm) {
    // Roadmap reconciliation (Phase 5) — only on the AI path, only when enabled.
    // A fetch/reconcile failure is non-fatal: log and produce the standup without it.
    let roadmap: RoadmapStatus | undefined;
    if (roadmapEnabled) {
      const reconcileOpts: ReconcileOptions = {
        milestoneFilter: config.roadmap.milestoneFilter,
        atRiskDays: config.roadmap.atRiskDays,
        now: opts.now ?? new Date(),
      };
      try {
        if (config.roadmap.source === 'roadmap-md') {
          const { goals, sourceUrl } = await collectDeclaredRoadmap(config, secrets, { log });
          roadmap = reconcileDeclared({ goals, sourceUrl }, reconcileOpts);
        } else {
          const milestones = await collectRoadmap(config, secrets, {
            log,
            now: opts.now,
            windowSince: activity.window.since,
          });
          roadmap = reconcile(
            { milestones, issues: activity.people.flatMap((p) => p.issues), window: activity.window },
            reconcileOpts,
          );
        }
        log(`standup: roadmap reconciled — ${roadmap.items.length} item(s) tracked.`);
      } catch (err) {
        log(`standup: roadmap reconcile failed (${(err as Error).message}); skipping status vs plan.`);
      }
    }
    // Week-over-week trends — only when the stats panel shows. Costs one extra
    // collect (the prior equal-length window); non-fatal if it fails.
    let prevStats: TeamStats | undefined;
    if (shouldShowTrends(config, showStats, opts.trends)) {
      try {
        const w = activity.window;
        const lenHours = Math.max(1, Math.round((Date.parse(w.until) - Date.parse(w.since)) / 3_600_000));
        const prevActivity = await collect(config, secrets, {
          windowHours: lenHours,
          now: new Date(w.since),
          log,
        });
        const { computeTeamStats } = await import('./summarize.js');
        prevStats = computeTeamStats(prevActivity);
        log(`standup: trends — comparing against the previous ${lenHours}h window.`);
      } catch (err) {
        log(`standup: trends fetch failed (${(err as Error).message}); stats shown without trends.`);
      }
    }
    try {
      const { summarize } = await import('./summarize.js');
      const standup = await summarize(activity, {
        create: llm.create,
        model: llm.model,
        format: opts.format ?? config.format,
        roadmap,
        log,
      });
      log(`standup: summarized with ${llm.provider} (${llm.model}).`);
      return {
        markdown: renderStandup(standup, { showStats, statsPerPerson: showPerPerson, prevStats }),
        via: { provider: llm.provider, model: llm.model },
        ...meta,
      };
    } catch (err) {
      log(`standup: AI summary failed (${(err as Error).message}); falling back to mechanical.`);
      return { markdown: renderMechanical(activity), via: 'mechanical', ...meta };
    }
  }

  if (!opts.mechanical) {
    log(
      `standup: no ${PROVIDER_ENV[config.provider]} set for provider '${config.provider}' — using mechanical render.`,
    );
  }
  return { markdown: renderMechanical(activity), via: 'mechanical', ...meta };
}
