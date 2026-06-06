import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, reconcileDeclared, type ReconcileOptions } from './reconcile.js';
import type { MilestoneRecord } from './github.js';
import type { DeclaredGoal } from './roadmap-md.js';
import type { IssueActivity, Window } from './types.js';

const now = new Date('2026-06-03T00:00:00.000Z');
const window: Window = { since: '2026-05-27T00:00:00.000Z', until: '2026-06-03T00:00:00.000Z' };

function ms(over: Partial<MilestoneRecord> = {}): MilestoneRecord {
  return {
    repo: 'web',
    number: 1,
    title: 'Milestone',
    url: 'https://gh/web/milestone/1',
    state: 'open',
    openIssues: 5,
    closedIssues: 5,
    ...over,
  };
}

function iss(over: Partial<IssueActivity> = {}): IssueActivity {
  return {
    repo: 'web',
    number: 10,
    title: 'an issue',
    state: 'closed',
    action: 'closed',
    url: 'https://gh/web/issues/10',
    at: window.until,
    ...over,
  };
}

function run(
  milestones: MilestoneRecord[],
  issues: IssueActivity[],
  opts: Partial<ReconcileOptions> = {},
) {
  return reconcile({ milestones, issues, window }, { atRiskDays: 7, now, ...opts });
}

test('advanced: open milestone with sub-issues closed in-window', () => {
  const r = run(
    [ms({ number: 1, title: 'Checkout', openIssues: 3, closedIssues: 7 })],
    [iss({ milestoneNumber: 1 }), iss({ milestoneNumber: 1, number: 11 })],
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0]!.movement, 'advanced');
  assert.equal(r.items[0]!.closedThisWindow, 2);
  assert.equal(r.items[0]!.progress, 0.7);
  assert.equal(r.items[0]!.atRisk, false);
  assert.equal(r.items[0]!.item.id, 'milestone:web#1');
});

test('completed: all sub-issues closed (progress 1) with a closure in-window', () => {
  const r = run([ms({ number: 2, openIssues: 0, closedIssues: 5 })], [iss({ milestoneNumber: 2 })]);
  assert.equal(r.items[0]!.movement, 'completed');
  assert.equal(r.items[0]!.progress, 1);
});

test('in-progress: touched (issue opened) but no closures', () => {
  const r = run(
    [ms({ number: 3, openIssues: 4, closedIssues: 1 })],
    [iss({ milestoneNumber: 3, action: 'opened' })],
  );
  assert.equal(r.items[0]!.movement, 'in-progress');
  assert.equal(r.items[0]!.closedThisWindow, 0);
});

test('stalled + overdue: open work, past due, no activity', () => {
  const r = run([ms({ number: 4, openIssues: 4, closedIssues: 0, dueOn: '2026-05-25T00:00:00.000Z' })], []);
  assert.equal(r.items[0]!.movement, 'stalled');
  assert.equal(r.items[0]!.atRisk, true);
  assert.match(r.items[0]!.note ?? '', /9 days overdue/);
});

test('untouched: open work, no due date, no activity', () => {
  const r = run([ms({ number: 5, openIssues: 4, closedIssues: 1 })], []);
  assert.equal(r.items[0]!.movement, 'untouched');
  assert.equal(r.items[0]!.atRisk, false);
  assert.equal(r.items[0]!.note, undefined);
});

test('at-risk with an upcoming due date carries a "due in N days" note', () => {
  const r = run([ms({ number: 1, openIssues: 3, closedIssues: 1, dueOn: '2026-06-06T00:00:00.000Z' })], []);
  assert.equal(r.items[0]!.atRisk, true);
  assert.match(r.items[0]!.note ?? '', /due in 3 days · 3 open/);
});

test('irrelevant milestones (closed, done before the window, no activity) are dropped', () => {
  const r = run([ms({ number: 6, state: 'closed', openIssues: 0, closedIssues: 3 })], []);
  assert.equal(r.items.length, 0);
});

test('milestoneFilter tracks only matching titles', () => {
  const r = run(
    [
      ms({ number: 1, title: 'Checkout v2', openIssues: 2, closedIssues: 0 }),
      ms({ number: 2, title: 'Internal chores', openIssues: 2, closedIssues: 0 }),
    ],
    [],
    { milestoneFilter: 'checkout' },
  );
  assert.equal(r.items.length, 1);
  assert.match(r.items[0]!.item.title, /Checkout/);
});

