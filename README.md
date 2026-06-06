# Perry

Perry is Doppel Labs' internal Discord bot for standup reminders and meeting-note documentation. It connects Discord, Notion, and Granola so meeting summaries can land in Notion and be posted cleanly into Discord.

## Current Shape

- Discord slash commands for standup reminders and summaries.
- Scheduled standup reminder/summary jobs.
- Notion data-source reads for standup entries.
- Granola Zapier webhook endpoint for meeting-note ingestion.
- Dry-run preview for incoming Granola payloads.
- SQLite-backed idempotency/history storage for processed meeting notes.
- Durable SQLite ingestion queue with idempotency keys for reliable webhook processing.
- Extracted decisions and action items.
- Brain search across meetings, decisions, and action items.
- Optional Graphiti temporal graph sidecar for relationship memory after meeting notes are posted.
- Durable Graphiti sync queue so graph-memory outages do not block Notion or Discord.
- Pending approval queue before Discord posting.
- Routing rules by Granola folder, title keyword, and attendee email.
- Cross-tool identity fields for Discord, Notion, Granola email, and GitHub.
- Notion meeting-note page creation.
- Discord meeting-note announcements.
- React/Vite admin panel for non-secret operational config, readiness, previews, and history.

Secrets remain in environment variables. The admin panel writes non-secret settings to `data/perry.config.json` or `PERRY_CONFIG_PATH`.

## Intended Experience

Perry should feel like a small internal documentation console:

1. Open the admin panel.
2. Complete the readiness checklist.
3. Paste or load a Granola sample payload.
4. Preview the exact Discord announcement before anything posts.
5. Save config.
6. Add routing rules for project channels and Notion targets.
7. Connect Zapier to `/api/granola/zapier`.
8. Review pending approvals, then approve or reject.
9. Watch processed meeting notes appear in history with Notion and Discord links.

The durable source of truth is Notion. Discord is the notification and discussion layer. Granola is the capture source.

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`, then run:

```sh
pnpm dev
```

The bot process also starts the admin/API server unless `PERRY_ADMIN_SERVER=false`.

For admin-only local development:

```sh
pnpm dev:server
pnpm admin:dev
```

Open `http://localhost:5177` for the Vite admin app. The production bot serves the built admin panel from `http://localhost:8787` after:

```sh
pnpm build
pnpm start
```

Useful performance commands:

```sh
pnpm perf:brain -- 10000
pnpm perf:http -- 250 10
pnpm perf:ingestion-queue -- 5000
```

Optional Graphiti bridge:

```sh
pnpm lmstudio:smoke
pnpm graphiti:bridge
```

See `docs/graphiti-integration.md` for how Perry's SQLite brain and Graphiti's temporal graph fit together.

Queue existing processed meeting history into Graphiti:

```sh
pnpm graphiti:backfill -- --batch 500
pnpm graphiti:backfill -- --batch 500 --drain true
```

## Required Accounts

- Discord application with a bot user.
- Discord install URL with `bot` and `applications.commands` scopes.
- Notion internal integration with access to the standup and meeting-notes data sources.
- Granola Zapier integration, or Granola API access if the poller is implemented later.

## Config

Required secrets:

- `DISCORD_TOKEN`
- `NOTION_TOKEN`

Recommended server secrets:

- `ADMIN_API_TOKEN`
- `GRANOLA_WEBHOOK_TOKEN`

Editable operational settings:

- Discord client, guild, and channel IDs.
- Notion standup and meeting-note data-source IDs.
- Standup schedule and timezone.
- Granola ingestion mode.
- Roster.

## Granola Flow

MVP path:

1. Create a Granola folder for team documentation.
2. Create a Zapier workflow with Granola's "Note Added to Granola Folder" trigger.
3. POST the Zap payload to Perry at `/api/granola/zapier`.
4. Perry creates a Notion meeting-note page.
5. Perry posts the summary and links to the configured Discord meeting channel.

Use `GRANOLA_WEBHOOK_TOKEN` and send it as `x-perry-webhook-token` from Zapier.
Use `/api/granola/zapier?enqueue=true` or `PERRY_WEBHOOK_MODE=queue` when the webhook should acknowledge quickly and let Perry process the note through the durable queue. Enable `PERRY_INGESTION_WORKER=true` to process queued jobs continuously, or call `/api/ingestion/drain`.
Queued ingestion is for real processing only; use `/api/granola/preview` or inline `/api/granola/zapier?dryRun=true` for dry runs.

Useful local endpoints:

- `GET /api/ping`
- `GET /api/health`
- `GET /api/counts?status=pending`
- `GET /api/agent/status`
- `GET /api/diagnostics`
- `GET /api/config`
- `PUT /api/config`
- `GET /api/granola/sample`
- `POST /api/granola/preview`
- `POST /api/granola/zapier`
- `POST /api/granola/zapier?enqueue=true`
- `POST /api/granola/zapier?dryRun=true`
- `GET /api/ingestion/jobs`
- `GET /api/ingestion/jobs?detail=true`
- `POST /api/ingestion/drain?limit=10`
- `GET /api/graph-sync/jobs`
- `GET /api/graph-sync/jobs?detail=true`
- `POST /api/graph-sync/backfill?limit=500`
- `POST /api/graph-sync/drain?limit=10`
- `GET /api/meetings/history`
- `GET /api/approvals?status=pending`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`
- `GET /api/brain/search?q=...`
- `GET /api/brain/graph/search?q=...`
- `GET /api/brain/decisions`
- `GET /api/brain/actions`

Perry stores processed meeting records in `%LOCALAPPDATA%\Perry\perry.sqlite` on Windows, or `data/perry.sqlite` elsewhere. Override with `PERRY_DB_PATH` when needed. Replayed Granola notes with the same source ID return the existing record instead of posting again unless `force=true` is passed.

Publishing modes:

- `approval`: create a pending approval and wait for an admin action.
- `auto`: create Notion/Discord output immediately after ingestion.
- `draft`: keep the item in the approval queue as a quiet draft.

Default mode is `approval`; routing rules can override it per project.

## Product Direction

See [docs/granola-study.md](docs/granola-study.md) for the current Granola study and Perry's product direction. The summary: Granola is the capture layer; Perry should become the operating memory layer with routing, structured extraction, approval controls, source preservation, and retrieval.

See [docs/performance/README.md](docs/performance/README.md) for synthetic scale measurements and the current performance model.

## Notion Schema

Standup data source expects:

- `Date`
- `Person`
- `Yesterday`
- `Today`
- `Blockers`
- `Status`
- `Discord`

Meeting notes data source expects:

- `Title`
- `Source`
- `Source ID`
- `Date`
- `Granola Link`
- `Attendees`

## Scripts

```sh
pnpm dev              # bot + scheduler + admin/API server
pnpm dev:server       # admin/API server only
pnpm admin:dev        # Vite admin app
pnpm build            # TypeScript server build + admin production build
pnpm typecheck        # server and admin typecheck
pnpm test             # focused unit tests
pnpm start            # run built bot
pnpm start:server     # run built admin/API server only
```

## Still Needed

- Put this folder under Git or move it into a managed Doppel-Labs repo.
- Add Granola API polling if Zapier is not the desired long-term ingestion path.
- Add source-cited `/perry ask` retrieval.
- Promote identity mappings into a dedicated people graph once the roster grows.
- Add Notion schema smoke checks.
- Add Discord smoke checks against a test guild/channel.
- Add CI once the repo has a remote.

## Company Brain

- [Company Brain Testing](docs/company-brain-testing.md)
- [Company Brain Ontology](docs/company-brain-ontology.md)
