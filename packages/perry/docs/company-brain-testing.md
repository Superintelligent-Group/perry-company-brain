# Company Brain Testing

Perry's company-brain path has two reliability targets:

1. Keep meeting workflow safe and fast: Granola ingest, dedupe, approval or
   posting, Notion, Discord, SQLite state, and retry queues.
2. Add semantic memory without making the workflow fragile: Graphiti, LM Studio,
   and Neo4j must be asynchronous and diagnosable.

## Current Local Gauntlet

Use the gauntlet after `pnpm build`:

```powershell
pnpm company-brain:gauntlet
```

The script defaults to safe local settings:

- `PERRY_DB_PATH=:memory:`
- `PERRY_DEFAULT_PUBLISH_MODE=auto`
- `PERRY_DISCORD_DRY_RUN=true`
- `PERRY_NOTION_DRY_RUN=true`
- `PERRY_GRAPHITI_ENABLED=true`
- `PERRY_GRAPHITI_BRIDGE_URL=http://127.0.0.1:8791`
- `PERRY_GRAPHITI_TIMEOUT_MS=120000`

It creates one synthetic Granola meeting, writes the operational meeting record,
stores extracted decisions and action items, emits dry-run Notion and Discord
URLs, drains one graph sync job, and runs a graph search.

For durable local replay, set `PERRY_DB_PATH` before running it:

```powershell
$env:PERRY_DB_PATH="data/company-brain-gauntlet.sqlite"
pnpm company-brain:gauntlet
```

Useful variants:

```powershell
pnpm company-brain:gauntlet -- --graph false
pnpm company-brain:gauntlet -- --force true
pnpm company-brain:gauntlet -- --note-id company-brain-gauntlet-fixed
```

## Retrieval Evaluation

The first redacted fixture corpus lives at
`tests/fixtures/company-brain-corpus.json`. Each case has:

- a Granola-like payload,
- expected decisions,
- expected action items,
- expected search checks.

Run the offline evaluator after `pnpm build`:

```powershell
pnpm company-brain:evaluate
```

This uses dry-run Notion and Discord, writes to an in-memory SQLite brain,
flushes FTS, and asserts that expected decisions, action items, and search hits
are present.

When local LM Studio, Graphiti, and Neo4j are running, include the graph layer:

```powershell
pnpm company-brain:evaluate -- --graph true
```

That drains graph sync jobs and runs one Graphiti search check per fixture. Use
this to compare fast operational retrieval with slower semantic retrieval.

## Synthetic Company Analysis

For unattended scale and edge-case analysis, use the deterministic synthetic
company generator:

```powershell
pnpm company-brain:synthetic -- --count 1000 --search-sample 250
```

This creates realistic virtual meetings across projects such as Wallace, Perry,
Notion Wiki, Discord Ops, and Graph Memory. It intentionally includes:

- duplicate Granola payloads,
- owner changes,
- long transcripts,
- private notes,
- missing summaries,
- sparse attendee lists.

The analyzer reports:

- processed meeting count,
- decisions and action items extracted,
- SQLite FTS rows flushed,
- duplicate detection results,
- privacy leak checks for Discord announcements,
- decision/action/search pass rates,
- current ownership and ownership-change insights,
- open action counts by owner,
- throughput in meetings per second.

Graph sampling is opt-in because local LLM extraction is much slower:

```powershell
pnpm company-brain:synthetic -- --count 100 --search-sample 50 --graph true --graph-sample 5
```

For an overnight run, keep Graphiti sampling small unless you explicitly want a
slow local-model soak:

```powershell
pnpm company-brain:synthetic -- --count 10000 --search-sample 1000
```

Latest local measurements on 2026-05-23:

- `--count 500 --search-sample 150`: passed in `343.21 ms`, about `1,456.82`
  meetings/sec, with 45 owner changes, 39 long transcripts, 100 private-note
  cases, 27 duplicates, 18 missing summaries, and 30 sparse-attendee meetings.
