/**
 * GitHub authentication — choose between a personal access token (the self-host
 * MVP default) and a GitHub App installation, and build an authenticated Octokit.
 *
 * Why a GitHub App: per-org install with fine-grained permissions, higher rate
 * limits, no 90-day PAT expiry, and clean revoke (uninstall). It's also the
 * auth foundation the future hosted tier reuses — there the same `app` mode just
 * carries per-tenant installation ids instead of one from config.
 *
 * The *selection* logic is pure (`selectGitHubAuth`) so it's unit-tested without
 * the network; the Octokit *construction* (`resolveOctokit`) is a thin live layer,
 * exercised against the real API like the rest of the GitHub data layer.
 */
import { createHash } from 'node:crypto';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import type { Config, Secrets } from './config.js';
import { USER_AGENT, makeOctokit } from './github.js';

/** The resolved auth strategy: a token, or a GitHub App installation. */
type GitHubAuth =
  | { mode: 'pat'; token: string }
  | { mode: 'app'; appId: string; privateKey: string; installationId?: number };

/**
 * Decide how to authenticate, purely from config + secrets:
 *   - An **app id** (config `github.appId`, else env `GITHUB_APP_ID`) is the signal
 *     of intent to use the App. With one set, a missing or non-PEM private key is a
 *     misconfiguration and throws — we do NOT silently fall back to a PAT, which may
 *     carry broader scopes than the App.
 *   - Otherwise a PAT (`GITHUB_TOKEN` / `GH_TOKEN`).
 *   - Otherwise throw — no credentials at all.
 */
export function selectGitHubAuth(config: Config, secrets: Secrets): GitHubAuth {
  const appId = config.github.appId ?? secrets.githubAppId;
  const privateKey = secrets.githubAppPrivateKey;

  if (appId) {
    if (!privateKey) {
      throw new Error(
        `GitHub App id is configured for "${config.org}" but no private key was loaded. ` +
          'Set GITHUB_APP_PRIVATE_KEY (inline PEM) or a readable GITHUB_APP_PRIVATE_KEY_PATH ' +
          '(a configured path that is missing or unreadable reads as "no key"). ' +
          'See docs/github-app-setup.md.',
      );
    }
    if (!privateKey.includes('-----BEGIN')) {
      throw new Error(
        'The GitHub App private key does not look like a PEM (no "-----BEGIN ... PRIVATE KEY-----" ' +
          'header). Check GITHUB_APP_PRIVATE_KEY / GITHUB_APP_PRIVATE_KEY_PATH holds the full key. ' +
          'See docs/github-app-setup.md.',
      );
    }
    return { mode: 'app', appId, privateKey, installationId: config.github.installationId };
  }

  if (secrets.githubToken) return { mode: 'pat', token: secrets.githubToken };

  throw new Error(
    'No GitHub credentials. Set GITHUB_TOKEN (a PAT / fine-grained token with repo read), ' +
      'or configure a GitHub App: github.appId (or GITHUB_APP_ID) plus a private key ' +
      '(GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH). ' +
      'See docs/github-token-setup.md / docs/github-app-setup.md.',
  );
}

/**
 * A stable cache key for one authenticated client, derived from the auth identity
 * (NOT the window or the call site). PAT mode keys on a *hash* of the token — the raw
 * bearer credential never lives in the Map's key set (heap dumps, any future cache
 * introspection), which matters most for the Phase 6 multi-tenant cache that holds
 * many tenants' tokens at once. App mode keys on appId + the installation — pinned by
 * id, or per-org when the id is auto-discovered (the lookup is per-org, so the resolved
 * installation client is reused under the org key; the org is lowercased because GitHub
 * slugs are case-insensitive, so case-variant config doesn't make duplicate clients).
 *
 * Deliberately omits the private key: a cached App client holds the key for minting and
 * does NOT self-heal if the key is rotated or revoked (it keeps minting with the old key
 * until it 401s), so picking up a new key requires a process restart — which matches how
 * secrets load once at startup today. See docs/planning/phase6-design.md (client-cache).
 */
