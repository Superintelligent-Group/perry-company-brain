---
created: 2026-06-01
status: active
author: Claude main session
session: aa8bf74f-adef-4f15-a54b-4d2aa9d20e9e
branch: main
informed_by: Phase 4 worker build (src/worker.ts, src/standup.ts, src/config.ts schedule block); inky-project-plan.md §5 host-agnostic architecture
notes: How to run Inky as a long-running worker (inky serve) that posts the standup on a schedule, and how to deploy it to Railway / Fly.io / Render / Docker.
---

# Deploying Inky

Inky's core is host-agnostic. To make it **run on its own**, you run the
long-running worker:

> **Already deployed?** Day-2 operations — change the schedule/channel, rotate a
> token, post on demand — are in [`OPERATIONS.md`](OPERATIONS.md).

```bash
inky serve          # schedules the standup forever (config.schedule)
inky serve --once   # run one cycle now and exit (great for a first live test)
inky serve --once --dry-run   # build + print, don't post (no webhook needed)
```

`serve` uses an in-process scheduler ([croner](https://github.com/hexagon/croner)),
so there's no external cron, no extra service — just one always-on process. Each
tick runs the full `collect → summarize → render → post` pipeline. A failed run
(GitHub hiccup, LLM error, Discord 5xx) is logged and the worker keeps going; if a
run outlasts its interval, the next tick is skipped rather than overlapping.

The **same `serve` process** also hosts the on-demand `/standup` slash command
when `DISCORD_BOT_TOKEN` is set (a gateway connection, no public URL). It runs
whichever pieces are configured: scheduled posts need the webhook, `/standup`
needs the bot token, and you can run either or both. Setup:
[`docs/discord-bot-setup.md`](discord-bot-setup.md).

## 1. Configure the schedule

In `inky.config.json`:

```jsonc
{
  "org": "your-org",
  "schedule": {
    "timezone": "America/New_York",     // IANA name; DST-aware
    "jobs": [
      { "cron": "0 9 * * 1-5", "windowHours": 24,  "label": "daily"  }, // 9am weekdays, past day
      { "cron": "0 9 * * 1",   "windowHours": 168, "label": "weekly" }  // 9am Monday, past week
    ]
  }
}
```

`schedule.jobs` is **one or more** posts — each with its own `cron` (standard
5-field) and `windowHours` (the window that post covers). That's how you run a
daily standup **and** a weekly one from a single worker. A job's `windowHours`
falls back to the top-level `windowHours` if omitted. To stagger same-day jobs
(e.g. a Monday weekly + the Monday daily) so they don't post at the same minute,
give them different times.

## 2. Set secrets (environment only — never in config)

| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes | Read org activity (a fine-grained PAT with repo read — see `docs/github-token-setup.md`). `GH_TOKEN` also accepted. |
| `DISCORD_WEBHOOK_URL` | for scheduled posts | Discord incoming webhook for the target channel. Preferred over `discord.webhookUrl` in config. |
| `DISCORD_BOT_TOKEN` | for `/standup` | Bot token for the on-demand slash command. Optional — see `docs/discord-bot-setup.md`. |
| `ANTHROPIC_API_KEY` | for AI summary | Or `GROQ_API_KEY` / `OPENAI_API_KEY`, matching `config.provider`. Without one, Inky posts the deterministic (mechanical) render. |

Create the Discord webhook: **Channel → Edit Channel → Integrations → Webhooks →
New Webhook → Copy Webhook URL**. Anyone with that URL can post to the channel, so
treat it as a secret.

> **One instance only.** Each running `serve` posts on the schedule — run two and
> the channel gets the standup twice. Keep a single worker (one dyno / one machine
> / `replicas: 1`).

## 3. Verify locally before deploying

```bash
# Build + print, no Discord needed:
GITHUB_TOKEN=$(gh auth token) pnpm dev serve --once --dry-run

# Real post to your channel, once:
GITHUB_TOKEN=$(gh auth token) DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/… \
  pnpm dev serve --once
```

## 4. Deploy

The worker is a plain Node process; any always-on host works. Build first
(`pnpm build` → `packages/core/dist/`), then run `node packages/core/dist/cli.js serve`. Provide
`inky.config.json` (commit it to your private fork, or mount it) and set the
secrets above as the platform's env vars / secrets.

### Docker (any host)

```bash
docker build -t inky .
docker run -d --name inky --restart unless-stopped \
  -v "$PWD/inky.config.json:/app/inky.config.json:ro" \
  -e GITHUB_TOKEN -e ANTHROPIC_API_KEY -e DISCORD_WEBHOOK_URL \
  inky
```

The image's default command is `inky serve`. (`docs/` and local secrets are
excluded via `.dockerignore`; the runtime stage ships only production deps.)

### Railway

1. New project → Deploy from your repo. Railway detects the `Dockerfile` (or the
   `Procfile`'s `worker:` process).
2. **Variables**: add `GITHUB_TOKEN`, `DISCORD_WEBHOOK_URL`, and your LLM key.
3. Commit `inky.config.json` to your (private) fork, or add it via a volume.
4. Ensure a single replica. Logs show `worker started — … Next run: …`.

### Fly.io

1. `fly launch --no-deploy` (it'll use the `Dockerfile`); set `[processes] app = "node packages/core/dist/cli.js serve"` or keep the image CMD.
2. `fly secrets set GITHUB_TOKEN=… DISCORD_WEBHOOK_URL=… ANTHROPIC_API_KEY=…`
3. Bake `inky.config.json` into the image (fork) or attach a volume.
4. `fly deploy`; scale to one machine: `fly scale count 1`.

### Render (recommended — there's a committed `render.yaml`)

The repo ships a [`render.yaml`](../render.yaml) Blueprint that defines a
**Background Worker** (no HTTP port — the right type for `inky serve`, which
connects out over Discord's gateway).

1. Render dashboard → **New → Blueprint** → pick this repo. It reads `render.yaml`
   and creates the `inky` worker. Node is pinned to 22 (`.node-version`), and the
   build invokes pnpm *through* corepack (`corepack pnpm install … && corepack pnpm
   run build`) — **not** `corepack enable`, which fails on Render's read-only
   `/usr/bin`. Start: `node packages/core/dist/cli.js serve --config /etc/secrets/inky.config.json`.
2. **Secret File:** on the service, add a Secret File named **`inky.config.json`**
   with your config (org, repos, aliases, schedule, provider/model). Render mounts
   it at `/etc/secrets/inky.config.json`, which the start command points at. (Your
   config isn't a secret per se, but this keeps it off the public repo.)
3. **Environment:** set `GITHUB_TOKEN`, one LLM key (`ANTHROPIC_API_KEY` /
   `GROQ_API_KEY` / `OPENAI_API_KEY`), `DISCORD_WEBHOOK_URL`, and
   `DISCORD_BOT_TOKEN` only if you want the `/standup` command.
4. Deploy. The logs should show `worker started — … Next run: …`. Keep the
   instance count at **1**.

> Background Workers are a paid Render instance type (no free tier). The Blueprint
> defaults to the `starter` plan — change it in `render.yaml` or the dashboard.

## Troubleshooting

- **`no Discord webhook configured`** — set `DISCORD_WEBHOOK_URL` (or
  `discord.webhookUrl`), or use `--dry-run` to print.
- **Posts the mechanical render, not the AI one** — the provider's key isn't set;
  the log line says which env var is missing.
- **Nothing posts at the scheduled time** — check the worker is actually running
  (`worker started … Next run` should be in the logs) and that `timezone` is the
  one you expect. Test the wiring immediately with `serve --once`.
- **Double posts** — more than one worker instance is running; scale to one.

## The `/standup` slash command

On-demand standups run through the same `serve` process via a Discord bot. To
enable it: create a Discord app, set `DISCORD_BOT_TOKEN` + `discord.applicationId`
(and optionally `discord.guildId`), run `inky register-commands` once, then
`inky serve`. Full walkthrough: [`docs/discord-bot-setup.md`](discord-bot-setup.md).
