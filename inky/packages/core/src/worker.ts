/**
 * The long-running worker — Inky's "runs on its own" trigger layer.
 *
 * One in-process scheduler (croner) per configured job fires the standup on its
 * cron, each with its own window — so you can run, e.g., a daily standup AND a
 * weekly one from a single process. Each tick is wrapped so a failed run (GitHub
 * hiccup, LLM error, Discord 5xx) is logged and the worker keeps going — a daemon
 * must never die on one bad day. croner's `protect` guards against overlap if a
 * run outlasts its interval.
 *
 * This is a thin adapter over buildStandup() + the Discord delivery, kept
 * host-agnostic: deploy it to any always-on host (Render/Railway/Fly/a box). The
 * scheduler and the cycle body are injectable so the wiring is unit-tested
 * without real timers or network.
 */
import { Cron } from 'croner';
import type { Config, ScheduleJob, Secrets } from './config.js';
import { resolveWebhookUrl } from './config.js';
import { buildStandup } from './standup.js';
import { postStandupToDiscord } from './discord.js';

/** The slice of a scheduled job the worker needs — satisfied by croner's Cron. */
export interface ScheduledJob {
  nextRun(): Date | null;
  stop(): void;
}

/**
 * Creates a scheduled job. Defaults to croner; tests inject a fake that fires
 * the tick synchronously. The job always uses overlap protection (a tick is
 * skipped while a previous run is still in flight).
 */
export type SchedulerFactory = (
  pattern: string,
  options: { timezone: string },
  onTick: () => void | Promise<void>,
) => ScheduledJob;

const cronScheduler: SchedulerFactory = (pattern, options, onTick) =>
  new Cron(pattern, { timezone: options.timezone, protect: true }, onTick);

export interface WorkerOptions {
  /** Progress sink (defaults to stderr). */
  log?: (msg: string) => void;
  /** Run every configured job once immediately and resolve, without scheduling. */
  once?: boolean;
  /** Build each standup but print it instead of posting (no webhook required). */
  dryRun?: boolean;
  /** Injectable scheduler (defaults to croner). */
  scheduler?: SchedulerFactory;
  /** Injectable per-job cycle body (defaults to the real build + deliver). */
  runJob?: (job: ScheduleJob) => Promise<void>;
}

export interface WorkerHandle {
  /** Stop scheduling further runs (all jobs). */
  stop: () => void;
  /** The soonest next run across all jobs (null in --once mode). */
  nextRun: () => Date | null;
}

/**
 * Start the worker. In --once mode it runs each configured job once and resolves;
 * otherwise it schedules every job and returns a handle (the caller keeps the
 * process alive and wires signals). The returned promise resolving does NOT mean
 * the worker stopped.
 */
export async function startWorker(
  config: Config,
  secrets: Secrets,
  opts: WorkerOptions = {},
): Promise<WorkerHandle> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
  const webhookUrl = resolveWebhookUrl(config, secrets);

  // A scheduled worker that posts needs somewhere to post. Fail fast and loud
  // rather than silently running into the void. (--dry-run is exempt.)
  if (!opts.dryRun && !webhookUrl && !opts.runJob) {
    throw new Error(
      'inky serve: no Discord webhook configured. Set DISCORD_WEBHOOK_URL (or discord.webhookUrl in config), or pass --dry-run to print instead.',
    );
  }

  const runJob =
    opts.runJob ??
    (async (job: ScheduleJob) => {
      const tag = job.label ? ` (${job.label})` : '';
      log(`inky: running scheduled standup${tag}…`);
      const built = await buildStandup(config, secrets, { windowHours: job.windowHours, log });
      if (opts.dryRun || !webhookUrl) {
        log(`inky: dry run${tag} — printing standup instead of posting.`);
        process.stdout.write(built.markdown + '\n');
        return;
      }
      const { messages, embeds } = await postStandupToDiscord(webhookUrl, built.markdown);
      log(`inky: posted ${embeds} embed(s) in ${messages} message(s)${tag}.`);
    });

  const jobs = config.schedule.jobs;

  if (opts.once) {
    // Run each configured job once (handy to preview daily + weekly together).
    for (const job of jobs) {
      try {
        await runJob(job);
      } catch (err) {
        log(`inky: run failed: ${(err as Error).message}`);
      }
    }
    return { stop: () => {}, nextRun: () => null };
  }

  const scheduler = opts.scheduler ?? cronScheduler;
  const cronJobs: ScheduledJob[] = [];

  jobs.forEach((job, i) => {
    // One scheduled tick: never throws — a bad run is logged, the worker lives on.
    const tick = async () => {
      try {
        await runJob(job);
      } catch (err) {
        const tag = job.label ? ` (${job.label})` : '';
        log(`inky: scheduled run${tag} failed: ${(err as Error).message}`);
      } finally {
        const next = cronJobs[i]?.nextRun() ?? null;
        if (next) log(`inky: next ${job.label ?? 'run'} ${next.toISOString()}.`);
      }
    };
    const cj = scheduler(job.cron, { timezone: config.schedule.timezone }, tick);
    cronJobs.push(cj);
    const next = cj.nextRun();
    log(
      `inky: scheduled ${job.label ?? 'standup'} "${job.cron}" (${config.schedule.timezone}) — ` +
        `next run ${next ? next.toISOString() : 'n/a'}.`,
    );
  });

  return {
    stop: () => cronJobs.forEach((j) => j.stop()),
    nextRun: () => {
      const times = cronJobs.map((j) => j.nextRun()).filter((d): d is Date => d != null);
      return times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
    },
  };
}
