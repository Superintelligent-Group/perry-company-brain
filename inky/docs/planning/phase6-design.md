---
created: 2026-06-04
status: active
author: Claude main session
branch: main
informed_by: docs/planning/roadmap-and-phase-6.md (Track C); docs/planning/inky-project-plan.md (§3 business model, §7 roadmap); docs/reviews/github-app-auth-review.md (H3 entry criterion); the shipped GitHub App auth foundation (src/github-auth.ts)
notes: The Phase 6 decisions doc — locks the stack, monorepo layout, data model, the per-installation client-cache abstraction (the H3 fix is its single-tenant seed), pricing shape, and the build order. Written at Phase 6 kickoff so code that follows has a fixed target. Updated as decisions get validated against reality.
---

# Inky Phase 6 — managed multi-tenant tier (decisions)

This is the **decisions** companion to `roadmap-and-phase-6.md` (which holds the
*why* and the honest "when to start" call). The roadmap says **what** Phase 6 is and
**why**; this doc pins the **how**, so the code that follows has a fixed target.

Guiding principle, unchanged from the plan: **the free self-host tool is the funnel;
the hosted tier is the business.** Every Phase 6 decision optimizes for (a) reusing the
existing core pipeline untouched, and (b) staying boring and cheap until there's pull.

## What Phase 6 is (one paragraph)
A team uses Inky **without self-hosting**: they install the GitHub App on their org,
connect a Discord channel, configure schedules/repos/settings in a web dashboard, and
get billed. No PAT, no Render, no config file. Internally it's the *same*
`collect() → reconcile() → summarize() → render()` core, driven per-tenant by a
multi-tenant worker reading tenant config from Postgres instead of a file.

---

## Locked decisions

