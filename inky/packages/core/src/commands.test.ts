import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStandupCommand,
  describeWindow,
  handleStandupCommand,
  registerCommands,
  resolveCommandWindow,
  resolveStandupRequest,
  type StandupInteraction,
} from './commands.js';
import { ConfigSchema, type Config, type Secrets } from './config.js';
import type { BuildStandupOptions, BuiltStandup } from './standup.js';
import type { StandupEmbed } from './discord.js';

const secrets: Secrets = { githubToken: 't' };
function cfg(): Config {
  return ConfigSchema.parse({ org: 'Acme' });
}

interface FakeOptions {
  range?: string;
  days?: number;
  stats?: string;
  per_person?: boolean;
  format?: string;
  private?: boolean;
}

function makeIx(options: FakeOptions = {}) {
  const state = {
    calls: [] as string[],
    embeds: undefined as StandupEmbed[] | undefined,
    error: undefined as string | undefined,
    ephemeral: undefined as boolean | undefined,
  };
  const pick = (name: string) => (name in options ? (options as Record<string, unknown>)[name] : null);
  const ix: StandupInteraction = {
    getString: (name) => (pick(name) as string | null) ?? null,
    getInteger: (name) => (pick(name) as number | null) ?? null,
    getBoolean: (name) => {
      const v = pick(name);
      return typeof v === 'boolean' ? v : null;
    },
    user: 'tester',
    defer: async (ephemeral) => {
      state.calls.push('defer');
      state.ephemeral = ephemeral;
    },
    respond: async (embeds) => {
      state.calls.push('respond');
      state.embeds = embeds;
    },
    respondError: async (message) => {
      state.calls.push('respondError');
      state.error = message;
    },
  };
  return { ix, state };
}

function fakeBuild(rec: { opts?: BuildStandupOptions }, throwMsg?: string) {
  return async (_c: Config, _s: Secrets, opts: BuildStandupOptions = {}): Promise<BuiltStandup> => {
    rec.opts = opts;
    if (throwMsg) throw new Error(throwMsg);
    return { markdown: '# Standup', via: 'mechanical', window: { since: 'a', until: 'b' }, empty: false };
  };
}

const fakeEmbeds = (markdown: string): StandupEmbed[] => [{ description: markdown, color: 1 }];

test('resolveCommandWindow: days overrides range, clamps to 1–90, else maps the preset', () => {
  assert.equal(resolveCommandWindow('week', null), 168);
  assert.equal(resolveCommandWindow('today', null), 24);
  assert.equal(resolveCommandWindow('month', null), 720);
  assert.equal(resolveCommandWindow('today', 5), 120); // days wins over range
  assert.equal(resolveCommandWindow(null, 0), 24); // clamp up to 1 day
  assert.equal(resolveCommandWindow(null, 1000), 2160); // clamp down to 90 days
  assert.equal(resolveCommandWindow(null, null), undefined); // → config default
  assert.equal(resolveCommandWindow('bogus', null), undefined);
});

test('resolveStandupRequest maps the report-setting options to overrides', () => {
  assert.deepEqual(resolveStandupRequest(makeIx({ range: 'week' }).ix), {
    windowHours: 168,
    stats: undefined,
    statsPerPerson: undefined,
    format: undefined,
  });
  assert.deepEqual(
    resolveStandupRequest(makeIx({ stats: 'on', per_person: false, format: 'prose' }).ix),
    { windowHours: undefined, stats: true, statsPerPerson: false, format: 'prose' },
  );
  assert.deepEqual(resolveStandupRequest(makeIx({ stats: 'off', per_person: true }).ix), {
    windowHours: undefined,
    stats: false,
    statsPerPerson: true,
    format: undefined,
  });
  assert.equal(resolveStandupRequest(makeIx({ stats: 'auto' }).ix).stats, undefined);
});

test('describeWindow reads back a window length', () => {
  assert.equal(describeWindow(undefined), 'the configured window');
  assert.equal(describeWindow(24), 'the last day');
  assert.equal(describeWindow(168), 'the last 7 days');
  assert.equal(describeWindow(6), 'the last 6h');
});

