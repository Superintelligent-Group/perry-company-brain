import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { ConfigSchema, loadSecrets, type Secrets } from './config.js';
import type { Octokit } from '@octokit/rest';
import { clearOctokitCache, resolveOctokit, selectGitHubAuth } from './github-auth.js';

const cfg = (over: Record<string, unknown> = {}) => ConfigSchema.parse({ org: 'your-org', ...over });
const secrets = (over: Partial<Secrets> = {}): Secrets => ({ githubToken: '', ...over });

// A PEM-shaped placeholder is enough for the selector (it only checks the header).
const FAKE_PEM = '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----';
// A real key, for exercising resolveOctokit's actual Octokit construction.
const REAL_PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

test('PAT mode when only a token is set', () => {
  const auth = selectGitHubAuth(cfg(), secrets({ githubToken: 'ghp_x' }));
  assert.deepEqual(auth, { mode: 'pat', token: 'ghp_x' });
});

test('App mode when an app id + private key are set (App wins over a PAT)', () => {
  const auth = selectGitHubAuth(
    cfg({ github: { appId: '123', installationId: 456 } }),
    secrets({ githubToken: 'ghp_x', githubAppPrivateKey: FAKE_PEM }),
  );
  assert.deepEqual(auth, { mode: 'app', appId: '123', privateKey: FAKE_PEM, installationId: 456 });
});

test('app id falls back to the GITHUB_APP_ID env value; installationId stays optional', () => {
  const auth = selectGitHubAuth(cfg(), secrets({ githubAppId: '999', githubAppPrivateKey: FAKE_PEM }));
  assert.equal(auth.mode, 'app');
  if (auth.mode !== 'app') return;
  assert.equal(auth.appId, '999');
  assert.equal(auth.installationId, undefined);
});

test('config.github.appId takes precedence over GITHUB_APP_ID', () => {
  const auth = selectGitHubAuth(
    cfg({ github: { appId: 'cfg' } }),
    secrets({ githubAppId: 'env', githubAppPrivateKey: FAKE_PEM }),
  );
  assert.equal(auth.mode, 'app');
  if (auth.mode !== 'app') return;
  assert.equal(auth.appId, 'cfg');
});

test('an app id WITHOUT a private key throws — no silent PAT fallback (even when a PAT is set)', () => {
  assert.throws(
    () => selectGitHubAuth(cfg({ github: { appId: '123' } }), secrets({ githubToken: 'ghp_x' })),
    /no private key was loaded/,
  );
});

test('an app id with a non-PEM private key throws', () => {
  assert.throws(
    () => selectGitHubAuth(cfg({ github: { appId: '123' } }), secrets({ githubAppPrivateKey: 'not-a-key' })),
    /does not look like a PEM/,
  );
});

test('a private key with no app id anywhere falls back to PAT', () => {
  const auth = selectGitHubAuth(cfg(), secrets({ githubToken: 'ghp_x', githubAppPrivateKey: FAKE_PEM }));
  assert.deepEqual(auth, { mode: 'pat', token: 'ghp_x' });
});

test('throws when no credentials are configured', () => {
  assert.throws(() => selectGitHubAuth(cfg(), secrets()), /No GitHub credentials/);
});

test('loadSecrets un-escapes \\n in an inline GITHUB_APP_PRIVATE_KEY', () => {
  const s = loadSecrets({ GITHUB_APP_PRIVATE_KEY: '-----BEGIN-----\\nabc\\n-----END-----' });
  assert.equal(s.githubAppPrivateKey, '-----BEGIN-----\nabc\n-----END-----');
});

test('loadSecrets reads GITHUB_APP_PRIVATE_KEY_PATH from a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inky-key-'));
  const file = join(dir, 'key.pem');
  writeFileSync(file, 'PEM-FROM-FILE');
  const s = loadSecrets({ GITHUB_APP_PRIVATE_KEY_PATH: file });
  assert.equal(s.githubAppPrivateKey, 'PEM-FROM-FILE');
});

