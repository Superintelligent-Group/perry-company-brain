import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPromotionPR, renderMechanical, renderStandup, sparkline, windowLabel } from './render.js';
import type {
  CommitActivity,
  OrgActivity,
  PersonActivity,
  PullRequestActivity,
  Standup,
  TeamStats,
} from './types.js';

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

function commit(over: Partial<CommitActivity> = {}): CommitActivity {
  return {
    repo: 'web',
    sha: Math.random().toString(36).slice(2),
    message: 'do a thing',
    additions: 10,
    deletions: 2,
    url: 'https://gh/web/commit/x',
    authoredAt: window.until,
    unshipped: false,
    ...over,
  };
}

function pr(over: Partial<PullRequestActivity> = {}): PullRequestActivity {
  const number = over.number ?? 1;
  return {
    repo: 'web',
    number,
    title: 'Add feature',
    state: 'merged',
    additions: 10,
    deletions: 1,
    url: `https://gh/web/pull/${number}`,
    createdAt: window.since,
    mergedAt: window.until,
    ...over,
  };
}

test('isPromotionPR flags promotion/merge PRs, not features', () => {
  assert.ok(isPromotionPR('Staging'));
  assert.ok(isPromotionPR('staging → main'));
  assert.ok(isPromotionPR('Promote: pnpm migration + sidebar fix'));
  assert.ok(isPromotionPR('Merge chat overhaul into experimental-local'));
  assert.equal(isPromotionPR('feat(billing): differentiate tiers'), false);
  assert.equal(isPromotionPR('Add llm_thread clip type'), false);
});

