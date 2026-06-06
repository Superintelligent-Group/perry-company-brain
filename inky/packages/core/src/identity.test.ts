import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityResolver, buildReverseAliasMap, extractLoginFromEmail } from './identity.js';

test('extractLoginFromEmail handles plain and id-prefixed noreply addresses', () => {
  assert.equal(extractLoginFromEmail('octocat@users.noreply.github.com'), 'octocat');
  assert.equal(extractLoginFromEmail('12345+octocat@users.noreply.github.com'), 'octocat');
  assert.equal(extractLoginFromEmail('Octocat@users.noreply.github.com'), 'octocat');
  assert.equal(extractLoginFromEmail('real@example.com'), null);
  assert.equal(extractLoginFromEmail(null), null);
});

test('buildReverseAliasMap lowercases and reverses the mapping', () => {
  const reverse = buildReverseAliasMap({ 'Alice-Work': ['AlicePersonal'] });
  assert.equal(reverse.get('alicepersonal'), 'alice-work');
});

test('resolver collapses an alias login into its canonical login', () => {
  const r = new IdentityResolver({ 'alice-work': ['alicepersonal'] });
  const a = r.resolve({ login: 'alice-work', name: 'Alice' });
  const b = r.resolve({ login: 'alicepersonal', name: 'Alice (personal)' });
  assert.equal(a, 'alice-work');
  assert.equal(b, 'alice-work');
  assert.equal(r.all().length, 1);
});

test('resolver collapses a personal email alias into the canonical login', () => {
  const r = new IdentityResolver({ 'bob-work': ['bob@bobs-macbook-pro.local'] });
  const key = r.resolve({ login: null, email: 'bob@Bobs-MacBook-Pro.local', name: 'Bob' });
  assert.equal(key, 'bob-work');
});

test('resolver prefers GitHub login over noreply-email extraction', () => {
  const r = new IdentityResolver({});
  const key = r.resolve({ login: 'realname', email: 'other@users.noreply.github.com' });
  assert.equal(key, 'realname');
});

test('resolver falls back to noreply-extracted login when API login is absent', () => {
  const r = new IdentityResolver({});
  const key = r.resolve({ login: null, email: '999+ghost@users.noreply.github.com' });
  assert.equal(key, 'ghost');
});

test('resolver merges emails and keeps the first real display name', () => {
  const r = new IdentityResolver({});
  r.resolve({ login: 'dev', email: 'a@example.com', name: 'Dev One' });
  r.resolve({ login: 'dev', email: 'b@example.com', name: 'Dev One (laptop)' });
  const person = r.get('dev');
  assert.ok(person);
  assert.deepEqual(person.emails.sort(), ['a@example.com', 'b@example.com']);
  assert.equal(person.displayName, 'Dev One');
});
