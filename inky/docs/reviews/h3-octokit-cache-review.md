---
created: 2026-06-04
status: active
author: code-reviewer agent (triaged by Claude main session)
branch: main
informed_by: review of the H3 fix in commit 0831e7a (memoized resolveOctokit); fixes applied in the follow-up commit. Full original prose review was docs/temp/h3-octokit-cache-review.md (in git history).
notes: Triaged review of the H3 Octokit client-cache. No blocking issues; the two Mediums + the Low + the eviction-test gap were fixed in the follow-up. Kept for the lasting design reasoning (multi-tenant implications, the key-rotation/revocation failure mode).
---

# H3 Octokit cache — review triage

Reviewed commit `0831e7a` (the H3 fix: `resolveOctokit` → a process-wide memoized client
provider). Verdict: **no blocking issues** (0 Critical / 0 High). The caching logic was
judged correct and the design sound; the items below were the worthwhile hardening, all
**fixed in the follow-up** while the cache is still the simple single-tenant version
(it gets load-bearing once the Phase 6 multi-tenant cache reuses it). Tests 151 → **154**.

## Fixed

- [x] **M1 (Medium)** — PAT token was the literal cache-key string (`pat:<token>`), so the
  raw bearer credential lived in the Map's key set for process lifetime (heap dumps, future
  cache introspection). Worse in the Phase 6 multi-tenant cache (many tenants' tokens at
  once). Now keyed on `pat:<sha256(token)>`; the token stays only inside the Octokit that
  already holds it. App keys carry no secret material — unchanged.
- [x] **M2 (Medium)** — the rethrow-on-eviction (`.catch` delete + `throw`) left an
  unhandled-rejection window for a concurrent cache-hit caller that didn't await. Replaced
  with a non-rethrowing side-effect `built.catch(() => clientCache.delete(key))`: still
  evicts a failed build (so a retry rebuilds), and attaching the handler marks `built` as
  handled so a non-awaiting caller can't trip `unhandledRejection` — awaiting callers still
  receive the rejection from the returned promise.
- [x] **Low** — the auto-discovery key `app:<id>:org:<org>` used the raw org string; GitHub
  slugs are case-insensitive, so case-variant config made duplicate clients. Now
  `org.toLowerCase()`.
- [x] **Test gap (reviewer's Low/eviction + concurrency)** — added an injectable `build`
  seam to `resolveOctokit` (the house DI pattern) and three tests: failed-build eviction
  retries cleanly, concurrent callers share **one** in-flight build, and distinct PAT
  tokens get distinct clients (no key collision).
- [x] **Nit (doc)** — the key-rotation comment now also notes that a cached App client does
  **not** self-heal on key *revocation* (it keeps minting with the old key until it 401s),
  so a restart is *required*, not merely recommended.

## Acknowledged (no change)

- [ ] **Nit** — `selectGitHubAuth` runs on every `resolveOctokit` call, including the hot
  cached path. It's pure and cheap (a few string checks); the reviewer's own guidance was
  "flag only if profiling shows it hot." Deriving a key without building the full
  `GitHubAuth` would duplicate the selection logic — not worth it. Left as-is.

## Carried into Phase 6

- The multi-tenant worker (step 5) keys this same `clientCache` by installation id and must
  **evict on uninstall/suspend** (GitHub webhook). The eviction path is now tested, so that
  recovery logic has a proven base.
- Key-rotation/revocation requires a worker restart (documented). If hot key-reload is ever
  wanted, `clearOctokitCache()` is the seam.