test('windowLabel matches the window length', () => {
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}T00:00:00.000Z`;
  assert.equal(windowLabel({ since: day(29), until: day(30) }), 'Daily Standup');
  assert.equal(windowLabel({ since: day(27), until: day(30) }), '3-Day Standup');
  assert.equal(windowLabel({ since: day(23), until: day(30) }), 'Weekly Standup');
  assert.match(windowLabel({ since: '2026-05-30T00:00:00.000Z', until: '2026-05-30T06:00:00.000Z' }), /6h/);
});

test('renderMechanical titles a 3-day window as 3-Day Standup, not Daily', () => {
  const md = renderMechanical({
    org: 'Acme',
    window: { since: '2026-05-27T00:00:00.000Z', until: '2026-05-30T00:00:00.000Z' },
    people: [],
  });
  assert.match(md, /# 📋 3-Day Standup — Acme/);
});

test('renderMechanical shows an empty-window message', () => {
  const activity: OrgActivity = { org: 'Acme', window, people: [] };
  const md = renderMechanical(activity);
  assert.match(md, /# 📋 Daily Standup — Acme/);
  assert.match(md, /No GitHub activity/);
});

test('renderMechanical shows a shipped feature PR but hides promotion PRs', () => {
  const p = person('dev', {
    pullRequests: [
      pr({ number: 42, title: 'Add login' }),
      pr({ number: 43, title: 'Staging' }),
    ],
    totals: { ...emptyTotals(), prsMerged: 2 },
  });
  const md = renderMechanical({ org: 'Acme', window, people: [p] });
  assert.match(md, /shipped \[#42\]\(https:\/\/gh\/web\/pull\/42\) Add login/);
  assert.doesNotMatch(md, /#43/); // promotion PR filtered from highlights
});

test('renderMechanical surfaces unshipped commits with branch + stat', () => {
  const p = person('dev', {
    commits: [
      commit({ message: 'wip: new parser', unshipped: true, branch: 'feat/parser' }),
      commit({ message: 'tidy imports', unshipped: false }),
    ],
    totals: { ...emptyTotals(), commits: 2, unshippedCommits: 1 },
  });
  const md = renderMechanical({ org: 'Acme', window, people: [p] });
  assert.match(md, /2 commits \(1 unshipped\)/);
  assert.match(md, /🔧 wip: new parser `web@feat\/parser`/);
});

test('renderMechanical dedupes repeated commit messages (rebases)', () => {
  const p = person('dev', {
    commits: [
      commit({ message: 'same change', sha: 'a' }),
      commit({ message: 'same change', sha: 'b' }),
    ],
    totals: { ...emptyTotals(), commits: 2 },
  });
  const md = renderMechanical({ org: 'Acme', window, people: [p] });
  assert.equal(md.match(/same change/g)?.length, 1);
});

test('renderStandup renders the project summary and per-person narratives', () => {
  const standup: Standup = {
    org: 'Acme',
    window,
    projectSummary: 'The team shipped login and is mid-way on the parser.',
    people: [
      {
        person: { login: 'alice', displayName: 'Alice', emails: [] },
        narrative: 'Shipped login (#42) and is working on a new parser.',
        work: [{ repo: 'web', points: ['#42 Add login'] }],
      },
    ],
  };
  const md = renderStandup(standup);
  assert.match(md, /# 📋 Daily Standup — Acme/);
  assert.match(md, /The team shipped login and is mid-way on the parser\./);
  assert.match(md, /## Alice \(`alice`\)/);
  assert.match(md, /Shipped login \(#42\) and is working on a new parser\./);
  assert.match(md, /- #42 Add login/);
  assert.doesNotMatch(md, /\*\*web\*\*/); // single repo → no repo subheader
  assert.match(md, /AI-summarized/);
});

function standupWithStats(): Standup {
  return {
    org: 'Acme',
    window: { since: '2026-05-23T00:00:00.000Z', until: '2026-05-30T00:00:00.000Z' },
    projectSummary: 'Busy week.',
    teamTotals: {
      contributors: 2,
      commits: 40,
      unshippedCommits: 12,
      prsOpened: 9,
      prsMerged: 7,
      reviews: 3,
      issuesOpened: 0,
      issuesClosed: 0,
      repos: 2,
      additions: 12345,
      deletions: 678,
      reverts: 2,
      revertRate: 2 / 40,
      medianPrCycleHours: 30,
      medianTimeToFirstReviewHours: 3,
      prSizes: { xs: 3, s: 5, m: 2, l: 1, xl: 1 },
      dailyCommits: [4, 8, 6, 10, 5, 4, 3],
    },
    people: [
      {
        person: { login: 'dev', displayName: 'Dev', emails: [] },
        narrative: 'Did things.',
        work: [],
        totals: {
          commits: 30,
          unshippedCommits: 12,
          additions: 12000,
          deletions: 600,
          prsOpened: 5,
          prsMerged: 4,
          reviewsGiven: 3,
          issuesOpened: 0,
          issuesClosed: 0,
          repos: 2,
        },
      },
    ],
  };
}

test('renderStandup shows the team stats panel only when enabled', () => {
  const s = standupWithStats();
  assert.doesNotMatch(renderStandup(s), /Team stats/); // default off
  const withStats = renderStandup(s, { showStats: true });
  assert.match(withStats, /### 📊 Team stats — this week/);
  assert.match(withStats, /\*\*7\*\* PRs merged, \*\*9\*\* opened/);
  assert.match(withStats, /median PR cycle time: \*\*30h\*\* \(open → merged\)/);
  assert.match(withStats, /median time to first review: \*\*3h\*\*/);
  // 12 sized PRs, 8 small (xs+s) → 67%, with a distribution sparkline
  assert.match(withStats, /PR size `▅█▄▂▂` \(XS→XL\): \*\*67%\*\* small \(<100 lines\) — XS 3 · S 5 · M 2 · L 1 · XL 1/);
  assert.match(withStats, /\*\*40\*\* commits \(\*\*12\*\* unshipped\)/);
  // daily-activity sparkline: [4,8,6,10,5,4,3] scaled to max 10
  assert.match(withStats, /commits\/day `▄▇▅█▅▄▃` _\(oldest → newest\)_/);
  assert.match(withStats, /\*\*2\*\* reverts \(\*\*5\.0%\*\* of commits\)/);
  assert.match(withStats, /size, not score/);
});

test('sparkline maps values onto the 8-level block ramp, scaled to the max', () => {
  assert.equal(sparkline([0, 0, 0]), ''); // all zero → empty
  assert.equal(sparkline([1]), '█'); // single value is its own max
  assert.equal(sparkline([3, 5, 2, 1, 1]), '▅█▄▂▂');
});

test('renderStandup shows week-over-week trend arrows when prevStats is given', () => {
  const s = standupWithStats();
  const prev: TeamStats = {
    ...s.teamTotals!,
    prsMerged: 5,
    prsOpened: 9,
    medianPrCycleHours: 36,
    medianTimeToFirstReviewHours: 2,
    commits: 30,
  };
  const md = renderStandup(s, { showStats: true, prevStats: prev });
  assert.match(md, /Team stats — this week · trend vs previous period/);
  assert.match(md, /\*\*7\*\* PRs merged \(↑2\), \*\*9\*\* opened \(→\)/);
  assert.match(md, /median PR cycle time: \*\*30h\*\* \(↓6h\) \(open → merged\)/); // faster
  assert.match(md, /median time to first review: \*\*3h\*\* \(↑1h\)/); // slower
  assert.match(md, /\*\*40\*\* commits \(↑10\)/);
});

test('renderStandup adds a per-person stat line only with statsPerPerson', () => {
  const s = standupWithStats();
  assert.doesNotMatch(renderStandup(s, { showStats: true }), /30 commits/);
  const perPerson = renderStandup(s, { statsPerPerson: true });
  assert.match(perPerson, /\*30 commits \(12 unshipped\) · PRs: 4 merged\/5 opened · 3 reviews/);
});

test('renderStandup shows repo subheaders only when a person spans >1 repo', () => {
  const md = renderStandup({
    org: 'Acme',
    window,
    projectSummary: '',
    people: [
      {
        person: { login: 'multi', displayName: 'Multi', emails: [] },
        narrative: '',
        work: [
          { repo: 'web', points: ['#1 ship a thing'] },
          { repo: 'mobile', points: ['#2 bump version'] },
        ],
      },
      {
        person: { login: 'solo', displayName: 'Solo', emails: [] },
        narrative: '',
        work: [{ repo: 'web', points: ['#3 fix a bug'] }],
      },
    ],
  });
  // multi-repo person gets headers + grouped bullets
  assert.match(md, /## Multi[\s\S]*\*\*web\*\*\n- #1 ship a thing[\s\S]*\*\*mobile\*\*\n- #2 bump version/);
  // solo person's single repo gets no header
  assert.match(md, /## Solo \(`solo`\)\n- #3 fix a bug/);
});

test('renderStandup handles an empty window', () => {
  const md = renderStandup({ org: 'Acme', window, projectSummary: '', people: [] });
  assert.match(md, /# 📋 Daily Standup — Acme/);
  assert.match(md, /No GitHub activity/);
});

test('renderStandup shows the status-vs-plan section with narrative + milestone panel', () => {
  const md = renderStandup({
    org: 'Acme',
    window,
    projectSummary: 'Busy.',
    people: [],
    statusVsPlan: 'Checkout advanced this week; Search is overdue and needs attention.',
    roadmap: {
      items: [
        {
          item: { id: 'm1', kind: 'milestone', title: 'Checkout v2', url: 'u', repo: 'web', openCount: 3, closedCount: 7, state: 'open' },
          movement: 'advanced',
          closedThisWindow: 2,
          progress: 0.7,
          atRisk: false,
        },
        {
          item: { id: 'm2', kind: 'milestone', title: 'Search', url: 'u', repo: 'web', openCount: 7, closedCount: 1, state: 'open' },
          movement: 'stalled',
          closedThisWindow: 0,
          progress: 0.125,
          atRisk: true,
          note: '9 days overdue',
        },
      ],
      unplanned: { closedIssues: 3 },
      totals: { tracked: 2, completed: 0, advanced: 1, stalled: 1, atRisk: 1 },
    },
  });
  assert.match(md, /## 📍 Status vs plan/);
  assert.match(md, /Checkout advanced this week; Search is overdue/);
  assert.match(md, /- \*\*Checkout v2\*\* — 7\/10 \(70%\) · 📈 advanced \(\+2 this period\)/);
  assert.match(md, /- \*\*Search\*\* — 1\/8 \(13%\) · 🛑 stalled · ⚠️ 9 days overdue/);
  assert.match(md, /3 issues closed outside any tracked milestone/);
});

test('renderStandup omits the status section when there is no roadmap', () => {
  const md = renderStandup({ org: 'Acme', window, projectSummary: 'x', people: [] });
  assert.doesNotMatch(md, /Status vs plan/);
});

test('renderMechanical uses displayName when it differs from login', () => {
  const p = person('ghlogin', {
    person: { login: 'ghlogin', displayName: 'Real Name', emails: [] },
    totals: { ...emptyTotals(), commits: 1 },
  });
  const md = renderMechanical({ org: 'Acme', window, people: [p] });
  assert.match(md, /## Real Name \(`ghlogin`\)/);
});
