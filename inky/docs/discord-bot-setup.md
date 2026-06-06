---
created: 2026-06-01
status: active
author: Claude main session
session: aa8bf74f-adef-4f15-a54b-4d2aa9d20e9e
branch: main
informed_by: Phase 4 slash command build (src/bot.ts, src/commands.ts); Discord developer docs (applications, bot tokens, application commands, OAuth2 scopes)
notes: How to set up the Discord application + bot for the /standup slash command — create the app, get the token + application ID, invite the bot, register the command, and run it.
---

# Setting up the `/standup` bot

The **scheduled daily post** needs only a webhook (see `docs/deployment.md`).
This guide is for the **on-demand `/standup` slash command** — letting anyone in
your server pull a standup for any window, with the report settings they want.

`/standup` runs over Discord's **gateway** (a persistent outbound WebSocket), so
it needs no public URL and works anywhere `inky serve` runs — including your
laptop, with no tunneling.

## 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application** (pick "Build a Bot" if it asks). Name it (e.g. "Inky").
2. On **General Information**, copy the **Application ID** → set it as
   `discord.applicationId` in `inky.config.json`.
3. **Give it a face** (so it doesn't show up as a blank default):
   - **App Icon:** upload a square PNG (512×512). Use `assets/inky-logo.svg` from this
     repo (export to PNG), or a 🐙 octopus image. The bot's avatar inherits this.
   - **Description:** paste a one-liner, e.g.
     *"Your team's daily standup, written for you. I read your org's GitHub activity —
     commits, PRs, reviews, issues — and post the daily & weekly standup to Discord,
     zero input. Use `/standup` anytime. Open source 🐙 github.com/Doppel-Labs/inky"*
   - (Optional) **Tags / Install settings** if you ever list it in the App Directory.

## 2. Add a bot + get the token

1. **Bot** (left sidebar) → the application already has a bot user.
2. **Reset Token** → copy it → set `DISCORD_BOT_TOKEN` in your `.env` (it's a
   secret — never put it in config).
3. **Privileged Gateway Intents:** leave them **all off**. Slash-command
   interactions arrive over the gateway without any privileged intents — Inky
   never reads message content.

## 3. Invite the bot to your server

Use the **OAuth2 → URL Generator**:
- **Scopes:** `bot` and `applications.commands`
- **Bot Permissions:** none required (Inky replies via the interaction token, not
  by posting as the bot, so it needs no channel permissions).

Or build the URL by hand (replace `APP_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=0
```

Open it, pick your server, authorize.

## 4. (Recommended) Set a guild ID for instant commands

By default the command registers **globally**, which can take up to ~1 hour to
appear. To make it show up **instantly** in one server:

1. Discord → **User Settings → Advanced → Developer Mode** (on).
2. Right-click your server → **Copy Server ID**.
3. Set it as `discord.guildId` in `inky.config.json`.

## 5. Register the command

```bash
inky register-commands
```

This PUTs the `/standup` definition to Discord — to your `guildId` (instant) if
set, otherwise globally. Re-run it only when the command's options change, not on
every restart.

## 6. Run the bot

```bash
GITHUB_TOKEN=$(gh auth token) inky serve      # or: pnpm dev serve
```

`serve` starts the scheduled post (if a webhook is set) **and** the `/standup`
bot (if `DISCORD_BOT_TOKEN` is set) in one process. You'll see
`bot online as …. /standup is ready.` Type `/standup` in your server.

> Want *only* the bot, no scheduled post? Just don't set `DISCORD_WEBHOOK_URL` —
> `serve` runs whichever pieces are configured. Run a single bot instance.

## Using `/standup`

All options are optional; each overrides the configured default for that one run:

| Option | Choices | Effect |
|---|---|---|
| `range` | Today · This week · This month | The window to summarize. |
| `days` | 1–90 | Custom window in days; **overrides** `range`. |
| `stats` | On · Off · Auto | The team stats panel (default: auto — on for weekly+). |
| `per_person` | true / false | Show each person's stat line. |
| `format` | Bullets · Prose | Per-person style. |

With no options, `/standup` uses the window and settings from
`inky.config.json` (`windowHours`, `stats`, `statsPerPerson`, `format`).

> **Who can run it.** `/standup` exposes your org's private GitHub activity, so by
> default it's **admin-only** (registered with no default permissions). To let
> others use it, open **Server Settings → Integrations → Inky → `/standup`** and
> grant the roles/members/channels you want. Restricting the bot to your team's
> own server (one `guildId`) keeps it out of unrelated servers entirely.

Because building a standup takes a few seconds (it reads GitHub and writes the
summary), the bot first replies "Inky is thinking…", then edits in the finished
standup — the normal Discord pattern for slow commands.

## Troubleshooting

- **`/standup` doesn't appear** — global registration can take ~1h; set a
  `guildId` and re-run `register-commands` for instant availability. Confirm the
  bot was invited with the `applications.commands` scope.
- **`register-commands: set DISCORD_BOT_TOKEN` / `set discord.applicationId`** —
  the token (env) or the application ID (config) is missing.
- **Bot never comes online** — check `DISCORD_BOT_TOKEN` is correct and that
  `serve` logs `bot online as …`.