test('inline GITHUB_APP_PRIVATE_KEY wins over GITHUB_APP_PRIVATE_KEY_PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inky-key-'));
  const file = join(dir, 'key.pem');
  writeFileSync(file, 'FROM-FILE');
  const s = loadSecrets({ GITHUB_APP_PRIVATE_KEY: 'INLINE', GITHUB_APP_PRIVATE_KEY_PATH: file });
  assert.equal(s.githubAppPrivateKey, 'INLINE');
});

test('loadSecrets does NOT throw on an unreadable key path — stays safe for setup-only commands', () => {
  let s: Secrets | undefined;
  assert.doesNotThrow(() => {
    s = loadSecrets({ GITHUB_APP_PRIVATE_KEY_PATH: '/no/such/inky-key.pem' });
  });
  assert.equal(s?.githubAppPrivateKey, undefined);
});

test('resolveOctokit builds an App-auth Octokit when an installation id is pinned (no network)', async () => {
  const octokit = await resolveOctokit(
    cfg({ github: { appId: '123', installationId: 456 } }),
    secrets({ githubAppPrivateKey: REAL_PEM }),
  );
  // Constructed lazily — no token is minted until the first API call, so this
  // never touches the network.
  assert.ok(octokit.rest.repos);
});

test('resolveOctokit returns a plain PAT client in token mode', async () => {
  const octokit = await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_x' }));
  assert.ok(octokit.rest.repos);
});

test('resolveOctokit memoizes one client per auth identity (the H3 fix)', async () => {
  clearOctokitCache();
  const c = cfg({ github: { appId: '777', installationId: 42 } });
  const s = secrets({ githubAppPrivateKey: REAL_PEM });
  const a = await resolveOctokit(c, s);
  const b = await resolveOctokit(c, s);
  // Same identity → same cached instance (no rebuild, no re-lookup per call).
  assert.equal(a, b);
  // A different identity (different installation) → a distinct client.
  const other = await resolveOctokit(cfg({ github: { appId: '777', installationId: 99 } }), s);
  assert.notEqual(a, other);
});

test('clearOctokitCache forces a fresh client on the next resolve', async () => {
  clearOctokitCache();
  const a = await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_cache' }));
  assert.equal(a, await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_cache' })));
  clearOctokitCache();
  assert.notEqual(a, await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_cache' })));
});

test('different PAT tokens get distinct cached clients (no key collision)', async () => {
  clearOctokitCache();
  const a = await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_aaa' }));
  const b = await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_bbb' }));
  assert.notEqual(a, b);
  assert.equal(a, await resolveOctokit(cfg(), secrets({ githubToken: 'ghp_aaa' })));
});

test('a failed build is evicted, so a retry attempts a fresh build', async () => {
  clearOctokitCache();
  let calls = 0;
  const flaky = async (): Promise<Octokit> => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return { id: calls } as unknown as Octokit;
  };
  const c = cfg();
  const s = secrets({ githubToken: 'ghp_flaky' });
  await assert.rejects(resolveOctokit(c, s, undefined, flaky), /boom/);
  // The rejected promise was evicted, so the next call builds again rather than
  // returning the cached rejection.
  const ok = await resolveOctokit(c, s, undefined, flaky);
  assert.equal(calls, 2);
  assert.deepEqual(ok, { id: 2 });
});

test('concurrent callers share one in-flight build (no duplicate construction)', async () => {
  clearOctokitCache();
  let calls = 0;
  let release!: (o: Octokit) => void;
  const pending = new Promise<Octokit>((res) => {
    release = res;
  });
  const slow = (): Promise<Octokit> => {
    calls += 1;
    return pending;
  };
  const c = cfg();
  const s = secrets({ githubToken: 'ghp_slow' });
  const p1 = resolveOctokit(c, s, undefined, slow);
  const p2 = resolveOctokit(c, s, undefined, slow); // cache hit on the in-flight promise
  release({ shared: true } as unknown as Octokit);
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls, 1); // one build despite two callers
  assert.equal(a, b); // both get the same shared instance
});
