# Company Brain Ontology

Perry's graph model is intentionally operational: it tracks company state, why it changed, and what evidence proves it. The graph should not become a raw transcript dump. Meetings, decisions, actions, docs, benchmarks, and tool outputs should become typed objects with bounded evidence.

## Current Core Entities

- `meeting`: a Granola meeting Perry processed.
- `person`: creator, attendee, owner, assignee, reviewer.
- `project`: routed project or inferred product/work area.
- `decision`: accepted/proposed decision extracted from a meeting.
- `action_item`: extracted follow-up work from a meeting.
- `repository`, `customer`, `policy`: operating objects mentioned by the team.
- `channel`, `data_source`, `notion_page`, `discord_message`, `source_note`: integration and provenance surfaces.

## Richer Company-State Entities

The richer ontology adds the objects that make Perry useful as a company brain rather than a meeting archive:

- `goal`: desired outcome, OKR, objective, or target.
- `metric`: KPI, SLO, p50/p95/p99 latency, quality measure, or scale target.
- `risk`: future bad state or accepted uncertainty.
- `blocker`: current dependency preventing progress.
- `open_question`: unresolved decision point.
- `capability`: durable workflow or power the company is building.
- `feature`: specific product or system behavior.
- `artifact`: document, config, dashboard, prompt, DB, report file, or other concrete work product.
- `benchmark_report`: empirical performance or evaluation artifact.

## Important Relations

Meeting and provenance relations:

- `CAPTURED_BY`, `ATTENDED_BY`, `DERIVED_FROM`
- `ROUTED_TO_PROJECT`, `ROUTED_TO_CHANNEL`, `WRITES_TO_DATA_SOURCE`
- `DOCUMENTED_IN`, `POSTED_TO`

Work and ownership relations:

- `HAS_DECISION`, `HAS_ACTION_ITEM`
- `ASSIGNED_TO`, `ASSIGNED_OWNER`, `HAS_FALLBACK_REVIEWER`

Operating-object relations:

- `MENTIONS_REPOSITORY`, `MENTIONS_CUSTOMER`, `REFERENCES_POLICY`
- `MENTIONS_GOAL`, `MENTIONS_METRIC`, `MENTIONS_RISK`, `MENTIONS_BLOCKER`, `MENTIONS_OPEN_QUESTION`
- `MENTIONS_CAPABILITY`, `MENTIONS_FEATURE`, `REFERENCES_ARTIFACT`, `REFERENCES_BENCHMARK_REPORT`

Company-state relations:

- `SUPPORTS_GOAL`: project to goal.
- `HAS_RISK`: project to risk.
- `BLOCKED_BY`: project to blocker.
- `HAS_OPEN_QUESTION`: project to unresolved question.
- `IMPLEMENTS_CAPABILITY`: project or feature to capability.
- `VALIDATED_BY`: feature, metric, or artifact to benchmark report.

## Extraction Contract

The current deterministic extractor recognizes explicit operating language such as:

```text
Goal: reduce search p95 below 20 ms.
Metric: p95 search latency 15 ms.
Risk: Graphiti bridge outage during sync.
Blocker: missing Notion permissions.
Open question: should typed tools answer by default?
Capability: typed company brain queries.
Feature: adaptive search retries.
Artifact: reports/db/gemma-5000-fast.sqlite.
Benchmark report: Gemma 5000 Query Gauntlet.
```

This is deliberate. Perry should prefer explicit company-state labels over guessing from vague lowercase prose. LLM extraction can later generate these labels as structured operations, but graph insertion should remain typed, validated, and evidence-backed.

## Product Rule

For Discord/admin/model answers, use typed object queries first and global search second. A model should ask for project state, owner load, decision history, conflicts, stale work, or changed-since context instead of loading a giant raw meeting context. The ontology exists so fast tools can manipulate company objects directly.
## Query Surface

Ontology objects are materialized into indexed SQLite tables when graph change sets are queued. This gives Discord, the admin panel, and model tools a fast local read path without reparsing historical change-set JSON on every request. If a database has not been backfilled yet, the query module can still fall back to persisted graph change sets.

Library module:

- `src/companyBrainOntologyQueries.ts`
- `getOntologyIndex(limit)`
- `queryGoals`, `queryMetrics`, `queryRisks`, `queryBlockers`, `queryOpenQuestions`
- `queryCapabilities`, `queryFeatures`, `queryArtifacts`, `queryBenchmarkReports`
- `queryEvidenceFor(stableKey)`
- `queryOntologyChangedSince(since, options)`

Admin API:

```text
GET /api/brain/ontology
GET /api/brain/ontology?type=risk&project=Wallace&limit=25
GET /api/brain/ontology?type=goal&q=latency
GET /api/brain/ontology/evidence?stableKey=goal:reduce-search-p95-below-20-ms
GET /api/brain/ontology/changed-since?since=2026-05-25T00:00:00.000Z
GET /api/brain/tools/project-state?project=Wallace&types=goal,risk,blocker
GET /api/brain/tools/changed-since?since=2026-05-25T00:00:00.000Z&project=Wallace
GET /api/brain/tools/evidence?stableKey=goal:reduce-search-p95-below-20-ms
```

