import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroundingDigest,
  classifyPrSize,
  computeOrgTotals,
  computeTeamStats,
  detailForWindow,
  isRevertCommit,
  summarize,
} from './summarize.js';
import type { CreateMessageParams, MessageResponse, MessagesCreate } from './summarize.js';
import type { OrgActivity, PersonActivity, RoadmapStatus } from './types.js';

function sampleRoadmap(): RoadmapStatus {
  return {
    items: [
      {
        item: {
          id: 'milestone:web#1',
          kind: 'milestone',
          title: 'Checkout v2',
          url: 'https://gh/web/milestone/1',
          repo: 'web',
          openCount: 3,
          closedCount: 7,
          state: 'open',
        },
        movement: 'advanced',
        closedThisWindow: 2,
        progress: 0.7,
        atRisk: false,
      },
    ],
    unplanned: { closedIssues: 0 },
    totals: { tracked: 1, completed: 0, advanced: 1, stalled: 0, atRisk: 0 },
  };
}

const window = { since: '2026-05-29T00:00:00.000Z', until: '2026-05-30T00:00:00.000Z' };

function emptyTotals(): PersonActivity['totals'] {
  return {
    commits: 0,
    unshippedCommits: 0,
    additions: 0,
    deletions: 0,
    prsOpened: 0,
    prsMerged: 0,
    reviewsGiven: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    repos: 0,
  };
}

function person(login: string, over: Partial<PersonActivity> = {}): PersonActivity {
  return {
    person: { login, displayName: login, emails: [] },
    commits: [],
    pullRequests: [],
    reviews: [],
    issues: [],
    totals: emptyTotals(),
    ...over,
  };
}

function commit(over: Partial<import('./types.js').CommitActivity> = {}) {
  return {
    repo: 'web',
    sha: 'x',
    message: 'do a thing',
    additions: 10,
    deletions: 2,
    url: 'https://gh/web/commit/x',
    authoredAt: window.until,
    unshipped: false,
    ...over,
  };
}

