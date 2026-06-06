/**
 * The `/standup` slash command — its definition, its window logic, and a
 * transport-agnostic handler.
 *
 * The handler talks to a narrow `StandupInteraction` interface, not to
 * discord.js, so the real product logic (parse options → build → respond) is
 * unit-tested with a fake interaction and a fake builder — no gateway, no
 * network. `src/bot.ts` is the thin discord.js adapter that satisfies the
 * interface with a real `ChatInputCommandInteraction`.
 */
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import type { Config, Secrets } from './config.js';
import { buildStandup as buildStandupImpl } from './standup.js';
import { standupEmbeds as standupEmbedsImpl, type StandupEmbed } from './discord.js';

export const STANDUP_COMMAND_NAME = 'standup';

/** Preset ranges the picker offers → window length in hours. */
const RANGE_HOURS: Record<string, number> = {
  today: 24,
  week: 168,
  month: 720, // ~30 days
};

const MIN_DAYS = 1;
const MAX_DAYS = 90;

/** The `/standup` command definition: a preset range picker + a custom-days escape hatch. */
export function buildStandupCommand(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder()
    .setName(STANDUP_COMMAND_NAME)
    .setDescription("Post the team's standup, summarized from GitHub activity")
    // Secure default: admins only. The standup exposes the org's private GitHub
    // activity, so don't let any member of any server the bot joins trigger it.
    // Server admins can broaden access per-command in Server Settings → Integrations.
    .setDefaultMemberPermissions('0');
  cmd.addStringOption((o) =>
    o
      .setName('range')
      .setDescription('Time window (defaults to the configured window)')
      .addChoices(
        { name: 'Today', value: 'today' },
        { name: 'This week', value: 'week' },
        { name: 'This month', value: 'month' },
      ),
  );
  cmd.addIntegerOption((o) =>
    o
      .setName('days')
      .setDescription(`Custom window in days (overrides range), ${MIN_DAYS}–${MAX_DAYS}`)
      .setMinValue(MIN_DAYS)
      .setMaxValue(MAX_DAYS),
  );
  // Report-setting overrides. Omitting an option keeps the configured default;
  // these just let a caller tweak one standup without editing config.
  cmd.addStringOption((o) =>
    o
      .setName('stats')
      .setDescription('Team stats panel (default: auto by window)')
      .addChoices(
        { name: 'On', value: 'on' },
        { name: 'Off', value: 'off' },
        { name: 'Auto (by window)', value: 'auto' },
      ),
  );
  cmd.addBooleanOption((o) =>
    o.setName('per_person').setDescription('Show each person’s stat line (overrides the default)'),
  );
  cmd.addStringOption((o) =>
    o
      .setName('format')
      .setDescription('Per-person style (default: bullets)')
      .addChoices({ name: 'Bullets', value: 'bullets' }, { name: 'Prose', value: 'prose' }),
  );
  // Private (ephemeral) reply — only the invoker sees it. Lets a manager inspect
  // the team's activity without posting it to the channel.
  cmd.addBooleanOption((o) =>
    o.setName('private').setDescription('Only you see the reply — inspect the team privately'),
  );
  return cmd;
}

/**
 * Resolve the requested window (hours) from the command options. `days` (clamped
 * to 1–90) wins over `range`; with neither, returns undefined so buildStandup
 * falls back to config.windowHours.
 */
export function resolveCommandWindow(range: string | null, days: number | null): number | undefined {
  if (days != null && Number.isFinite(days)) {
    const clamped = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(days)));
    return clamped * 24;
  }
  if (range && range in RANGE_HOURS) return RANGE_HOURS[range];
  return undefined;
}

/** Human label for a resolved window, for log lines. */
export function describeWindow(windowHours: number | undefined): string {
  if (windowHours == null) return 'the configured window';
  if (windowHours % 24 === 0) {
    const days = windowHours / 24;
    return days === 1 ? 'the last day' : `the last ${days} days`;
  }
  return `the last ${windowHours}h`;
}

/**
 * The transport-agnostic view of an interaction the handler needs. The option
 * accessors mirror discord.js, so bot.ts adapts a real ChatInputCommandInteraction
 * with a trivial passthrough and tests pass a fake option bag.
 */
