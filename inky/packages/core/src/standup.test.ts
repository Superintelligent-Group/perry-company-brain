import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStandup } from './standup.js';
import { ConfigSchema, type Config, type Secrets } from './config.js';
import type { CollectOptions } from './collect.js';
import type { MilestoneRecord } from './github.js';
import type { MessagesCreate } from './summarize.js';
import type { OrgActivity, Window } from './types.js';

const secrets: Secrets = { githubToken: 't' };

function cfg(over: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse({ org: 'Acme', ...over });
}

const weekly: Window = { since: '2026-05-23T00:00:00.000Z', until: '2026-05-30T00:00:00.000Z' };
const daily: Window = { since: '2026-05-29T00:00:00.000Z', until: '2026-05-30T00:00:00.000Z' };

/** One active person (a merged PR + a commit) over the given window. */
function activityFor(window: Window): OrgActivity {
  return {
    org: 'Acme',
    window,
    people: [
      {
        person: { login: 'alice', displayName: 'Alice', emails: [] },
        commits: [
          {
            repo: 'web',
            sha: 'a1',
            message: 'feat: x',
            additions: 10,
            deletions: 1,
            url: 'u',
            authoredAt: window.until,
            unshipped: false,
          },
        ],
        pullRequests: [
          {
            repo: 'web',
            number: 42,
            title: 'Add login',
            state: 'merged',
            additions: 10,
            deletions: 1,
            url: 'https://gh/web/pull/42',
            createdAt: window.since,
            mergedAt: window.until,
          },
        ],
        reviews: [],
        issues: [],
        totals: {
          commits: 1,
          unshippedCommits: 0,
          additions: 10,
          deletions: 1,
          prsOpened: 1,
          prsMerged: 1,
          reviewsGiven: 0,
          issuesOpened: 0,
          issuesClosed: 0,
          repos: 1,
        },
      },
    ],
  };
}

/** Fake collect() that returns a fixture and records the options it was called with. */
function fakeCollect(activity: OrgActivity, record?: { opts?: CollectOptions }) {
  return async (_c: Config, _s: Secrets, opts: CollectOptions): Promise<OrgActivity> => {
    if (record) record.opts = opts;
    return activity;
  };
}

/** Fake resolveLlm() that returns a given MessagesCreate as the anthropic provider. */
function fakeLlm(create: MessagesCreate) {
  return () => ({ create, model: 'fake-model', provider: 'anthropic' as const });
}

