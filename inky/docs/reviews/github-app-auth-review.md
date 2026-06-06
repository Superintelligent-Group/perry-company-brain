---
created: 2026-06-04
status: active
author: code-reviewer agent (triaged by Claude main session)
session: 00f2d3f5-05eb-4c65-a9d4-0147669a31d9
branch: main
informed_by: review of commit 8ce650a (GitHub App auth); fixes applied in the follow-up commit
notes: Triaged code review of the GitHub App auth feature. Findings converted to checkboxes; the actionable ones were fixed in the follow-up commit. Remaining items are deferred Phase-6 prerequisites / acknowledged non-issues. Full original prose review is in git history (was docs/temp/github-app-auth-review.md).
---

# GitHub App auth — review triage

The [code-reviewer agent](.) reviewed commit `8ce650a`. Verdict was "not safe to ship
as-is" on **C1**; that and the other actionable findings are now **fixed** in the
follow-up commit. Tests: 120 → **125**, typecheck clean.

## Fixed

- [x] **C1 (Critical)** — `resolveAppPrivateKey` threw inside `loadSecrets`, breaking
  setup-only commands (`register-commands`) when a key path was bad. Now returns
  `undefined` on an unreadable path; the error surfaces in `selectGitHubAuth` only when
  App auth is actually chosen. Regression-guarded by a test.
- [x] **H1 (High)** — half-configured App (app id, no key) silently fell back to PAT.
  Now an **app id is the signal of intent**: with it set, a missing/invalid key throws
  rather than silently using a PAT (which may carry broader scopes). *(Implemented
  slightly differently from the report's suggestion — keyed on "app id present" so the
  bad-key-path case is also caught, not just "key absent".)*
- [x] **H2 (High)** — a 404 from `getOrgInstallation` (App not installed on the org)
  surfaced as a bare `inky: Not Found`. Now wrapped with an actionable message pointing
  to the install step.
- [x] **M1 / L4 (Medium/Low)** — no PEM validation; a truncated/whitespace key produced
  an opaque JWT error deep in `@octokit/auth-app`. `selectGitHubAuth` now rejects a key
  without a `-----BEGIN` header with a clear message.
- [x] **M2 (Medium)** — `GitHubAuth` type was exported (a `privateKey`-bearing surface).
  Now unexported (implementation detail of the selector/resolver pair).
- [x] **M3 (Medium)** — the `github.appId` schema comment said "Env GITHUB_APP_ID
  overrides" (backwards). Corrected: config takes precedence.
- [x] **M4 (Medium)** — brittle `assert.equal(auth.mode === 'app' && …)` test assertion
  replaced with the guard-clause pattern used elsewhere.
- [x] **L1 (Low)** — added a test: inline `GITHUB_APP_PRIVATE_KEY` wins over `_PATH`.
- [x] **L2 (Low)** — added a test: a key with no app id falls back to PAT.
- [x] **L3 (Low)** — commented the two-client (app-JWT vs installation) pattern in
  `resolveOctokit`.
- [x] **N1 (Nit)** — extracted the hardcoded `userAgent: 'inky'` to a shared
  `USER_AGENT` constant in `github.ts`, used by both the PAT and App clients.

## Fixed (Phase 6, follow-up)

- [x] **H3 (High → Phase 6 prerequisite)** — **DONE** (Phase 6 step 1). `resolveOctokit` is
  now memoized by auth identity (`clientCacheKey`): a single `buildStandup` (which collects
  2–4×) and every worker tick reuse one client, and the unpinned-installation
  `getOrgInstallation` lookup runs **once** per identity, not per call. Built as a reusable
  memoizing provider (`clientCache` + `clearOctokitCache()`) — the **single-tenant form of
  the Phase 6 per-installation client cache**: the multi-tenant worker keys the same map by
  installation id and evicts on uninstall (see `docs/planning/phase6-design.md`). A rejected
  build is evicted so a retry (e.g. after installing the App) works; cache key omits the
  private key (rotating it needs a restart — documented at the code). Guarded by two tests
  (memoization + cache clear).

## Deferred / acknowledged (no change now)
- [ ] **N2 (Nit)** — `appId` is a `string` (deliberate, to avoid JSON int-precision
  issues). No change. *Note for Phase 6:* the DB column for `appId` should be `TEXT` /
  `BIGINT`, not `INTEGER`.
- [ ] **N3 (Nit)** — `.env.example` could note that a multi-line shell assignment
  (`export KEY="$(cat key.pem)"`) also works. The App doc already covers it; left as-is.
