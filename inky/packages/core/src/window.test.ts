import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow } from './window.js';

test('resolveWindow: explicit --since + --until is the exact window', () => {
  const r = resolveWindow({ since: '2026-06-01', until: '2026-06-02' });
  assert.equal(r.windowEnd?.toISOString(), '2026-06-02T00:00:00.000Z');
  assert.equal(r.windowHours, 24);
});

test('resolveWindow: --until with a length ends at until, keeps the length', () => {
  const r = resolveWindow({ until: '2026-06-02', windowHours: 48 });
  assert.equal(r.windowEnd?.toISOString(), '2026-06-02T00:00:00.000Z');
  assert.equal(r.windowHours, 48);
});

test('resolveWindow: --since only runs to now (length derived, end stays live)', () => {
  const r = resolveWindow({ since: '2026-06-01', now: new Date('2026-06-03T00:00:00.000Z') });
  assert.equal(r.windowEnd, undefined); // no --until → collect uses live now
  assert.equal(r.windowHours, 48);
});

test('resolveWindow: length-only passes through unchanged', () => {
  const r = resolveWindow({ windowHours: 24 });
  assert.equal(r.windowEnd, undefined);
  assert.equal(r.windowHours, 24);
});

test('resolveWindow: --since overrides a given length', () => {
  const r = resolveWindow({ since: '2026-06-01', until: '2026-06-02', windowHours: 999 });
  assert.equal(r.windowHours, 24);
});

test('resolveWindow: an invalid date is rejected', () => {
  assert.throws(() => resolveWindow({ until: 'not-a-date' }), /invalid date/);
});

test('resolveWindow: --since after --until is rejected', () => {
  assert.throws(
    () => resolveWindow({ since: '2026-06-02', until: '2026-06-01' }),
    /must be before/,
  );
});
