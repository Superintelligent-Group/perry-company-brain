import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from './config.js';
import { includePerson } from './collect.js';

const cfg = (over: Record<string, unknown> = {}) => ConfigSchema.parse({ org: 'your-org', ...over });

test('includePerson: a normal login is included by default', () => {
  assert.equal(includePerson('alice', cfg()), true);
});

test('includePerson: a [bot] login is excluded when excludeBots (default)', () => {
  assert.equal(includePerson('dependabot[bot]', cfg()), false);
});

test('includePerson: a [bot] login is kept when excludeBots is off', () => {
  assert.equal(includePerson('dependabot[bot]', cfg({ excludeBots: false })), true);
});

test('includePerson: an opted-out login is excluded (case-insensitive)', () => {
  const c = cfg({ excludePeople: ['Carol'] });
  assert.equal(includePerson('carol', c), false);
  assert.equal(includePerson('CAROL', c), false);
  assert.equal(includePerson('alice', c), true);
});

test('includePerson: opt-out works even when bot exclusion is off', () => {
  assert.equal(includePerson('carol', cfg({ excludeBots: false, excludePeople: ['carol'] })), false);
});
