#!/usr/bin/env node
/**
 * Inky CLI. Thin trigger layer over the core pipeline.
 *
 *   inky collect           — fetch + normalize org activity, print JSON (Phase 1)
 *   inky standup           — collect -> summarize -> render -> deliver (Phases 3–4)
 *   inky serve             — scheduled posts + the /standup bot, forever (Phase 4)
 *   inky register-commands — register the /standup slash command with Discord
 *
 * The CLI only parses args and wires stages together; all real work lives in
 * the host-agnostic core so the worker and the slash command reuse it.
 */
import 'dotenv/config';
import { loadConfig, loadSecrets, resolveWebhookUrl } from './config.js';
import { resolveWindow } from './window.js';

const COMMANDS = ['collect', 'standup', 'serve', 'register-commands'] as const;
const PROVIDERS = ['anthropic', 'groq', 'openai'] as const;
type Provider = (typeof PROVIDERS)[number];
const FORMATS = ['prose', 'bullets'] as const;
type Format = (typeof FORMATS)[number];
type Command = (typeof COMMANDS)[number];

const HELP = `inky 🐙 — your team's daily standup, written for you

Reads your org's GitHub activity (commits across all branches, PRs, reviews,
issues) and writes the standup automatically — no human input.

Usage:
  inky collect [opts]              Fetch and normalize org activity (prints JSON)
  inky standup [opts] [--dry-run]  Build and deliver the standup once
  inky serve [opts] [--once]       Scheduled posts + the /standup bot, forever
  inky register-commands [opts]    Register the /standup slash command
  inky help                        Show this help

Window (default: config windowHours, ending now):
  --days <n>          Window length in days
  --hours <n>         Window length in hours
  --since <date>      Window start (ISO, e.g. 2026-06-01). With --until = exact range
  --until <date>      Window end (ISO; default: now). Replays a past window

Report:
  --stats             Force the team stats panel on (default: auto on weekly+)
  --no-stats          Force the team stats panel off
  --stats-per-person  Add a per-person stat line under each name
  --trends            Force week-over-week trend arrows on the stats panel
  --no-trends         Omit the trend arrows
  --roadmap           Add the status-vs-plan block (from GitHub milestones)
  --no-roadmap        Omit the status-vs-plan block
  --format <style>    Per-person style: prose (default) | bullets
  --mechanical        Skip the AI summary; use the deterministic renderer

Other:
  --config <path>     Config file (default: inky.config.json)
  --provider <p>      LLM provider: anthropic | groq | openai (overrides config)
  --model <id>        LLM model id (overrides config model / provider default)
  --dry-run           Print the standup instead of posting to Discord
  --once              (serve) Run one scheduled-post cycle now and exit (no bot)

Examples:
  inky standup --dry-run                  Preview today's standup (nothing posted)
  inky standup --days 1                   Post a daily standup to Discord
  inky standup --days 7 --stats           Post a weekly with the team stats panel
  inky standup --since 2026-06-01 --until 2026-06-02   Replay an exact past window
  inky serve                              Run the scheduler (+ bot) on its own, forever
  inky serve --once --dry-run             Test one scheduled cycle, printed not posted
  inky register-commands                  Register the /standup slash command (once)

Environment:
  GITHUB_TOKEN         GitHub PAT / fine-grained token (repo read)
  ANTHROPIC_API_KEY    Anthropic key (or GROQ_API_KEY / OPENAI_API_KEY)
  DISCORD_WEBHOOK_URL  Discord incoming webhook (scheduled posts; preferred over config)
  DISCORD_BOT_TOKEN    Discord bot token (the /standup slash command)

Docs: https://github.com/Doppel-Labs/inky`;

/** Print help to stdout and exit 0 — for `help` / --help / -h / no args. */
function printHelp(): never {
  console.log(HELP);
  process.exit(0);
}

/** Print help to stderr and exit non-zero — for usage errors. */
function usage(): never {
  console.error(HELP);
  process.exit(2);
}

interface ParsedArgs {
  command: Command;
  configPath: string;
  dryRun: boolean;
  once: boolean;
  mechanical: boolean;
  windowHours?: number;
  /** Window end (collect's `now`); set by --until so a past window can be replayed. */
  windowEnd?: Date;
  model?: string;
  provider?: Provider;
  /** undefined = use config (auto); true/false = forced by --stats/--no-stats. */
  stats?: boolean;
  statsPerPerson?: boolean;
  /** undefined = config.trends (when stats show); true/false = forced by --trends/--no-trends. */
  trends?: boolean;
  /** undefined = config.roadmap.enabled; true/false = forced by --roadmap/--no-roadmap. */
  roadmap?: boolean;
  format?: Format;
}

function parsePositiveNumber(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) usage();
  return n;
}

