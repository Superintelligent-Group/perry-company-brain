# Perry Operations Runbook

This is the local-first operating path for Perry as the Doppel Labs company brain.

## Daily local smoke

Run these before trusting a local admin or Graphiti session:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm ops:local-brain-gauntlet
```

Use strict mode only when the full stack is meant to be online:

```powershell
$env:PERRY_ADMIN_URL="http://127.0.0.1:8787"
$env:PERRY_GRAPHITI_BRIDGE_URL="http://127.0.0.1:8765"
$env:LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
pnpm ops:local-brain-gauntlet -- --strict
```

If you want replay readback to be part of the strict proof, set a known change set id:

```powershell
$env:PERRY_GAUNTLET_REPLAY_CHANGE_SET_ID="graph-change-set-id"
pnpm ops:local-brain-gauntlet -- --strict
```

## LM Studio evaluation

Use this to compare local models and settings on fixed company-brain extraction cases:

```powershell
$env:LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
$env:PERRY_LMSTUDIO_EVAL_MODELS="gemma-4-local,other-local-model"
$env:PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE="0"
pnpm lmstudio:evaluate
```

Strict mode makes low extraction scores fail CI-style:

```powershell
pnpm lmstudio:evaluate -- --strict
```

Evaluation fixtures live in `tests/fixtures/lmstudio-extraction-eval.json`. Add cases when a meeting exposes a new failure mode: messy owner names, pivots, vague customer mentions, Discord routing, Notion write targets, or repository references.

## Backups

Perry's local durable state is split across SQLite and Graphiti/Neo4j.

SQLite:

1. Stop write-heavy local workers if possible.
2. Copy `data/perry.sqlite` and any `data/*.sqlite` benchmark or gauntlet databases that matter.
3. Keep backup names timestamped, for example `perry-2026-05-23.sqlite`.
4. Restore by replacing the SQLite file while Perry is stopped, then run `pnpm ops:local-brain-gauntlet`.

Graphiti/Neo4j:

1. Export the Neo4j database with the local Neo4j tooling or volume backup path used by the Graphiti container.
2. Record the `PERRY_GRAPHITI_GROUP_ID` alongside the backup. Group id is part of the logical dataset boundary.
3. Restore Neo4j first, then start the Graphiti bridge, then run the strict gauntlet.

## Release gates

A release candidate should have:

- Typecheck, tests, build, and local gauntlet passing.
- Admin graph replay diff passing for at least one known change set when Graphiti is online.
- LM Studio eval passing for the chosen local model/settings.
- Notion writes exercised in dry-run before real writes.
- Discord admin role ids configured before enabling `/brain` in a real guild.
- A fresh backup before any migration or backfill that touches production-like data.

## Full Local Brain Acceptance

After Neo4j, LM Studio, Graphiti bridge, and Perry admin are online, run the full local proof:

```powershell
$env:PERRY_ADMIN_URL="http://127.0.0.1:8792"
$env:PERRY_GRAPHITI_BRIDGE_URL="http://127.0.0.1:8791"
$env:PERRY_GRAPHITI_GROUP_ID="doppel-labs"
$env:PERRY_GRAPHITI_DIRECT_CHANGESETS="true"
$env:PERRY_SQLITE_JOURNAL_MODE="MEMORY"
$env:PERRY_LMSTUDIO_EVAL_MODELS="gemma-4-e4b-claude-abliterated"
pnpm brain:acceptance
```

The acceptance command checks:

- Graphiti bridge health.
- Graphiti LM Studio chat and embedding model visibility.
- LM Studio model visibility.
- Gemma semantic extraction quality fixtures.
- Synthetic Granola meeting ingest through dry-run Notion and Discord sinks.
- Graph sync drain into Graphiti/Neo4j.
- Live Perry admin/API strict gauntlet.

Current local verified stack on 2026-05-25:

- Perry admin/API: `http://localhost:8792`.
- Graphiti bridge: `http://127.0.0.1:8791`.
- Neo4j: `bolt://127.0.0.1:7687` via Docker container `perry-neo4j`.
- LM Studio: `http://127.0.0.1:1234/v1`.
- Chat model: `gemma-4-e4b-claude-abliterated`.
- Embedding model: `text-embedding-nomic-embed-text-v1.5`.

On this Windows workspace, file-backed Node SQLite currently needs `PERRY_SQLITE_JOURNAL_MODE=MEMORY`; `DELETE` and `WAL` have produced `disk I/O error` in local probes.

## Notion And Discord Sandbox Verification

Use the safe dry-run verifier after `pnpm build`:

```powershell
pnpm sandbox:integrations
```

This checks:

- Discord slash command JSON for `standup` and `brain`.
- Notion wiki write contracts in dry-run mode.
- Notion meeting-page creation in dry-run mode.
- Discord post formatting in dry-run mode.

Real Notion sandbox writes are opt-in and create pages in the configured sandbox data sources:

```powershell
$env:NOTION_TOKEN="..."
$env:NOTION_MEETING_NOTES_DATA_SOURCE_ID="..."
$env:NOTION_DECISIONS_DATA_SOURCE_ID="..."
$env:NOTION_ACTION_ITEMS_DATA_SOURCE_ID="..."
$env:NOTION_PROJECTS_DATA_SOURCE_ID="..."
pnpm sandbox:integrations -- --real-notion --strict
```

Real Discord sandbox verification is opt-in. Start with bot identity and command registration; add posting only when the sandbox channel is correct:

```powershell
$env:DISCORD_TOKEN="..."
$env:DISCORD_CLIENT_ID="..."
$env:DISCORD_GUILD_ID="..."
pnpm sandbox:integrations -- --real-discord --register-discord --strict

$env:DISCORD_SANDBOX_CHANNEL_ID="..."
pnpm sandbox:integrations -- --real-discord --post-discord --strict
```

The real Discord flags use Discord's REST API directly so they can verify bot identity, guild command registration, and a sandbox post without starting the long-running bot worker.

## Discord Command Gauntlet

After `pnpm build`, validate the local slash command surface:

```powershell
pnpm discord:commands:gauntlet -- --report reports/discord/commands-local.json --markdown reports/discord/commands-local.md
```

For a live comparison, set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`, then run:

```powershell
pnpm discord:commands:gauntlet -- --live true
```

To register the local command JSON intentionally, use:

```powershell
pnpm discord:commands:gauntlet -- --register true
```

The gauntlet verifies the `standup` and `brain` command surfaces, including `/brain state`, `/brain changed`, and `/brain evidence`.

## Agent Tool Contract Gauntlet

Run after `pnpm build` when changing company-brain tool contracts, ontology materialization, or evidence handling:

```powershell
pnpm agent-tools:gauntlet -- --report reports/agent-tools/contract-gauntlet.json --markdown reports/agent-tools/contract-gauntlet.md
```

This validates bounded model-tool payloads, latency budgets, evidence/relation availability, ontology health, and private/transcript leakage guards.


## Persistent Agent Corpus

Run after `pnpm build` when validating agent tools against a reusable SQLite corpus:

```powershell
pnpm agent-tools:corpus-gauntlet -- --reset true --limit 250 --db reports/db/agent-tool-corpus.sqlite --report reports/agent-tools/corpus-gauntlet.json --markdown reports/agent-tools/corpus-gauntlet.md
pnpm ontology:repair -- --db reports/db/agent-tool-corpus.sqlite --report reports/ontology/repair-dry-run.json --markdown reports/ontology/repair-dry-run.md
```

The corpus gauntlet ingests through the workflow with direct graph change sets enabled. The repair command is dry-run unless `--apply true` is passed.