const sampleActivity: OrgActivity = {
  org: 'Acme',
  window,
  people: [
    person('alice', {
      person: { login: 'alice', displayName: 'Alice', emails: [] },
      commits: [
        {
          repo: 'web',
          sha: 'a1',
          message: 'wip: new parser',
          additions: 100,
          deletions: 5,
          url: 'https://gh/web/commit/a1',
          authoredAt: window.until,
          unshipped: true,
          branch: 'feat/parser',
        },
        {
          repo: 'web',
          sha: 'b2',
          message: 'tidy imports',
          additions: 3,
          deletions: 3,
          url: 'https://gh/web/commit/b2',
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
      totals: { ...emptyTotals(), commits: 2, unshippedCommits: 1, prsMerged: 1, repos: 1 },
    }),
  ],
};

/** A fake MessagesCreate that records the params and returns a canned tool call. */
function fakeCreate(
  input: unknown,
  record?: { params?: CreateMessageParams },
): MessagesCreate {
  return async (params: CreateMessageParams): Promise<MessageResponse> => {
    if (record) record.params = params;
    return {
      content: [{ type: 'tool_use', name: 'emit_standup', input }],
      usage: { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 400 },
    };
  };
}

test('detailForWindow scales depth with window length', () => {
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}T00:00:00.000Z`;
  assert.equal(detailForWindow({ since: day(29), until: day(30) }).tier, 'daily');
  assert.equal(detailForWindow({ since: day(27), until: day(30) }).tier, 'multi-day');
  assert.equal(detailForWindow({ since: day(23), until: day(30) }).tier, 'weekly');
  assert.equal(detailForWindow({ since: day(1), until: day(30) }).tier, 'monthly');
  // longer windows get more room + more highlights
  const daily = detailForWindow({ since: day(29), until: day(30) });
  const weekly = detailForWindow({ since: day(23), until: day(30) });
  assert.ok(weekly.maxHighlights > daily.maxHighlights);
  assert.ok(weekly.commitCap > daily.commitCap);
  assert.ok(weekly.outputTokens > daily.outputTokens);
});

test('buildGroundingDigest caps commits per the detail level', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    commit({ message: `change ${i}`, sha: String(i), unshipped: false }),
  );
  const p = person('dev', { commits: many, totals: { ...emptyTotals(), commits: 20 } });
  const activity: OrgActivity = { org: 'Acme', window, people: [p] };
  const daily = buildGroundingDigest(activity, detailForWindow(window)); // 24h → daily, cap 8
  const shippedLines = daily.split('\n').filter((l) => /^- change \d+ \(web\)/.test(l));
  assert.equal(shippedLines.length, 8);
});

test('computeOrgTotals rolls up per-person totals + distinct repos', () => {
  const activity: OrgActivity = {
    org: 'Acme',
    window,
    people: [
      person('a', {
        commits: [{ repo: 'web', sha: '1', message: 'm', additions: 1, deletions: 0, url: 'u', authoredAt: window.until, unshipped: false }],
        pullRequests: [
          { repo: 'web', number: 1, title: 't', state: 'merged', additions: 1, deletions: 0, url: 'u', createdAt: window.since },
        ],
        totals: { ...emptyTotals(), commits: 3, prsMerged: 2, prsOpened: 1, repos: 1 },
      }),
      person('b', {
        commits: [{ repo: 'api', sha: '2', message: 'm', additions: 1, deletions: 0, url: 'u', authoredAt: window.until, unshipped: true }],
        totals: { ...emptyTotals(), commits: 4, unshippedCommits: 1, prsMerged: 1, repos: 1 },
      }),
    ],
  };
  const t = computeOrgTotals(activity);
  assert.equal(t.contributors, 2);
  assert.equal(t.commits, 7);
  assert.equal(t.unshippedCommits, 1);
  assert.equal(t.prsMerged, 3); // not silently de-duped — straight sum of per-person merges
  assert.equal(t.repos, 2); // web + api, distinct
});

test('isRevertCommit flags reverts, not normal fixes', () => {
  assert.ok(isRevertCommit('Revert "add cache"'));
  assert.ok(isRevertCommit('revert: drop the flag'));
  assert.ok(isRevertCommit('chore: undo\n\nThis reverts commit abc123.'));
  assert.equal(isRevertCommit('fix: handle null user'), false);
  assert.equal(isRevertCommit('feat: add billing'), false);
});

test('computeTeamStats derives revert rate and median PR cycle time', () => {
  const activity: OrgActivity = {
    org: 'Acme',
    window,
    people: [
      person('a', {
        commits: [
          commit({ message: 'feat: x', sha: '1' }),
          commit({ message: 'Revert "feat: x"', sha: '2' }),
          commit({ message: 'fix: y', sha: '3' }),
          commit({ message: 'chore: z', sha: '4' }),
        ],
        pullRequests: [
          // cycle times of 24h and 48h → median 36h
          { repo: 'web', number: 1, title: 't', state: 'merged', additions: 1, deletions: 0, url: 'u', createdAt: '2026-05-29T00:00:00.000Z', mergedAt: '2026-05-30T00:00:00.000Z' },
          { repo: 'web', number: 2, title: 't', state: 'merged', additions: 1, deletions: 0, url: 'u', createdAt: '2026-05-28T00:00:00.000Z', mergedAt: '2026-05-30T00:00:00.000Z' },
          { repo: 'web', number: 3, title: 't', state: 'open', additions: 1, deletions: 0, url: 'u', createdAt: '2026-05-29T00:00:00.000Z' },
        ],
        reviews: [
          // PR #1 opened 05-29T00:00, first review 6h later → TTFR 6h.
          { repo: 'web', pullRequestNumber: 1, pullRequestTitle: 't', state: 'approved', pullRequestAuthor: 'x', url: 'u', submittedAt: '2026-05-29T06:00:00.000Z' },
          // PR #2 was opened before the window → excluded from TTFR even if reviewed.
          { repo: 'web', pullRequestNumber: 2, pullRequestTitle: 't', state: 'approved', pullRequestAuthor: 'x', url: 'u', submittedAt: '2026-05-29T12:00:00.000Z' },
        ],
        totals: { ...emptyTotals(), commits: 4, prsMerged: 2, prsOpened: 1, repos: 1 },
      }),
    ],
  };
  const s = computeTeamStats(activity);
  assert.equal(s.reverts, 1);
  assert.equal(s.revertRate, 1 / 4);
  assert.equal(s.medianPrCycleHours, 36); // median of 24h and 48h
  assert.equal(s.medianTimeToFirstReviewHours, 6); // only PR #1 (opened in-window)
  // both merged PRs are 1 line (additions 1 / deletions 0) → xs; the open PR isn't sized
  assert.deepEqual(s.prSizes, { xs: 2, s: 0, m: 0, l: 0, xl: 0 });
  assert.deepEqual(s.dailyCommits, [4]); // 1-day window → one bucket with all 4 commits
});

test('computeTeamStats buckets commits into per-day slices across the window (the activity sparkline)', () => {
  const wk = { since: '2026-05-23T00:00:00.000Z', until: '2026-05-30T00:00:00.000Z' }; // 7 days
  const c = (sha: string, authoredAt: string) =>
    commit({ sha, authoredAt, message: 'feat: x' });
  const activity: OrgActivity = {
    org: 'Acme',
    window: wk,
    people: [
      person('a', {
        commits: [
          c('1', '2026-05-23T01:00:00.000Z'), // day 0
          c('2', '2026-05-23T20:00:00.000Z'), // day 0
          c('3', '2026-05-25T05:00:00.000Z'), // day 2
          c('4', '2026-05-29T23:00:00.000Z'), // day 6
        ],
        totals: { ...emptyTotals(), commits: 4, repos: 1 },
      }),
    ],
  };
  const s = computeTeamStats(activity);
  assert.equal(s.dailyCommits.length, 7);
  assert.deepEqual(s.dailyCommits, [2, 0, 1, 0, 0, 0, 1]);
});

test('classifyPrSize buckets a PR by total lines changed', () => {
  assert.equal(classifyPrSize(0), 'xs');
  assert.equal(classifyPrSize(9), 'xs');
  assert.equal(classifyPrSize(10), 's');
  assert.equal(classifyPrSize(99), 's');
  assert.equal(classifyPrSize(100), 'm');
  assert.equal(classifyPrSize(499), 'm');
  assert.equal(classifyPrSize(500), 'l');
  assert.equal(classifyPrSize(999), 'l');
  assert.equal(classifyPrSize(1000), 'xl');
});

test('buildGroundingDigest includes verified org totals for aggregate claims', () => {
  const digest = buildGroundingDigest(sampleActivity);
  assert.match(digest, /Org totals \(verified/);
  assert.match(digest, /Contributors active: 1/);
  assert.match(digest, /Commits: 2 \(1 unshipped\)/);
  assert.match(digest, /PRs: 1 merged, 0 opened/);
});

test('buildGroundingDigest surfaces shipped + unshipped work with refs', () => {
  const digest = buildGroundingDigest(sampleActivity);
  assert.match(digest, /Organization: Acme/);
  assert.match(digest, /login: alice/);
  assert.match(digest, /#42 Add login \(web\)/);
  assert.match(digest, /Work in progress.*\n- wip: new parser \(web@feat\/parser\)/);
  assert.match(digest, /Shipped commits.*\n- tidy imports \(web\)/);
});

test('summarize maps model output to people by login', async () => {
  const standup = await summarize(sampleActivity, {
    create: fakeCreate({
      projectSummary: 'Team pushed on the parser; login shipped.',
      people: [
        {
          login: 'alice',
          narrative: 'Working on a new parser (#42 merged).',
          work: [{ repo: 'web', points: ['#42 Add login'] }],
        },
      ],
    }),
  });
  assert.equal(standup.org, 'Acme');
  assert.equal(standup.projectSummary, 'Team pushed on the parser; login shipped.');
  assert.equal(standup.people.length, 1);
  assert.equal(standup.people[0]?.person.login, 'alice');
  assert.equal(standup.people[0]?.narrative, 'Working on a new parser (#42 merged).');
  assert.deepEqual(standup.people[0]?.work, [{ repo: 'web', points: ['#42 Add login'] }]);
});

test('summarize matches logins case-insensitively', async () => {
  const standup = await summarize(sampleActivity, {
    create: fakeCreate({
      projectSummary: 's',
      people: [{ login: 'ALICE', narrative: 'Matched despite different case.' }],
    }),
  });
  assert.equal(standup.people[0]?.narrative, 'Matched despite different case.');
});

test('summarize falls back to facts when the model omits a person', async () => {
  const standup = await summarize(sampleActivity, {
    create: fakeCreate({ projectSummary: 's', people: [] }),
  });
  assert.equal(standup.people.length, 1);
  assert.match(standup.people[0]?.narrative ?? '', /2 commits \(1 unshipped\)/);
});

test('summarize short-circuits an empty window without calling the model', async () => {
  let called = false;
  const create: MessagesCreate = async () => {
    called = true;
    return { content: [] };
  };
  const standup = await summarize({ org: 'Acme', window, people: [] }, { create });
  assert.equal(called, false);
  assert.equal(standup.people.length, 0);
  assert.match(standup.projectSummary, /No GitHub activity/);
});

test('summarize sends a cached system prompt and forces the tool call', async () => {
  const record: { params?: CreateMessageParams } = {};
  await summarize(sampleActivity, {
    create: fakeCreate({ projectSummary: 's', people: [] }, record),
    model: 'claude-test',
  });
  const p = record.params!;
  assert.equal(p.model, 'claude-test');
  assert.equal(p.system[0]?.cache_control?.type, 'ephemeral');
  assert.equal(p.tool_choice.name, 'emit_standup');
  assert.match(p.messages[0]?.content ?? '', /factual activity digest/);
});

test('summarize switches the per-person style with format: bullets', async () => {
  const proseRec: { params?: CreateMessageParams } = {};
  await summarize(sampleActivity, { create: fakeCreate({ projectSummary: 's', people: [] }, proseRec) });
  assert.match(proseRec.params!.messages[0]!.content, /STYLE — prose/);

  const bulletRec: { params?: CreateMessageParams } = {};
  await summarize(sampleActivity, {
    create: fakeCreate({ projectSummary: 's', people: [] }, bulletRec),
    format: 'bullets',
  });
  assert.match(bulletRec.params!.messages[0]!.content, /STYLE — bullets/);
  assert.match(bulletRec.params!.messages[0]!.content, /do NOT write a prose paragraph/);
});

test('buildGroundingDigest includes the roadmap block when a roadmap is given', () => {
  const digest = buildGroundingDigest(sampleActivity, detailForWindow(window), sampleRoadmap());
  assert.match(digest, /Roadmap status \(verified/);
  assert.match(digest, /Checkout v2 \(web\): 7\/10 closed \(70%\), advanced, \+2 closed this window/);
  assert.match(digest, /Roadmap rollup: 1 tracked, 0 completed, 1 advanced, 0 stalled, 0 at-risk/);
});

test('summarize carries the roadmap + grounded statusVsPlan when a roadmap is given', async () => {
  const record: { params?: CreateMessageParams } = {};
  const standup = await summarize(sampleActivity, {
    create: fakeCreate(
      { projectSummary: 's', people: [], statusVsPlan: 'Checkout v2 advanced; on track.' },
      record,
    ),
    roadmap: sampleRoadmap(),
  });
  // the roadmap reached the model, and it was asked for statusVsPlan
  assert.match(record.params!.messages[0]!.content, /Roadmap status \(verified/);
  assert.match(record.params!.messages[0]!.content, /ROADMAP —/);
  // the standup carries both the model narrative and the mechanical roadmap
  assert.equal(standup.statusVsPlan, 'Checkout v2 advanced; on track.');
  assert.equal(standup.roadmap?.items.length, 1);
});

test('summarize drops statusVsPlan when no roadmap is given', async () => {
  const standup = await summarize(sampleActivity, {
    create: fakeCreate({ projectSummary: 's', people: [], statusVsPlan: 'should be ignored' }),
  });
  assert.equal(standup.statusVsPlan, undefined);
  assert.equal(standup.roadmap, undefined);
});

test('summarize throws if the model returns no tool call', async () => {
  const create: MessagesCreate = async () => ({
    content: [{ type: 'text', text: 'I cannot.' }],
  });
  await assert.rejects(() => summarize(sampleActivity, { create }), /did not call emit_standup/);
});