- `--count 10000 --search-sample 1000`: passed in `8,568.78 ms`, about
  `1,167.03` meetings/sec, with 909 owner changes, 770 long transcripts,
  2,000 private-note cases, 527 duplicates, 345 missing summaries, and 589
  sparse-attendee meetings.
- `--count 12 --search-sample 12 --graph true --graph-sample 1`: passed in
  `7,364.85 ms`; one live Graphiti/LM Studio/Neo4j sample drained successfully.

## Deterministic Insights

`GET /api/brain/insights` exposes a fast deterministic summary from the
operational store. It currently reports:

- current ownership parsed from accepted decisions,
- ownership history and ownership changes,
- open action counts by owner,
- unowned open actions.

This does not replace Graphiti. It gives the admin UI and future answer layer a
trustworthy baseline before asking a model to synthesize broader context.

## Multiplayer Projection

`POST /api/brain/project-multiplayer` projects extracted meeting knowledge into
durable multiplayer objects:

- `users` from action owners and ownership decisions,
- `issues` from action items,
- `issue_events` for auditable creation history,
- `pivots` from ownership-changing decisions.

Read APIs:

```text
GET /api/users
GET /api/issues?owner=Ada&status=open
GET /api/issues/:issueId/events
GET /api/pivots
```

Management APIs:

```text
POST /api/issues
PATCH /api/issues/:issueId
```

`POST /api/issues` creates a manual issue with `title`, `project`, `owner`,
`priority`, and `dueDate`. `PATCH /api/issues/:issueId` updates ownership,
status, priority, project metadata, due date, or appends a `comment`. Each
mutation writes immutable `issue_events`, so assignment and status history can
be reviewed from the admin UI or Discord command layer later.

The synthetic analyzer now reports multiplayer metrics too: projected users,
issues, pivots, open issues, and issue counts by owner. Projection is
idempotent, so rerunning it should not duplicate issues or creation events.
Projection also preserves human-managed mutable fields on existing issues,
including owner, status, and priority, so a sync pass cannot clobber a user's
current work state.

## Privacy Defaults

Discord announcements are public-summary only: they include the meeting title,
date, attendees, Notion link, Granola link, and summary. They do not include
Granola private notes or transcript text.

Graphiti episodes are also summary-first by default:

- `PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES=false`
- `PERRY_GRAPHITI_INCLUDE_TRANSCRIPT=false`

Turn those on only when local policy says the semantic graph should store that
extra context.

## Automated Coverage

The regular test suite now covers:

- Default approval mode does not post.
- Queued Granola ingestion deduplicates and drains.
- Large ingestion drains beyond one claim page.
- Processed meetings, decisions, action items, and SQLite FTS storage.
- Graphiti episode formatting and disabled search behavior.
- Typed graph change-set construction, evidence validation, owner pivots, and
  private/transcript exclusion from graph operation evidence.
- Graph change-set persistence, validation status, and applied status updates.
- Graph sync queue posting to a bridge.
- Direct graph change-set drain mode posting to `/change-sets`.
- Bounded typed graph read helpers for entities, facts, evidence, context, and
  timelines.
- Graph backfill from processed meetings.
- Full company-brain gauntlet with dry-run Notion/Discord sinks and graph queue.
- Graph sync failure retry: meeting posting remains complete while graph sync
  requeues with a retry delay.
- Redacted fixture corpus evaluation for decisions, action items, and SQLite
  search.
- Deterministic synthetic company data with realistic edge cases.
- Multiplayer projection idempotency and human issue mutations.
- Privacy defaults for Discord and Graphiti episode payloads.

Run:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## Still Needs Deep Testing

Highest ROI remaining tests:

1. Real captured Granola notes.
   Expand the fixture corpus from real exports, redact sensitive values, and
   assert expected decisions, action items, owners, projects, and graph queries.

2. Retrieval quality.
   Create 25-100 question/answer checks such as "who owns Wallace onboarding",
   "what changed since the last architecture meeting", and "which decisions
   conflict". Compare SQLite FTS, Graphiti search, and hybrid answers.

3. Graph operation quality.
   Score generated `graphChangeSet` objects directly: every relation should have
   evidence, owner pivots should retire previous owner relations, aliases should
   deduplicate, and unresolved project/entity warnings should stay rare.