export interface StandupInteraction {
  getString(name: string): string | null;
  getInteger(name: string): number | null;
  getBoolean(name: string): boolean | null;
  /** Who invoked it — for logging only. */
  user: string;
  /**
   * Acknowledge within 3s ("Inky is thinking…") so we can take our time. When
   * `ephemeral`, the entire reply (and any follow-ups) is visible only to the
   * invoker. Discord fixes ephemerality at defer time — it can't change after —
   * so the choice is made here, before the build.
   */
  defer(ephemeral: boolean): Promise<void>;
  /** Post the finished standup. */
  respond(embeds: StandupEmbed[]): Promise<void>;
  /** Report a failure in place of the standup. */
  respondError(message: string): Promise<void>;
}

/** The buildStandup-shaped request parsed from a `/standup` interaction. */
export interface StandupRequest {
  windowHours?: number;
  stats?: boolean;
  statsPerPerson?: boolean;
  format?: 'prose' | 'bullets';
}

/**
 * Parse the command options into a buildStandup request. Every field is an
 * override — left undefined when the option is absent so the configured default
 * applies.
 */
export function resolveStandupRequest(ix: StandupInteraction): StandupRequest {
  const windowHours = resolveCommandWindow(ix.getString('range'), ix.getInteger('days'));

  const statsOpt = ix.getString('stats'); // 'on' | 'off' | 'auto' | null
  const stats = statsOpt === 'on' ? true : statsOpt === 'off' ? false : undefined;

  const perPerson = ix.getBoolean('per_person');
  const statsPerPerson = perPerson === null ? undefined : perPerson;

  const fmt = ix.getString('format'); // 'bullets' | 'prose' | null
  const format = fmt === 'prose' ? 'prose' : fmt === 'bullets' ? 'bullets' : undefined;

  return { windowHours, stats, statsPerPerson, format };
}

export interface StandupCommandDeps {
  buildStandup?: typeof buildStandupImpl;
  standupEmbeds?: typeof standupEmbedsImpl;
  log?: (msg: string) => void;
}

/**
 * Handle one `/standup` invocation: ack, build the standup for the requested
 * window, and respond with it. Any failure is reported in place rather than
 * leaving the interaction hanging on "thinking…".
 */
export async function handleStandupCommand(
  ix: StandupInteraction,
  config: Config,
  secrets: Secrets,
  deps: StandupCommandDeps = {},
): Promise<void> {
  const log = deps.log ?? (() => {});
  const build = deps.buildStandup ?? buildStandupImpl;
  const toEmbeds = deps.standupEmbeds ?? standupEmbedsImpl;
  const req = resolveStandupRequest(ix);
  const ephemeral = ix.getBoolean('private') ?? false;

  await ix.defer(ephemeral); // building takes ~seconds; Discord wants an ack within 3
  try {
    const built = await build(config, secrets, { ...req, log });
    await ix.respond(toEmbeds(built.markdown));
    log(
      `inky: /standup answered for ${ix.user} (${describeWindow(req.windowHours)}${ephemeral ? ', private' : ''}).`,
    );
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    log(`inky: /standup failed for ${ix.user}: ${message}`);
    // Keep the channel-facing text short and single-line — never dump a raw API
    // response body into the channel. The full message is in the logs above.
    const safe = message.replace(/\s+/g, ' ').slice(0, 200);
    try {
      await ix.respondError(`⚠️ Couldn't build the standup: ${safe}`);
    } catch (replyErr) {
      log(`inky: failed to send the error reply: ${(replyErr as Error).message}`);
    }
  }
}

export interface RegisterOptions {
  applicationId: string;
  /** Register to one guild (instant) when set; otherwise globally (~1h to appear). */
  guildId?: string;
  token: string;
  log?: (msg: string) => void;
  /** Injectable transport for tests; defaults to discord.js REST.put. */
  put?: (route: string, body: unknown) => Promise<void>;
}

/** Register (PUT) the `/standup` command with Discord — guild-scoped or global. */
export async function registerCommands(opts: RegisterOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const body = [buildStandupCommand().toJSON()];
  const put =
    opts.put ??
    (async (route: string, payload: unknown) => {
      const rest = new REST({ version: '10' }).setToken(opts.token);
      await rest.put(route as `/${string}`, { body: payload });
    });

  const route = opts.guildId
    ? Routes.applicationGuildCommands(opts.applicationId, opts.guildId)
    : Routes.applicationCommands(opts.applicationId);
  await put(route, body);
  log(
    opts.guildId
      ? `inky: registered /${STANDUP_COMMAND_NAME} to guild ${opts.guildId} (instant).`
      : `inky: registered /${STANDUP_COMMAND_NAME} globally (can take up to ~1h to appear).`,
  );
}