test('handleStandupCommand defers, builds with the requested options, and responds', async () => {
  const { ix, state } = makeIx({ range: 'today', stats: 'off', per_person: true, format: 'prose' });
  const rec: { opts?: BuildStandupOptions } = {};
  await handleStandupCommand(ix, cfg(), secrets, {
    buildStandup: fakeBuild(rec),
    standupEmbeds: fakeEmbeds,
    log: () => {},
  });
  assert.deepEqual(state.calls, ['defer', 'respond']);
  assert.equal(rec.opts?.windowHours, 24);
  assert.equal(rec.opts?.stats, false);
  assert.equal(rec.opts?.statsPerPerson, true);
  assert.equal(rec.opts?.format, 'prose');
  assert.equal(state.embeds?.length, 1);
  assert.equal(state.error, undefined);
  assert.equal(state.ephemeral, false); // public by default
});

test('handleStandupCommand defers ephemerally when private:true (manager inspects privately)', async () => {
  const { ix, state } = makeIx({ range: 'week', private: true });
  await handleStandupCommand(ix, cfg(), secrets, {
    buildStandup: fakeBuild({}),
    standupEmbeds: fakeEmbeds,
    log: () => {},
  });
  assert.deepEqual(state.calls, ['defer', 'respond']);
  assert.equal(state.ephemeral, true);
});

test('handleStandupCommand reports a build failure in place of the standup', async () => {
  const { ix, state } = makeIx({ range: 'week' });
  await handleStandupCommand(ix, cfg(), secrets, {
    buildStandup: fakeBuild({}, 'GitHub exploded'),
    standupEmbeds: fakeEmbeds,
    log: () => {},
  });
  assert.deepEqual(state.calls, ['defer', 'respondError']);
  assert.match(state.error ?? '', /GitHub exploded/);
});

test('handleStandupCommand truncates a long error and survives a failing error reply', async () => {
  // A long underlying error is shortened for the channel (full text stays in logs).
  const long = 'x'.repeat(500);
  const { ix, state } = makeIx({ range: 'today' });
  await handleStandupCommand(ix, cfg(), secrets, {
    buildStandup: fakeBuild({}, long),
    standupEmbeds: fakeEmbeds,
    log: () => {},
  });
  assert.match(state.error ?? '', /Couldn't build the standup/);
  assert.ok((state.error ?? '').length < 260, 'channel error should be truncated, not 500 chars');

  // If even the error reply fails, the handler must not throw (it's fire-and-forget).
  const throwingIx: StandupInteraction = {
    getString: () => null,
    getInteger: () => null,
    getBoolean: () => null,
    user: 'tester',
    defer: async () => {},
    respond: async () => {},
    respondError: async () => {
      throw new Error('discord down');
    },
  };
  await assert.doesNotReject(() =>
    handleStandupCommand(throwingIx, cfg(), secrets, {
      buildStandup: fakeBuild({}, 'boom'),
      standupEmbeds: fakeEmbeds,
      log: () => {},
    }),
  );
});

test('buildStandupCommand is admin-gated by default', () => {
  assert.equal(buildStandupCommand().toJSON().default_member_permissions, '0');
});

test('buildStandupCommand exposes range, days, and the report-setting options', () => {
  const json = buildStandupCommand().toJSON();
  assert.equal(json.name, 'standup');
  const opts = (json.options ?? []) as Array<Record<string, unknown>>;
  const byName = (n: string) => opts.find((o) => o.name === n);

  const range = byName('range');
  assert.ok(range);
  assert.equal((range!.choices as unknown[]).length, 3);

  const days = byName('days');
  assert.ok(days);
  assert.equal(days!.min_value, 1);
  assert.equal(days!.max_value, 90);

  const stats = byName('stats');
  assert.ok(stats);
  assert.equal((stats!.choices as unknown[]).length, 3);

  assert.ok(byName('per_person')); // boolean toggle
  assert.equal((byName('format')!.choices as unknown[]).length, 2);
  assert.ok(byName('private')); // ephemeral-reply toggle
});

test('registerCommands targets a guild route when guildId is set', async () => {
  const calls: { route: string; body: unknown }[] = [];
  await registerCommands({
    applicationId: 'app1',
    guildId: 'guild1',
    token: 't',
    log: () => {},
    put: async (route, body) => void calls.push({ route, body }),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.route, /applications\/app1\/guilds\/guild1\/commands$/);
  assert.ok(Array.isArray(calls[0]!.body));
});

test('registerCommands targets the global route without a guildId', async () => {
  const calls: string[] = [];
  await registerCommands({
    applicationId: 'app1',
    token: 't',
    log: () => {},
    put: async (route) => void calls.push(route),
  });
  assert.match(calls[0]!, /applications\/app1\/commands$/);
});