4. Graph change-set review UX.
   Add UI and API checks for reviewing full persisted graph changes, comparing
   changes against existing facts, and replaying a selected change set after a
   bridge failure.

5. Direct graph query quality.
   Expand read tests over `PerryGraphEntity`, `PerryGraphFact`, evidence, and
   retirements with realistic multi-meeting ownership changes, conflicting
   decisions, and duplicate aliases.

6. Long-running worker soak.
   Run ingestion, FTS, and graph sync workers together for hours with synthetic
   arrivals. Watch stuck `processing` rows, duplicate posts, retry timing, and
   memory growth.

7. Real Notion and Discord sandbox.
   Use a private Discord channel and test Notion data source, then verify page
   properties, content blocks, Discord formatting, links, permissions, and
   duplicate behavior.

8. Bridge/process lifecycle.
   Kill and restart LM Studio, Neo4j, and the Graphiti bridge while jobs are
   queued. Perry should retain completed meeting workflow state and retry graph
   memory later.

9. Privacy boundaries.
   Decide whether `privateNotes` and `transcript` belong in graph memory, and
   test that Discord announcements never include private-only content.

10. Admin operator UX.
   The admin panel should clearly show each dependency's health, recent graph
   sync errors, retry timing, and links from meeting records to Notion, Discord,
   and graph facts.

## Local Brain Gauntlet

Use the local gauntlet as the fast operational check for the company brain:

```powershell
pnpm ops:local-brain-gauntlet
```

It checks the admin API, graph read endpoints, Graphiti bridge when configured,
and LM Studio's OpenAI-compatible `/models` endpoint. Add `--strict` when the
command should fail CI or an overnight run on any warning.

## Local Model Extraction Contract

`src/lmStudioExtraction.ts` defines the strict local semantic extraction contract
for LM Studio/Gemma-style models. The adapter requires JSON shaped as decisions,
action items, typed entities, and confidence. This keeps the model in a bounded
extraction role instead of letting it manipulate untyped graph context directly.

## Discord Brain Commands

The Discord bot now registers a `/brain` command group for bounded company-brain
reads:

- `/brain project name:<project>`
- `/brain owner name:<person>`
- `/brain my-actions`
- `/brain recent-pivots`
- `/brain why entity:<stable-key>`

These commands read from SQLite and Graphiti bounded tools. They should stay
short, cited, and non-noisy.

## Full Acceptance Command

`pnpm brain:acceptance` is the top-level local proof for the company brain. It assumes the live services are already running:

- Perry admin/API at `PERRY_ADMIN_URL`, default `http://127.0.0.1:8792`.
- Graphiti bridge at `PERRY_GRAPHITI_BRIDGE_URL`, default `http://127.0.0.1:8791`.
- LM Studio at `LMSTUDIO_BASE_URL`, default `http://127.0.0.1:1234/v1`.
- Gemma model `gemma-4-e4b-claude-abliterated` loaded.
- Embedding model `text-embedding-nomic-embed-text-v1.5` loaded.

It runs the fixed LM Studio extraction fixtures, pushes a synthetic Granola meeting through dry-run Notion/Discord outputs, drains one graph sync job into Graphiti, replays the generated graph change set, verifies replay readback diff, verifies Graphiti search, and runs the strict live admin gauntlet.

Latest verified result on 2026-05-25: passed in about 18 seconds with Graphiti, Neo4j, LM Studio, Perry admin, and replay readback diff online. The replay checked 10 entities, 9 relations, and 7 evidence records with no missing readback items.

## Generated Scenario Corpus

Use Gemma through LM Studio to generate a larger synthetic company-history corpus:

```powershell
pnpm brain:scenarios:generate -- --count 100 --batch 5 --out tests/fixtures/generated-company-scenarios.json --model gemma-4-e4b-claude-abliterated
```