The summary endpoint returns type counts and the most-linked projects. The typed endpoint returns bounded entities with incoming/outgoing relations and evidence excerpts. The evidence endpoint returns the evidence and relations for a stable graph key. The changed-since endpoint is intended for low-latency agent/tool refreshes after a meeting is processed. The `/api/brain/tools/*` endpoints return compact, stable contracts for model tool calls: entity references, counts, relation refs, and capped evidence excerpts instead of UI-shaped payloads or raw meeting context.
Discord command surface:

```text
/brain state type:risk project:Wallace limit:5
/brain changed since:2026-05-25T00:00:00.000Z project:Wallace
/brain evidence entity:goal:reduce-search-p95-below-20-ms
```

These commands are intentionally bounded and ephemeral. They return typed objects, counts, and evidence snippets from the local ontology index instead of sending raw meeting context into Discord.


## Materialized Index

SQLite now owns a local ontology read model:

- `ontology_entities`: stable key, type, name, aliases, properties, evidence IDs, source meeting IDs, timestamps.
- `ontology_relations`: subject, relation, object, evidence, confidence, source meeting, timestamps.
- `ontology_evidence`: bounded proof records from meetings, decisions, actions, Notion, Discord, or Granola.
- `ontology_entity_evidence`: many-to-many entity/evidence lookup.

Backfill existing databases after `pnpm build`. By default this clears and rebuilds the materialized ontology index from all graph change sets:

```powershell
pnpm company-brain:ontology-backfill -- --limit 100000 --report reports/ontology/backfill.json --markdown reports/ontology/backfill.md
```

Use `--db .tmp/ontology-backfill-smoke.sqlite` for isolated smoke runs. Use `--dry-run true` to estimate impact without writing, `--incremental true` to avoid clearing current ontology rows, and `--changed-since 2026-05-25T00:00:00.000Z` to only replay recently updated change sets. The admin app includes an Ontology Cockpit panel for type/project-filtered reads, changed-since inspection, search, and an evidence drawer that mirrors `/brain evidence`.

## Agent Tool Contract Gauntlet

After `pnpm build`, run the LLM-tool contract gauntlet:

```powershell
pnpm agent-tools:gauntlet -- --report reports/agent-tools/contract-gauntlet.json --markdown reports/agent-tools/contract-gauntlet.md
```

The gauntlet processes one synthetic Granola meeting with private-note and transcript leak markers, then calls the compact tool contracts for project state, changed-since, evidence, and ontology health. It fails if payloads exceed the byte budget, calls exceed the latency budget, evidence excerpts exceed the cap, required relations/evidence are missing, or private/transcript markers leak into tool payloads.

## Ontology Health

Operators and admin UI can inspect ontology materialization drift through:

```text
GET /api/brain/ontology/health?changeSetLimit=100
```

The report checks sampled graph change-set parsing, materialized entity/relation/evidence coverage, missing evidence links, orphaned evidence, duplicate type/name groups, and project/meeting link coverage. Critical failures should block trust in model/Discord answers; warnings are repair/backfill signals.
## Persistent Corpus Gauntlet

For a reusable on-disk corpus with ontology rows and agent-tool calls, run after `pnpm build`:

```powershell
pnpm agent-tools:corpus-gauntlet -- --reset true --limit 250 --db reports/db/agent-tool-corpus.sqlite --report reports/agent-tools/corpus-gauntlet.json --markdown reports/agent-tools/corpus-gauntlet.md
```

This differs from the fast meeting corpus builder: it ingests through the workflow with direct graph change sets enabled, rebuilds the materialized ontology index, and then runs project-state, changed-since, evidence, and health calls against a persistent SQLite DB. Re-run with `--ingest false` omitted only when the DB already exists and you want to reuse it.

## Repair Dry Run

Ontology repair is dry-run by default:

```powershell
pnpm ontology:repair -- --db reports/db/agent-tool-corpus.sqlite --report reports/ontology/repair-dry-run.json --markdown reports/ontology/repair-dry-run.md
```

Use `--apply true` to rebuild the materialized ontology index from graph change sets. The repair report includes the health checks, planned actions, and backfill counts. Duplicate entity groups and unprojected entities are intentionally reported for review instead of being auto-mutated.
## Performance Harness

After `pnpm build`, compare indexed ontology reads with the legacy JSON-parse path:

```powershell
pnpm perf:ontology -- --count 1000 --budget-materialized-project-goals-ms 5 --budget-materialized-evidence-ms 2 --report reports/performance/ontology-perf-1000.json --markdown reports/performance/ontology-perf-1000.md
```

The harness generates synthetic graph change sets, lets the store materialize ontology rows, then times materialized entity/relation reads, summary and project queries, evidence lookup, and the legacy change-set JSON parse/index path. Optional `--budget-*` flags make the run fail when a key read exceeds its latency budget. This is the acceptance test for keeping Discord/model tool calls bounded to indexed object reads instead of large context reconstruction.
## Ontology Gauntlet

Run the local ontology gauntlet after `pnpm build`:

```powershell
pnpm company-brain:ontology-gauntlet -- --report reports/ontology/local-gauntlet.json --markdown reports/ontology/local-gauntlet.md
```

Latest local result on 2026-05-25: passed in `51.8 ms`. The gauntlet processed one synthetic Wallace meeting, persisted one graph change set, and proved project-scoped queries for goal, risk, blocker, open question, capability, and evidence.