### Stack
| Layer | Choice | Why |
|---|---|---|
| Dashboard + API | **Next.js (App Router)** on Vercel | One framework for marketing site, OAuth install flow, settings UI, and the API routes. Cheap/free at our scale. |
| Auth (dashboard login) | **GitHub OAuth** | Users already have GitHub; the install flow and login are the same identity. |
| Database | **Postgres on Neon** | Serverless Postgres, generous free tier, branching for previews. One store for tenants/config/history **and** the job queue. |
| ORM / access | **Drizzle** | Typed, lightweight, SQL-first (no heavy runtime); migrations in-repo. Matches the "boring + typed" house style. |
| Job queue | **pg-boss** (on the same Neon Postgres) | No extra infra — the queue *is* the database. Cron + retries + concurrency built in. BullMQ/Redis only if we outgrow it. |
| Worker | **separate always-on Node process** (Render/Fly) | Long-running cron fan-out; reuses the published core. Vercel functions can't hold cron + long LLM calls well. |
| GitHub auth | **GitHub App** (already built) | Per-install tokens, higher limits, clean revoke. The multi-tenant worker reuses `src/github-auth.ts` with per-tenant installation ids. |
| LLM | **managed key (Inky's), metered + capped per tenant**; BYO-key as a cheaper tier | Best UX out of the box; price the cost in. |
| Billing | **Stripe** subscriptions | Standard; flat per-org tier (see Pricing). |
| Discord delivery | **webhook-only at first**; sharded bot for hosted `/standup` later | Webhooks need no bot scaling — defers the one genuinely hard eng problem. |

### Monorepo layout
The current single-package repo becomes a **pnpm workspace**. The existing core moves
into a published-internally package the dashboard and worker both depend on — **the core
is not forked, it's depended on.**

```
inky/                      # repo root (pnpm-workspace.yaml)
  packages/
    core/                  # ← today's src/ — the pipeline, unchanged in behavior
                           #    collect/reconcile/summarize/render/github-auth/...
                           #    self-host CLI (`inky`) stays here; this is the OSS heart
  apps/
    dashboard/             # Next.js — marketing, GitHub OAuth, install flow, settings UI, Stripe, API
    worker/                # always-on multi-tenant cron fan-out (imports @inky/core)
  packages/
    db/                    # Drizzle schema + migrations + typed client (shared by dashboard + worker)
```

Decisions inside the layout:
- **`packages/core` keeps the MIT, self-hostable CLI exactly as it is.** Open-core line:
  core + self-host = free/MIT; `apps/dashboard` + `apps/worker` + `packages/db` are the
  managed tier (license TBD — likely source-available or simply not published).
- **Migration is mechanical**, not a rewrite: `git mv src packages/core/src`, lift
  `package.json` bin/scripts into the core package, add the workspace file. The 149 tests
  move with it and must stay green — that's the migration's done-check.
- **No behavior change to the pipeline** in the move. New capability lives in the new
  packages, calling into `@inky/core`'s existing exported functions.

### Config: file → DB (the same shape)
Today config is a validated `Config` (zod) from a file; secrets come only from env.
In Phase 6, **per-tenant `Config` is built from DB rows**, and **secrets stay per-tenant**
(the App installation id in the DB; the App private key + managed LLM key are *Inky's*
env, shared, never per-tenant in the DB). Key move: a `Config` is a `Config` whether it
came from a file or a row — so `buildStandup(config, secrets, …)` is called identically.
The dashboard writes rows; the worker reads rows → `Config` → existing pipeline.

### Data model (first cut — Drizzle)
Minimal, additive; columns chosen to match the existing `Config`/`Secrets` shapes.
```
tenants          id, github_login (org), name, created_at, status
installations    id, tenant_id→tenants, github_installation_id (BIGINT/TEXT — see N2 below),
                 github_app_id, suspended_at
configs          id, tenant_id, repos[], window_hours, schedule(jsonb), stats, trends,
                 format, roadmap(jsonb), exclude_people[], aliases(jsonb), updated_at
                 # ← a serialized `Config` minus secrets; validated by the same zod schema on read
channels         id, tenant_id, kind('webhook'|'bot'), discord_webhook_url(enc), guild_id, channel_id
runs             id, tenant_id, job_label, window_since, window_until, status,
                 posted_message_count, llm_tokens, error, created_at   # ← run history + metering + the visual-charts source
billing          tenant_id, stripe_customer_id, stripe_subscription_id, tier, status, contributor_cap
```
Notes:
- **`github_app_id` / installation id are `TEXT`/`BIGINT`, never `INTEGER`** (review N2 —
  `appId` is a string deliberately to avoid JSON int-precision loss).
- **`runs`** is the unlock for the backlog's multi-window charts: stored history is exactly
  what the dashboard charts and >1-window sparklines need (the cheap this-vs-last sparkline
  already shipped; history needs this table).
- Secrets in the DB (webhook URLs) are **encrypted at rest** (app-level enc key in worker/dashboard env).

### Pricing (hypothesis — validate with design partners)
- **Flat per-org tier with a contributor cap** (not per-seat, not per-standup) — predictable,
  matches how the value scales (org activity), easy to reason about.
- **Managed tier** (Inky's LLM key, metered/capped) priced above the **BYO-key tier**.
- Free self-host stays free forever (the funnel). Hosted free trial → paid.
- Exact numbers deferred to first-partner conversations; the *shape* is locked.

---

## The client-cache abstraction (connects H3 → multi-tenant)
The deferred **H3** review item and the multi-tenant worker are the *same problem at two
scales*: don't rebuild (or re-discover) the GitHub client on every run.

- **Single-tenant (now, the H3 fix):** memoize the resolved Octokit by auth identity, so a
  single `buildStandup` (which collects 2–4×) and every worker tick reuse one client, and
  the unpinned-installation `getOrgInstallation` lookup happens **once**, not per call.
- **Multi-tenant (Phase 6):** the *same* cache, keyed by installation id, holds **one client
  per tenant installation**, evicted when an install is suspended/uninstalled (GitHub
  webhook). `@octokit/auth-app` already auto-refreshes the short-lived token inside each
  cached client, so a cached client stays valid indefinitely.

So the H3 fix is built as a **reusable memoizing provider in `github-auth.ts`**, not a
one-off — the worker later instantiates/uses the same thing per installation. (Caveat,
documented at the code: rotating the App private key requires a worker restart, since the
cached client holds the key for minting; acceptable — secrets load once at startup today too.)

---

## Build order (Phase 6)
Mirrors `roadmap-and-phase-6.md` step list, with entry/exit criteria:

0. **This doc** ✅ — decisions locked.
1. **H3 fix** ✅ (`0831e7a`, hardened `9eb9d95`) — memoizing Octokit provider in
   `github-auth.ts` (single-tenant now; the multi-tenant cache later). Reviewed, no
   blockers; PAT key hashed, eviction made unhandled-rejection-safe, injectable `build`
   seam + tests. One lookup per identity.
2. **Monorepo migration** ✅ (`db76816`, CI green) — pnpm workspace; `src → packages/core`;
   154 tests green from the new path; `inky` CLI runs from `packages/core/dist/cli.js`;
   render.yaml/Procfile/Dockerfile updated in lockstep.
3. **`packages/db`** ✅ (`4734d87` schema/mapping, `8ab9ffc` live layer): Drizzle pg-core tables
   (tenants/installations/channels/configs/runs/billing) + pure `assembleConfig`/`disassembleConfig`
   validated by `ConfigSchema` (round-trip `Config === file Config`); `createDb(DATABASE_URL)` pooled
   node-postgres client; `loadTenantConfigByOrg`/`upsertTenantConfig` row adapters; AES-256-GCM
   at-rest crypto for the webhook URL (`INKY_DB_ENCRYPTION_KEY`); generated migration `drizzle/0000`.
   Established the `@inky/core` source-export contract. Verified hermetically with **pglite** (real
   PG in WASM): migrate → write → load round-trips identical, encryption-at-rest, idempotent upsert.
   *Real-Neon smoke still pending* (no live DB in dev) — adapters pglite-verified, pg pool typecheck-verified.
4. **Dashboard MVP** — GitHub OAuth login → App install flow → connect a Discord webhook →
   pick repos/schedule/settings → write rows. *Exit:* a tenant can be fully configured via UI.
5. **Multi-tenant worker** — pg-boss cron fan-out: for each active tenant, build `Config`
   from rows, run the existing pipeline, post, write a `runs` row. **⚠️ GATE: the GitHub App
   must be live-tested before this** (it mints real per-install tokens). *Exit:* two test
   tenants get correct, isolated standups.
6. **Stripe billing + tiers** — subscription, contributor cap enforcement, trial.
7. **Shared sharded `/standup` bot** — last, optional; webhook-only until here.

### Hard gate (carried from the review + memory)
> **The GitHub App auth is built but NOT yet live-tested.** It does **not** block steps
> 0–4. It **must** be proven against a real org install **before step 5** (the worker that
> mints per-installation tokens for real tenants). Do not ship the multi-tenant worker on an
> unexercised auth path.

## Explicitly deferred to ride on Phase 6 infra
- **Slack delivery** (paid multi-workspace surface).
- **Managed Linear/Notion OAuth** reconcile sources (BYO-key `source:'linear'` could ship
  self-host earlier, independent of this).
- **Rich/interactive charts** over stored `runs` history (the dashboard is their real home;
  the unicode sparkline already covers in-Discord this-vs-last).

## Open questions (decide as we hit them)
- Managed-tier license for `apps/*` + `packages/db` (source-available vs private).
- Worker host: Render (already known) vs Fly (regions/cost) — pick at step 5.
- ~~Encryption-at-rest scheme for webhook URLs~~ — **decided (step 3):** AES-256-GCM via
  `node:crypto` with one app key from `INKY_DB_ENCRYPTION_KEY` (zero-dep, authenticated). Revisit
  KMS/per-tenant keys only if compliance requires. (`packages/db/src/crypto.ts`.)
- Dashboard ↔ worker contract: shared `packages/db` only, or also a thin internal API? (Lean
  DB-only first.)