function parseArgs(argv: string[]): ParsedArgs {
  // Help: `inky`, `inky help`, `--help`, `-h` all print help to stdout and exit 0.
  if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
  }
  const [command, ...rest] = argv;
  if (!command || !COMMANDS.includes(command as Command)) usage();
  let configPath = 'inky.config.json';
  let dryRun = false;
  let once = false;
  let mechanical = false;
  let windowHours: number | undefined;
  let since: string | undefined;
  let until: string | undefined;
  let model: string | undefined;
  let provider: Provider | undefined;
  let stats: boolean | undefined;
  let statsPerPerson: boolean | undefined;
  let trends: boolean | undefined;
  let roadmap: boolean | undefined;
  let format: Format | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--config') {
      const next = rest[i + 1];
      if (!next) usage();
      configPath = next;
      i++;
    } else if (rest[i] === '--days') {
      windowHours = parsePositiveNumber(rest[++i]) * 24;
    } else if (rest[i] === '--hours') {
      windowHours = parsePositiveNumber(rest[++i]);
    } else if (rest[i] === '--since') {
      since = rest[++i];
      if (!since) usage();
    } else if (rest[i] === '--until') {
      until = rest[++i];
      if (!until) usage();
    } else if (rest[i] === '--model') {
      model = rest[++i];
      if (!model) usage();
    } else if (rest[i] === '--provider') {
      const next = rest[++i];
      if (!next || !PROVIDERS.includes(next as Provider)) usage();
      provider = next as Provider;
    } else if (rest[i] === '--stats') {
      stats = true;
    } else if (rest[i] === '--no-stats') {
      stats = false;
    } else if (rest[i] === '--stats-per-person') {
      statsPerPerson = true;
    } else if (rest[i] === '--trends') {
      trends = true;
    } else if (rest[i] === '--no-trends') {
      trends = false;
    } else if (rest[i] === '--roadmap') {
      roadmap = true;
    } else if (rest[i] === '--no-roadmap') {
      roadmap = false;
    } else if (rest[i] === '--format') {
      const next = rest[++i];
      if (!next || !FORMATS.includes(next as Format)) usage();
      format = next as Format;
    } else if (rest[i] === '--dry-run') {
      dryRun = true;
    } else if (rest[i] === '--once') {
      once = true;
    } else if (rest[i] === '--mechanical') {
      mechanical = true;
    } else {
      usage();
    }
  }

  // Fold --since/--until into the (end, length) pair the core uses.
  let windowEnd: Date | undefined;
  try {
    const resolved = resolveWindow({ since, until, windowHours });
    windowHours = resolved.windowHours;
    windowEnd = resolved.windowEnd;
  } catch (err) {
    console.error(`inky: ${(err as Error).message}`);
    usage();
  }

  return {
    command: command as Command,
    configPath,
    dryRun,
    once,
    mechanical,
    windowHours,
    windowEnd,
    model,
    provider,
    stats,
    statsPerPerson,
    trends,
    roadmap,
    format,
  };
}

async function main(): Promise<void> {
  const { command, configPath, dryRun, once, mechanical, windowHours, windowEnd, model, provider, stats, statsPerPerson, trends, roadmap, format } =
    parseArgs(process.argv.slice(2));
  let config = loadConfig(configPath);
  // CLI overrides (for quick A/B). Switching provider drops the configured
  // model — it belongs to the old provider — so the new provider's default
  // applies unless --model is also given.
  if (provider) config = { ...config, provider, model: undefined };
  if (model) config = { ...config, model };
  const secrets = loadSecrets();

  switch (command) {
    case 'collect': {
      const { collect } = await import('./collect.js');
      const activity = await collect(config, secrets, { windowHours, now: windowEnd });
      process.stdout.write(JSON.stringify(activity, null, 2) + '\n');
      break;
    }
    case 'standup': {
      const { buildStandup } = await import('./standup.js');
      const { markdown } = await buildStandup(config, secrets, {
        windowHours,
        now: windowEnd,
        mechanical,
        format,
        stats,
        statsPerPerson,
        trends,
        roadmap,
        log: (m) => console.error(m),
      });

      const webhookUrl = resolveWebhookUrl(config, secrets);
      if (dryRun || !webhookUrl) {
        if (!webhookUrl && !dryRun) {
          console.error('standup: no Discord webhook configured — printing instead.');
        }
        process.stdout.write(markdown);
        break;
      }
      const { postStandupToDiscord } = await import('./discord.js');
      const { messages, embeds } = await postStandupToDiscord(webhookUrl, markdown);
      console.error(`standup: posted ${embeds} embed(s) in ${messages} message(s) to Discord.`);
      break;
    }
    case 'serve': {
      const { startWorker } = await import('./worker.js');
      if (once) {
        // --once is a single scheduled-post cycle (for testing); no bot loop.
        await startWorker(config, secrets, { once: true, dryRun, log: (m) => console.error(m) });
        break;
      }

      const stops: Array<() => void | Promise<void>> = [];

      // Scheduled posting — runs when a webhook is configured (or in --dry-run).
      const webhookUrl = resolveWebhookUrl(config, secrets);
      if (webhookUrl || dryRun) {
        const worker = await startWorker(config, secrets, { dryRun, log: (m) => console.error(m) });
        stops.push(worker.stop);
      }

      // On-demand /standup — runs when a bot token is configured.
      if (secrets.discordBotToken) {
        const { startBot } = await import('./bot.js');
        const bot = await startBot(config, secrets, { log: (m) => console.error(m) });
        stops.push(bot.stop);
      }

      if (stops.length === 0) {
        throw new Error(
          'inky serve: nothing to run. Set DISCORD_WEBHOOK_URL for scheduled posts and/or DISCORD_BOT_TOKEN for the /standup command.',
        );
      }

      // Long-running: keep the process alive and shut down cleanly on signals.
      const shutdown = async (sig: string) => {
        console.error(`inky: received ${sig}, stopping…`);
        await Promise.allSettled(stops.map((stop) => stop()));
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
      await new Promise<never>(() => {}); // block forever; the gateway + cron drive the work
      break;
    }
    case 'register-commands': {
      const applicationId = config.discord.applicationId;
      const token = secrets.discordBotToken;
      if (!token) throw new Error('register-commands: set DISCORD_BOT_TOKEN (the bot token).');
      if (!applicationId) {
        throw new Error(
          'register-commands: set discord.applicationId in config (your Discord application ID).',
        );
      }
      const { registerCommands } = await import('./commands.js');
      await registerCommands({
        applicationId,
        guildId: config.discord.guildId,
        token,
        log: (m) => console.error(m),
      });
      break;
    }
  }
}

main().catch((err: unknown) => {
  console.error(`inky: ${(err as Error).message}`);
  process.exit(1);
});