The generator now defaults to `lmstudio-tools`: Gemma emits ordered operations against a constrained synthetic-company object, such as `create_meeting`, `add_decision`, `add_action`, `add_private_note`, `add_transcript_excerpt`, and `add_search_check`. Perry applies those operations, validates the resulting object, then writes Granola-like payloads plus expected decisions, action items, search checks, and privacy markers. This is intentionally closer to a REPL/tool loop than a giant free-form JSON blob.

If the model under-produces operations, uses duplicate ids, emits `Owner:` action bullets, or returns expectations that do not match its own summary, the generator normalizes the scenario and fills short batches with deterministic fallback scenarios. This keeps the corpus evaluable while still preserving model-generated variety. Use `--mode lmstudio` for the older direct JSON generator or `--mode deterministic` for no-model fixtures.

Evaluate the generated corpus locally without Graphiti:

```powershell
pnpm brain:scenarios:evaluate -- --corpus tests/fixtures/generated-company-scenarios.json
```

Evaluate a Graphiti sample with graph drain, replay, and readback diff:

```powershell
pnpm brain:scenarios:evaluate -- --corpus tests/fixtures/generated-company-scenarios.json --graph true --graph-limit 10
```

Run a combined generation/evaluation soak with report output:

```powershell
pnpm brain:scenarios:soak -- --count 30 --batch 5 --graph-limit 8
```

Latest local result on 2026-05-25:

- Generated 30 Gemma tool-operation scenarios in about 48.5 seconds with no deterministic fallbacks.
- Evaluation rerun passed with decision, action, search, privacy, graph replay, and graph search pass rates all at `1.0`.
- Operational performance remained fast: ingest p50 `0.93 ms`, ingest p95 `2.0 ms`, search p50 `0.09 ms`, search p95 `0.14 ms`.
- Graph sample of 8 generated scenarios passed graph drain, replay diff, and graph search with no missing readback entities, relations, or evidence.
- Report artifacts: `reports/scenarios/2026-05-25T04-58-13-994Z/evaluation-rerun.json` and `reports/scenarios/2026-05-25T04-58-13-994Z/evaluation-rerun.md`.

Larger local model corpus result on 2026-05-25:

- Generated 5,000 Gemma tool-operation scenarios with 3 malformed LM batches falling back to deterministic fixtures.
- Corpus artifact: `reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/generated-company-scenarios.json`.
- Offline evaluation at `--search-limit 100` passed with decision, action, search, and privacy pass rates all `1.0`.
- Evaluation artifact: `reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/evaluation-search-limit-100.json`.
- Use `--search-limit 100` for large generated corpora because model-generated generic claims such as Atlas scope changes intentionally collide many times; top-10 remains useful as a product UX metric, while depth-100 proves retrievability across the stress corpus.

The evaluator also emits brain-health and analytics summaries. Health answers "what is broken or risky?" while analytics answers "what shape does this company corpus have?" The 5,000-scenario analytics pass found 5,000 meetings, 10,519 decisions, 10,001 actions, 8 owners, 1 unowned action, owner action share around `0.125`, repeated decision theme rate `0.1137`, and repeated action theme rate `0.8585`. That high repeated-action rate is useful signal: the generated corpus now stresses search and workload analytics, but the generator still overuses templated action wording.

Run analytics directly against the current Perry DB:

```powershell
pnpm company-brain:analytics -- --report reports/analytics/local.json --markdown reports/analytics/local.md --search-probes 12 --search-limit 25
```

Latest full generated-corpus analytics artifact: `reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/evaluation-analytics-search-limit-100.json`.

## Company Brain Query Suite

Use typed query tools when the task is not just reporting, but asking an operational question over company objects:

```powershell
pnpm company-brain:query -- project-state --project Atlas
pnpm company-brain:query -- owner-load --owner Ada
pnpm company-brain:query -- decision-history --subject "Atlas retrieval"
pnpm company-brain:query -- stale-actions --stale-action-days 14 --owner Ada
pnpm company-brain:query -- conflicts --duplicate-theme-threshold 10
pnpm company-brain:query -- changed-since --since 2026-05-01T00:00:00.000Z --project Atlas
```