function clientCacheKey(auth: GitHubAuth, org: string): string {
  if (auth.mode === 'pat') return `pat:${createHash('sha256').update(auth.token).digest('hex')}`;
  return auth.installationId !== undefined
    ? `app:${auth.appId}:inst:${auth.installationId}`
    : `app:${auth.appId}:org:${org.toLowerCase()}`;
}

/**
 * One authenticated Octokit per auth identity. @octokit/auth-app auto-refreshes the
 * short-lived installation token inside a cached client, so a cached client stays
 * valid indefinitely — there's no reason to rebuild it (or re-run the installation
 * lookup) per call. This is the single-tenant form of the Phase 6 per-installation
 * client cache (the worker keys the same map by installation id, evicting on
 * uninstall). Promises are cached so concurrent callers share one in-flight build;
 * a rejected build is evicted so a later retry (e.g. after installing the App) works.
 */
const clientCache = new Map<string, Promise<Octokit>>();

/** Drop all cached clients. For tests, and for a future config/secret reload. */
export function clearOctokitCache(): void {
  clientCache.clear();
}

/**
 * Resolve an authenticated Octokit for the configured org, memoized by auth identity
 * (see {@link clientCacheKey}). PAT mode is the same single-token client as before;
 * App mode uses Octokit's app-auth strategy, which mints and auto-refreshes
 * short-lived installation tokens. When no `installationId` is pinned, it's looked up
 * from the org **once** per identity (and logged so it can be pinned).
 *
 * collect()/collectRoadmap()/collectDeclaredRoadmap() each call this, and the worker
 * calls them every scheduled tick — the cache means one client (and one lookup) per
 * identity across all of that, not one per call.
 */
export async function resolveOctokit(
  config: Config,
  secrets: Secrets,
  log: (msg: string) => void = () => {},
  /** Injectable constructor seam — tests pass a fake to exercise the cache/eviction. */
  build: (auth: GitHubAuth, org: string, log: (msg: string) => void) => Promise<Octokit> = buildOctokit,
): Promise<Octokit> {
  const auth = selectGitHubAuth(config, secrets);
  const key = clientCacheKey(auth, config.org);
  const cached = clientCache.get(key);
  if (cached) return cached;
  const built = build(auth, config.org, log);
  clientCache.set(key, built);
  // Evict a failed build so a retry (e.g. after installing the App) isn't stuck on a
  // sticky rejected promise. Attaching this handler also marks `built` as handled, so a
  // concurrent cache-hit caller that doesn't await won't trip an unhandledRejection —
  // the awaiting caller(s) still receive the rejection from the returned promise.
  built.catch(() => clientCache.delete(key));
  return built;
}

/** Construct the authenticated client (no caching — that's {@link resolveOctokit}). */
async function buildOctokit(
  auth: GitHubAuth,
  org: string,
  log: (msg: string) => void,
): Promise<Octokit> {
  if (auth.mode === 'pat') return makeOctokit(auth.token);

  let installationId = auth.installationId;
  if (installationId === undefined) {
    // A temporary app-level (JWT) client, only to discover the org's installation;
    // the client returned below is installation-scoped with the resolved id.
    const appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: auth.appId, privateKey: auth.privateKey },
      userAgent: USER_AGENT,
    });
    try {
      const { data } = await appOctokit.rest.apps.getOrgInstallation({ org });
      installationId = data.id;
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        throw new Error(
          `The GitHub App isn't installed on "${org}" (or can't see it). Open the App's ` +
            'settings → Install App → install it on the org and grant repo access. ' +
            'See docs/github-app-setup.md (step 3).',
        );
      }
      throw new Error(
        `Couldn't resolve the GitHub App installation for "${org}": ${(err as Error).message}`,
      );
    }
    log(
      `inky: using GitHub App installation ${installationId} for ${org} ` +
        '(pin it as github.installationId in config to skip this lookup)',
    );
  }
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: auth.appId, privateKey: auth.privateKey, installationId },
    userAgent: USER_AGENT,
  });
}
