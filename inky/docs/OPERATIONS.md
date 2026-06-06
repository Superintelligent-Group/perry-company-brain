---
created: 2026-06-04
status: active
author: Claude main session
session: aa8bf74f-adef-4f15-a54b-4d2aa9d20e9e
branch: main
informed_by: Operating Inky in production (Render worker, Discord webhook + /standup bot, fine-grained GitHub PAT); the recurring day-2 questions (change schedule, change channel, rotate token, test a post)
notes: Day-2 operations runbook for a deployed/self-hosted Inky. First-time setup lives in deployment.md / discord-bot-setup.md / github-token-setup.md; this is the "now that it's running, how do I…" doc.
---

# Operating Inky 🐙

Day-2 runbook for a **deployed** Inky: what it needs, how to redeploy, change
schedules/channels, rotate secrets, and post on demand. First-time setup is in
[`deployment.md`](deployment.md), [`discord-bot-setup.md`](discord-bot-setup.md),
and [`github-token-setup.md`](github-token-setup.md).

> Keep your *instance-specific* inventory (which host, which app/server IDs, where
> each token is stored) in a **private** note — not here. This doc is generic.

## What Inky needs

**Secrets — env vars only, never in a committed file:**

| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes | Read org activity (a read-only fine-grained PAT). `GH_TOKEN` also works. |
| `ANTHROPIC_API_KEY` | for the AI summary | Or `GROQ_API_KEY` / `OPENAI_API_KEY`, matching `config.provider`. |
| `DISCORD_WEBHOOK_URL` | for scheduled posts | The channel the standup posts to. |
| `DISCORD_BOT_TOKEN` | for `/standup` | The slash-command bot (optional). |

**Config (`inky.config.json`) — non-secret:** org, `repos`, `staleDays`,
`schedule.jobs`, `aliases`, `provider`/`model`, `discord.applicationId`/`guildId`.
On a host, supply it as a mounted/secret file and point the worker at it with
`--config` (e.g. Render Secret File at `/etc/secrets/inky.config.json`).

## Deploy / redeploy
- **Render** (uses `render.yaml`): push to `main` (auto-deploy) or **Manual Deploy**.
- **Any host:** `pnpm build`, then `node packages/core/dist/cli.js serve --config <path>`.
- **Run a single instance** — each one posts on the schedule, so two would double-post.

## Change the schedule, repos, or settings
Edit the config file (or your host's Secret File) and restart:
- **Schedules:** `schedule.jobs[]` — each entry is a `cron` + optional `windowHours`
  + `label`. Shared `schedule.timezone` (IANA name). Run daily *and* weekly by
  listing two jobs.
- **Repos:** `repos: []` = all non-archived org repos; or list specific ones.
  `staleDays: "auto"` skips repos with no push in the run's window.
- Then redeploy / restart.

## Change or add the Discord channel
Scheduled posts follow `DISCORD_WEBHOOK_URL`, and **a webhook is bound to one channel**:
- **Switch channels:** create a webhook in the new channel (**Edit Channel →
  Integrations → Webhooks → New Webhook → Copy URL**), update `DISCORD_WEBHOOK_URL`,
  redeploy.
- **Post to several channels:** not built in (one webhook) — run a second worker with
  a different webhook, or contribute `discord.webhookUrls[]`.
- **`/standup`** works in **any channel** of the server the bot is in — no per-channel
  setup. Restrict who/where under **Server Settings → Integrations → Inky**.

## Use `/standup`
Type `/standup` in any channel. Options: `range` / `days`, `stats`, `per_person`,
`format` — each overrides the config default for that run. Add `private:true` for an
**ephemeral** reply only you can see (inspect the team without posting publicly). It's
**admin-only by default**; broaden it in Server Settings → Integrations.

## Rotate a token
Regenerate it (GitHub / Discord / Anthropic) → update the env var on your host
(and local `.env`) → redeploy. Secrets come only from env, so nothing in the repo
changes. (A fine-grained GitHub PAT also auto-expires — renew before it lapses.)

## Test a post right now
- **Hosted (Render Shell):** `node packages/core/dist/cli.js serve --once --config /etc/secrets/inky.config.json`
- **Local:** `GITHUB_TOKEN=$(gh auth token) pnpm dev standup --days 1`

Add `--dry-run` to print instead of posting.

## What costs money
- The **worker host** (e.g. a Render Background Worker — a paid instance type).
- **LLM usage** on your key (cents per run).
- The repo + GitHub Actions: **free** (public repo).