/** A MessagesCreate that returns a canned emit_standup tool call. */
function emitCreate(input: unknown): MessagesCreate {
  return async () => ({
    content: [{ type: 'tool_use', name: 'emit_standup', input }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

const throwingCreate: MessagesCreate = async () => {
  throw new Error('boom');
};

test('buildStandup renders the AI summary with the team stats panel on a weekly window', async () => {
  const res = await buildStandup(cfg(), secrets, {
    deps: {
      collect: fakeCollect(activityFor(weekly)),
      resolveLlm: fakeLlm(
        emitCreate({
          projectSummary: 'Busy week.',
          people: [
            { login: 'alice', narrative: 'Shipped login (#42).', work: [{ repo: 'web', points: ['#42 Add login'] }] },
          ],
        }),
      ),
    },
  });
  assert.deepEqual(res.via, { provider: 'anthropic', model: 'fake-model' });
  assert.equal(res.empty, false);
  assert.match(res.markdown, /Busy week\./);
  assert.match(res.markdown, /Shipped login \(#42\)\./);
  assert.match(res.markdown, /### 📊 Team stats/); // weekly + auto → panel on
});

test('buildStandup omits the stats panel on the daily pulse (auto)', async () => {
  const res = await buildStandup(cfg(), secrets, {
    deps: {
      collect: fakeCollect(activityFor(daily)),
      resolveLlm: fakeLlm(emitCreate({ projectSummary: 'x', people: [{ login: 'alice', narrative: 'y', work: [] }] })),
    },
  });
  assert.doesNotMatch(res.markdown, /Team stats/);
});

test('buildStandup honors --no-stats even on a weekly window', async () => {
  const res = await buildStandup(cfg(), secrets, {
    stats: false,
    deps: {
      collect: fakeCollect(activityFor(weekly)),
      resolveLlm: fakeLlm(emitCreate({ projectSummary: 'x', people: [{ login: 'alice', narrative: 'y', work: [] }] })),
    },
  });
  assert.doesNotMatch(res.markdown, /Team stats/);
});

test('buildStandup falls back to the mechanical render when the AI summary fails', async () => {
  const res = await buildStandup(cfg(), secrets, {
    log: () => {},
    deps: { collect: fakeCollect(activityFor(weekly)), resolveLlm: fakeLlm(throwingCreate) },
  });
  assert.equal(res.via, 'mechanical');
  assert.match(res.markdown, /# 📋 Weekly Standup — Acme/);
  assert.doesNotMatch(res.markdown, /AI-summarized/); // the AI footer is absent
});

test('buildStandup --mechanical never resolves an LLM', async () => {
  let resolveCalled = false;
  const res = await buildStandup(cfg(), secrets, {
    mechanical: true,
    deps: {
      collect: fakeCollect(activityFor(daily)),
      resolveLlm: () => {
        resolveCalled = true;
        return null;
      },
    },
  });
  assert.equal(resolveCalled, false);
  assert.equal(res.via, 'mechanical');
});

test('buildStandup uses the mechanical render when no provider key is set', async () => {
  const res = await buildStandup(cfg(), secrets, {
    log: () => {},
    deps: { collect: fakeCollect(activityFor(daily)), resolveLlm: () => null },
  });
  assert.equal(res.via, 'mechanical');
});

test('buildStandup adds the status-vs-plan block when roadmap is enabled', async () => {
  const activity: OrgActivity = {
    org: 'Acme',
    window: weekly,
    people: [
      {
        person: { login: 'alice', displayName: 'Alice', emails: [] },
        commits: [],
        pullRequests: [],
        reviews: [],
        issues: [
          {
            repo: 'web',
            number: 5,
            title: 'Add checkout',
            state: 'closed',
            action: 'closed',
            url: 'u',
            at: weekly.until,
            milestoneNumber: 1,
          },
        ],
        totals: {
          commits: 0,
          unshippedCommits: 0,
          additions: 0,
          deletions: 0,
          prsOpened: 0,
          prsMerged: 0,
          reviewsGiven: 0,
          issuesOpened: 0,
          issuesClosed: 1,
          repos: 1,
        },
      },
    ],
  };
  const milestones: MilestoneRecord[] = [
    { repo: 'web', number: 1, title: 'Checkout v2', url: 'u', state: 'open', openIssues: 2, closedIssues: 8 },
  ];
  // Uses the real reconcile() (pure) — only collect/collectRoadmap/llm are faked.
  const res = await buildStandup(cfg(), secrets, {
    roadmap: true,
    now: new Date('2026-05-30T00:00:00.000Z'),
    deps: {
      collect: fakeCollect(activity),
      collectRoadmap: async () => milestones,
      resolveLlm: fakeLlm(
        emitCreate({ projectSummary: 's', people: [], statusVsPlan: 'Checkout v2 is advancing.' }),
      ),
    },
  });
  assert.match(res.markdown, /## 📍 Status vs plan/);
  assert.match(res.markdown, /Checkout v2 is advancing\./);
  assert.match(res.markdown, /\*\*Checkout v2\*\* — 8\/10 \(80%\) · 📈 advanced \(\+1 this period\)/);
});

test('buildStandup adds week-over-week trends via a second prior-window collect', async () => {
  const cur = activityFor(weekly); // 1 merged PR, 1 commit
  const prevActivity: OrgActivity = { org: 'Acme', window: weekly, people: [] }; // a quiet prior week
  const calls: CollectOptions[] = [];
  const collect = async (_c: Config, _s: Secrets, o: CollectOptions): Promise<OrgActivity> => {
    calls.push(o);
    return calls.length === 1 ? cur : prevActivity;
  };
  const res = await buildStandup(cfg({ stats: 'on', trends: 'on' }), secrets, {
    windowHours: 168,
    now: new Date('2026-05-30T00:00:00.000Z'),
    deps: { collect, resolveLlm: fakeLlm(emitCreate({ projectSummary: 's', people: [] })) },
  });
  assert.equal(calls.length, 2); // current window + the prior window
  assert.equal(calls[1]!.now?.toISOString(), weekly.since); // prior window ends where this one starts
  assert.match(res.markdown, /trend vs previous period/);
  assert.match(res.markdown, /\*\*1\*\* PRs merged \(↑1\)/); // 1 this week vs 0 last week
});

test('buildStandup uses the declared (ROADMAP.md) source when configured', async () => {
  // Real reconcileDeclared (pure); only collect/collectDeclaredRoadmap/llm are faked.
  const res = await buildStandup(cfg({ roadmap: { enabled: true, source: 'roadmap-md' } }), secrets, {
    now: new Date('2026-05-30T00:00:00.000Z'),
    deps: {
      collect: fakeCollect(activityFor(weekly)),
      collectDeclaredRoadmap: async () => ({
        goals: [{ title: 'Q3 Launch', openCount: 1, closedCount: 3 }],
        sourceUrl: 'https://gh/web/blob/main/ROADMAP.md',
      }),
      resolveLlm: fakeLlm(
        emitCreate({ projectSummary: 's', people: [], statusVsPlan: 'Q3 Launch is on track.' }),
      ),
    },
  });
  assert.match(res.markdown, /## 📍 Status vs plan/);
  assert.match(res.markdown, /Q3 Launch is on track\./);
  assert.match(res.markdown, /\*\*Q3 Launch\*\* — 3\/4 \(75%\) · 🔧 in progress/);
});

test('buildStandup skips roadmap when disabled (default)', async () => {
  let called = false;
  const res = await buildStandup(cfg(), secrets, {
    deps: {
      collect: fakeCollect(activityFor(weekly)),
      collectRoadmap: async () => {
        called = true;
        return [];
      },
      resolveLlm: fakeLlm(
        emitCreate({ projectSummary: 's', people: [{ login: 'alice', narrative: 'y', work: [] }] }),
      ),
    },
  });
  assert.equal(called, false);
  assert.doesNotMatch(res.markdown, /Status vs plan/);
});

test('buildStandup threads windowHours to collect and flags an empty window', async () => {
  const rec: { opts?: CollectOptions } = {};
  const res = await buildStandup(cfg(), secrets, {
    windowHours: 72,
    mechanical: true,
    deps: { collect: fakeCollect({ org: 'Acme', window: daily, people: [] }, rec) },
  });
  assert.equal(rec.opts?.windowHours, 72);
  assert.equal(res.empty, true);
  assert.match(res.markdown, /No GitHub activity/);
});
