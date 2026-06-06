import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterStaleRepos, type RepoMeta } from './github.js';

const now = new Date('2026-06-03T00:00:00.000Z');
const windowSince = '2026-05-27T00:00:00.000Z'; // 7 days before now (a weekly window start)
const repos: RepoMeta[] = [
  { name: 'active', pushedAt: '2026-06-02T00:00:00.000Z' }, // 1 day ago
  { name: 'edge', pushedAt: '2026-05-04T00:00:00.000Z' }, // 30 days ago
  { name: 'stale', pushedAt: '2026-04-01T00:00:00.000Z' }, // ~63 days ago
  { name: 'never', pushedAt: null },
];

test('staleDays 0 keeps every repo', () => {
  const r = filterStaleRepos(repos, { staleDays: 0, now, windowSince });
  assert.deepEqual(r.kept, ['active', 'edge', 'stale', 'never']);
  assert.equal(r.skipped.length, 0);
});

test('staleDays N skips repos past the fixed cutoff (boundary inclusive)', () => {
  const r = filterStaleRepos(repos, { staleDays: 30, now, windowSince });
  // cutoff = May 4 00:00; "edge" sits exactly on it → kept; older ones skipped.
  assert.deepEqual(r.kept, ['active', 'edge']);
  assert.deepEqual(
    r.skipped.map((s) => s.name),
    ['stale', 'never'],
  );
});

test('staleDays "auto" skips repos with no push since the window started', () => {
  const r = filterStaleRepos(repos, { staleDays: 'auto', now, windowSince });
  // only "active" (Jun 2) was pushed on/after the window start (May 27).
  assert.deepEqual(r.kept, ['active']);
  assert.deepEqual(
    r.skipped.map((s) => s.name),
    ['edge', 'stale', 'never'],
  );
});

test('"auto" keeps a repo pushed exactly at the window start (inclusive)', () => {
  const r = filterStaleRepos([{ name: 'boundary', pushedAt: windowSince }], {
    staleDays: 'auto',
    now,
    windowSince,
  });
  assert.deepEqual(r.kept, ['boundary']);
});

test('filterStaleRepos treats a never-pushed repo as stale', () => {
  const r = filterStaleRepos([{ name: 'never', pushedAt: null }], { staleDays: 365, now, windowSince });
  assert.deepEqual(r.kept, []);
  assert.equal(r.skipped[0]!.name, 'never');
});