test('issue closures with no milestone count as unplanned', () => {
  const r = run(
    [ms({ number: 1, openIssues: 1, closedIssues: 0 })],
    [iss({ action: 'closed' }), iss({ number: 99, action: 'closed' })],
  );
  assert.equal(r.unplanned.closedIssues, 2);
});

test('at-risk items sort ahead of calm ones', () => {
  const r = run(
    [
      ms({ number: 1, title: 'Calm', openIssues: 2, closedIssues: 8 }),
      ms({ number: 2, title: 'Urgent', openIssues: 5, closedIssues: 0, dueOn: '2026-06-04T00:00:00.000Z' }),
    ],
    [],
  );
  assert.equal(r.items[0]!.item.title, 'Urgent');
  assert.equal(r.items[1]!.item.title, 'Calm');
});

test('totals roll up movements and at-risk count', () => {
  const r = run(
    [
      ms({ number: 1, title: 'A', openIssues: 2, closedIssues: 3 }),
      ms({ number: 2, title: 'B', openIssues: 0, closedIssues: 4 }),
      ms({ number: 3, title: 'C', openIssues: 3, closedIssues: 0, dueOn: '2026-05-20T00:00:00.000Z' }),
    ],
    [iss({ milestoneNumber: 1 }), iss({ milestoneNumber: 2, number: 20 })],
  );
  assert.equal(r.totals.tracked, 3);
  assert.equal(r.totals.advanced, 1);
  assert.equal(r.totals.completed, 1);
  assert.equal(r.totals.stalled, 1);
  assert.equal(r.totals.atRisk, 1);
});

// ── reconcileDeclared (ROADMAP.md source) ──

function goal(over: Partial<DeclaredGoal> = {}): DeclaredGoal {
  return { title: 'Goal', openCount: 1, closedCount: 1, ...over };
}

function runDeclared(goals: DeclaredGoal[], opts: Partial<ReconcileOptions> = {}, sourceUrl?: string) {
  return reconcileDeclared({ goals, sourceUrl }, { atRiskDays: 7, now, ...opts });
}

test('declared: all tasks checked → completed, progress 1, state closed', () => {
  const r = runDeclared([goal({ title: 'Launch', openCount: 0, closedCount: 4 })]);
  assert.equal(r.items[0]!.movement, 'completed');
  assert.equal(r.items[0]!.progress, 1);
  assert.equal(r.items[0]!.item.state, 'closed');
  assert.equal(r.items[0]!.item.kind, 'goal');
});

test('declared: some tasks checked, no due → in-progress', () => {
  const r = runDeclared([goal({ openCount: 3, closedCount: 1 })]);
  assert.equal(r.items[0]!.movement, 'in-progress');
  assert.equal(r.items[0]!.closedThisWindow, 0); // a static file carries no window signal
});

test('declared: no tasks checked, no due → untouched', () => {
  const r = runDeclared([goal({ openCount: 2, closedCount: 0 })]);
  assert.equal(r.items[0]!.movement, 'untouched');
});

test('declared: open work + a near due date → at-risk + stalled, with a note', () => {
  const r = runDeclared([goal({ openCount: 2, closedCount: 1, dueOn: '2026-06-05' })]);
  assert.equal(r.items[0]!.atRisk, true);
  assert.equal(r.items[0]!.movement, 'stalled');
  assert.match(r.items[0]!.note!, /due in 2 days · 2 open/);
});

test('declared: a goal with no tasks is dropped', () => {
  const r = runDeclared([goal({ openCount: 0, closedCount: 0 })]);
  assert.equal(r.items.length, 0);
  assert.equal(r.totals.tracked, 0);
});

test('declared: milestoneFilter matches goal titles', () => {
  const r = runDeclared([goal({ title: 'Mobile' }), goal({ title: 'Web' })], { milestoneFilter: 'web' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0]!.item.title, 'Web');
});

test('declared: sourceUrl is applied as each item link; unplanned is always 0', () => {
  const r = runDeclared([goal()], {}, 'https://gh/web/blob/main/ROADMAP.md');
  assert.equal(r.items[0]!.item.url, 'https://gh/web/blob/main/ROADMAP.md');
  assert.equal(r.unplanned.closedIssues, 0);
});