These commands map to typed functions in `src/companyBrainQueries.ts`: `queryProjectState`, `queryOwnerLoad`, `queryDecisionHistory`, `queryStaleActions`, `queryConflicts`, and `queryChangedSince`. They are intentionally shaped like future LLM/admin/Discord tools so a model can inspect and manipulate company state without loading raw meeting context.

Use the query gauntlet to prove those tools work against an ingested corpus and return evidence-bearing answers:

```powershell
pnpm company-brain:query-gauntlet -- --corpus reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/generated-company-scenarios.json --report reports/query-gauntlet/gemma-5000.json --markdown reports/query-gauntlet/gemma-5000.md --duplicate-theme-threshold 10 --search-limit 25
```

Latest result on 2026-05-25: 5,000 generated meetings ingested, 10,519 decisions and 10,001 actions queried, 15 dynamic query cases passed with pass rate `1.0`. The gauntlet covered project state, owner load, stale actions, duplicate decision themes, and changed-since queries. Artifact: `reports/query-gauntlet/gemma-5000.json`.
## Temporal Company Arcs

Use the arc evaluator when the question is not just "did this meeting ingest" but "does Perry understand how company state changes over time":

```powershell
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --graph false
```

Each arc creates a sequence of meetings for one project/customer thread. It tests:

- final current owner after handoffs,
- exact ownership-change count,
- historical handoff evidence,
- open action workload by owner,
- local FTS retrieval across the arc,
- Discord privacy boundaries for private notes and transcripts,
- multiplayer projection into users, issues, and pivots.

Graph-backed mode samples the generated meetings through Graphiti, replay diff, and graph search:

```powershell
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --graph true --graph-limit 4 --report reports/arcs/local-arcs-graph.json --markdown reports/arcs/local-arcs-graph.md
```

Robustness options intentionally stress operational reality:

```powershell
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --order reverse --duplicate-replay 4 --graph false
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --order shuffle --duplicate-replay 4 --graph true --graph-limit 4
```

`--order reverse` and `--order shuffle` prove that current ownership follows the meeting's logical Granola timestamp rather than ingestion order. `--duplicate-replay` replays already-processed notes and verifies idempotent duplicate handling.

Latest local result on 2026-05-25:

- 16 meetings across 4 temporal project arcs passed.
- Decision, action, search, ownership, and action-owner pass rates were all `1.0`.
- Ownership changes matched exactly: expected `4`, observed `4`.
- Multiplayer projection produced 8 users, 32 issues, and 16 pivots.
- Graph sample drained 4 jobs with no failures; replay diff and graph search passed for all sampled meetings.
- Reverse-order and shuffled-order imports passed with duplicate replay checks enabled, proving state is meeting-time based and duplicate-safe.
- Operational latency stayed low: shuffled graph-backed run ingest p50 `1.23 ms`, search p50 `0.09 ms`, graph search p50 `32.78 ms`.
- Report artifacts: `reports/arcs/local-arcs-graph.json`, `reports/arcs/local-arcs-shuffle-graph.json`, and their Markdown companions.
## Scale Matrix

Use the scale matrix when moving beyond single-lane validation into measured scale:

```powershell
pnpm company-brain:scale-matrix
```

Default matrix:

- volume runs at 1,000 and 10,000 synthetic meetings,
- temporal arc runs at `10x8` and `25x8`,
- chronological and shuffled imports,
- duplicate replay checks,
- Graphiti disabled by default so local LLM/graph latency does not dominate the volume lane.

Graph sampling is explicit:

```powershell
pnpm company-brain:scale-matrix -- --skip-volume --arcs 10x8 --orders shuffle --duplicate-replay 10 --graph true --graph-limit 4 --outDir reports/scale/graph-smoke
```

Latest local result on 2026-05-25:

- Default offline scale matrix passed in `62,704.97 ms`.
- 1,000-meeting volume run passed at `887.37` meetings/sec with decision/action/search pass rates all `1.0`.
- 10,000-meeting volume run passed at `1,020.75` meetings/sec with 19,310 decisions, 19,310 actions, 10,000 projected issues, and 9,655 pivots.
- `10x8` and `25x8` temporal arc runs passed in chronological and shuffled order with ownership, search, actions, decisions, and duplicate replay all at `1.0`.
- `25x8` shuffled arcs processed 200 meetings with ingest p50 `0.6 ms` and search p50 `0.2 ms`.
- Graph-smoke matrix passed for `10x8` shuffled arcs with graph drain `934.22 ms` and graph search p50 `51.76 ms`.
- Report artifacts: `reports/scale/2026-05-25T05-19-46-047Z/summary.json`, `reports/scale/2026-05-25T05-19-46-047Z/summary.md`, and `reports/scale/graph-smoke/summary.json`.
## Reusable Corpus DB And Speed Split

For repeated performance work, build a reusable SQLite corpus DB once instead of
re-ingesting the same generated JSON for every evaluator run:

```powershell
pnpm company-brain:build-corpus-db -- --corpus reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/generated-company-scenarios.json --db reports/db/gemma-5000-fast.sqlite --reset true --report reports/db/gemma-5000-fast-build.json --markdown reports/db/gemma-5000-fast-build.md
```

The default builder uses the fast backfill path, not the full Notion/Discord/graph
workflow. That is intentional for benchmark fixtures: it materializes meetings,
decisions, action items, audit records, and FTS rows in one batch transaction so
subsequent analytics and retrieval tests measure query behavior rather than disk
commit overhead.

Latest local result on 2026-05-25:

- 5,000 meetings, 10,519 decisions, and 10,001 actions materialized in
  `5,181.69 ms`.
- 25,520 FTS rows flushed in `1,799.01 ms`.
- DB artifact: `reports/db/gemma-5000-fast.sqlite`, about 28.7 MB.

Run the scenario evaluator against that DB without ingest:

```powershell
$env:PERRY_DB_PATH="reports/db/gemma-5000-fast.sqlite"
pnpm brain:scenarios:evaluate -- --corpus reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/generated-company-scenarios.json --skip-ingest true --report reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/evaluation-skip-ingest-fast-db.json --markdown reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/evaluation-skip-ingest-fast-db.md --graph false --search-limit 10 --retry-search-limit 100
```

Latest result: passed in `88,439.39 ms`. Search remained the dominant cost:
10,000 global FTS probes had p50 `8.19 ms`, p95 `15.46 ms`, and average
`8.75 ms`; only 9 probes needed deep retry. This means the next speed target is
not ingestion, but reducing unnecessary global FTS calls and routing normal bot
answers through typed tools.

Typed query tools are much faster on the same prepared DB:

```powershell
$env:PERRY_DB_PATH="reports/db/gemma-5000-fast.sqlite"
pnpm company-brain:query-gauntlet -- --corpus reports/scenarios/overnight-gemma-5000-2026-05-25T01-29-17/generated-company-scenarios.json --skip-ingest true --report reports/query-gauntlet/gemma-5000-skip-ingest-fast-db.json --markdown reports/query-gauntlet/gemma-5000-skip-ingest-fast-db.md --duplicate-theme-threshold 10 --search-limit 25
```

Latest result: 15 evidence-bearing project, owner, conflict, stale-action, and
changed-since query cases passed in `822.91 ms` against the 5,000-meeting DB.
This is the preferred runtime shape for Discord/admin/model tool calls: use
bounded object queries first, then global FTS only when the user is exploring or
when a typed query needs a search fallback.

## Ontology Check

- Typed ontology query gauntlet: `pnpm company-brain:ontology-gauntlet -- --report reports/ontology/local-gauntlet.json --markdown reports/ontology/local-gauntlet.md` passed in `39.72 ms` on 2026-05-25.


## Ontology Performance

Run after `pnpm build`:

```powershell
pnpm perf:ontology -- --count 1000 --report reports/performance/ontology-perf-1000.json --markdown reports/performance/ontology-perf-1000.md
```

This benchmark compares the materialized SQLite ontology read model against legacy graph-change-set JSON parsing for summary, project-scoped, and evidence reads. It should be used before wiring more Discord/model tool calls to ontology state.
