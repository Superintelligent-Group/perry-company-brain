# Graphiti Integration

Graphiti fits Perry as an optional temporal relationship layer, not as the
primary operational store.

Perry should keep SQLite for fast local state, idempotency, approvals, queue
drain, and millisecond admin/API reads. Graphiti should receive approved meeting
episodes after the Notion/Discord workflow completes, then answer higher-order
questions about relationships, changing facts, provenance, and temporal memory.

## Why This Shape

Graphiti is a Python framework for temporal context graphs. It models entities,
facts, validity windows, and source episodes. That maps well to Perry's company
brain:

- Episode: one approved Granola meeting note.
- Entities: people, projects, tools, products, policies, customers, decisions.
- Facts: "Wallace depends on X", "Ada owns Y", "Policy Z changed after meeting A".
- Provenance: the raw meeting note, Notion URL, Discord URL, and source Granola URL.
- Namespace: `PERRY_GRAPHITI_GROUP_ID`, defaulting to `doppel-labs`.

Do not move webhook acknowledgement, approval review, or Notion/Discord posting
behind Graphiti. Graphiti uses LLM extraction and an external graph database, so
it belongs behind a sidecar boundary and timeout.

## Runtime Layout

```text
Granola -> Perry webhook -> SQLite durable queue -> approval/post workflow
                                      |
                                      v
                           Notion durable page + Discord post
                                      |
                                      v
                         optional Graphiti episode sidecar
                                      |
                                      v
                           Neo4j/FalkorDB temporal graph
```

Current implementation:

- `src/graphChangeSet.ts`: Perry-native typed graph operation builder and
  validator.
- `src/graphMemory.ts`: TypeScript bridge client and episode formatter.
- `src/graphMemoryQueue.ts`: durable SQLite graph-sync queue.
- `src/graphSyncWorker.ts`: optional background graph-sync worker.
- `src/graphBackfill.ts`: queues existing processed meetings for Graphiti.
- `integrations/graphiti/graphiti_bridge.py`: tiny HTTP service wrapping
  `graphiti-core`.
- `POST /change-sets` on the bridge: direct Perry graph-operation application
  into Neo4j using `PerryGraphEntity`, `PerryGraphEvidence`,
  `PerryGraphFact`, and `PerryGraphRetirement` nodes.
- `GET /entities`, `GET /facts`, `GET /evidence`, `GET /entity-context`, and
  `GET /timeline` on the bridge: bounded direct reads over Perry-owned graph
  objects.
- `GET /api/graph-sync/jobs`: graph sync queue status.
- `GET /api/graph-sync/change-sets`: graph change-set review list.
- `GET /api/graph-sync/change-sets/:id`: full graph change-set payload for
  admin review and replay tooling.
- `POST /api/graph-sync/backfill?limit=500`: queue processed meeting history.
- `POST /api/graph-sync/drain?limit=10`: manually drain graph sync jobs.
- `GET /api/brain/graph/search?q=...`: Graphiti search endpoint when enabled.
- `GET /api/brain/graph/entities?q=...`: bounded typed entity lookup.
- `GET /api/brain/graph/facts?subject=...`: bounded typed fact lookup.
- `GET /api/brain/graph/evidence?evidenceId=...`: evidence lookup.
- `GET /api/brain/graph/entities/:stableKey/context`: bounded object context.
- `GET /api/brain/graph/timeline?stableKey=...`: entity timeline.
- `GET /api/config`: includes Graphiti bridge status.
- Diagnostics include an optional Graphiti readiness item.

## Local Setup

Graphiti needs Python 3.10+, an OpenAI-compatible model endpoint, and a graph
database. Start Neo4j locally with Docker:

```powershell
docker run --name perry-neo4j -d `
  -p 7474:7474 `
  -p 7687:7687 `
  -e NEO4J_AUTH=neo4j/perry-local-dev-password `
  -e NEO4J_server_memory_heap_initial__size=512m `
  -e NEO4J_server_memory_heap_max__size=2G `
  -e NEO4J_server_memory_pagecache_size=1G `
  -v perry-neo4j-data:/data `
  -v perry-neo4j-logs:/logs `
  neo4j:5.26-community
```

Verify Bolt before starting Graphiti:

```powershell
docker exec perry-neo4j cypher-shell -u neo4j -p perry-local-dev-password "RETURN 1 AS ok"
```

Neo4j Browser will be available at `http://localhost:7474`. Bolt is available
at `bolt://127.0.0.1:7687`.

Install the Python bridge dependencies:

```powershell
uv sync --directory integrations/graphiti
```

For local semantic processing on a desktop GPU, run LM Studio as the
OpenAI-compatible provider. In LM Studio's Developer tab, start the local server
on `http://127.0.0.1:1234/v1`, load a capable chat model, and load an embedding
model. This repo has been smoke-tested against:

- chat: `qwen_qwen3-4b-instruct-2507`
- embeddings: `text-embedding-nomic-embed-text-v1.5`
- embedding dimension: `768`

Check LM Studio before starting Graphiti:

```powershell
$env:GRAPHITI_LLM_MODEL="qwen_qwen3-4b-instruct-2507"
$env:GRAPHITI_EMBEDDING_MODEL="text-embedding-nomic-embed-text-v1.5"
pnpm lmstudio:smoke
```

Configure the Graphiti bridge for LM Studio:

```powershell
$env:GRAPHITI_LLM_PROVIDER="lmstudio"
$env:GRAPHITI_OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
$env:GRAPHITI_OPENAI_API_KEY="lm-studio"
$env:GRAPHITI_LLM_MODEL="qwen_qwen3-4b-instruct-2507"
$env:GRAPHITI_SMALL_LLM_MODEL="qwen_qwen3-4b-instruct-2507"
$env:GRAPHITI_EMBEDDING_MODEL="text-embedding-nomic-embed-text-v1.5"
$env:GRAPHITI_EMBEDDING_DIM="768"
$env:NEO4J_URI="bolt://127.0.0.1:7687"
$env:NEO4J_USER="neo4j"
$env:NEO4J_PASSWORD="perry-local-dev-password"
pnpm graphiti:bridge
```

The bridge exposes `GET /llm/health` so you can verify that the configured chat
and embedding models are visible before trying a Neo4j-backed episode write.
Episode writes are LLM extraction calls, so local GPU runs can take tens of
seconds; use a larger Perry timeout for graph sync than you would for normal
admin API reads.

Then enable Perry:

```powershell
$env:PERRY_GRAPHITI_ENABLED="true"
$env:PERRY_GRAPHITI_BRIDGE_URL="http://127.0.0.1:8791"
$env:PERRY_GRAPHITI_GROUP_ID="doppel-labs"
$env:PERRY_GRAPHITI_TIMEOUT_MS="120000"
$env:PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES="false"
$env:PERRY_GRAPHITI_INCLUDE_TRANSCRIPT="false"
$env:PERRY_GRAPHITI_DIRECT_CHANGESETS="true"
$env:PERRY_GRAPH_SYNC_WORKER="true"
pnpm dev:server
```

Backfill existing processed meeting history:

```powershell
pnpm graphiti:backfill -- --batch 500
pnpm graphiti:backfill -- --batch 500 --drain true
```

The backfill uses Perry's durable meeting rows plus extracted decisions and
action items. If original Granola export payloads are available, import those
first with `pnpm backfill:meetings` to get a richer SQLite brain before queueing
Graphiti sync.

## Data Contract

Perry sends one JSON episode per posted meeting:

```json
{
  "name": "perry-meeting-granola:abc123",
  "source": "json",
  "sourceDescription": "Perry Granola meeting note",
  "referenceTime": "2026-05-23T15:00:00.000Z",
  "groupId": "doppel-labs",
  "body": "{...meeting summary, route, decisions, actionItems, graphChangeSet, graphValidation...}"
}
```

The `graphChangeSet` is Perry's rational object layer. It turns meeting notes
into bounded operations before Graphiti sees them:

- `entities`: stable upserts for meetings, people, projects, decisions, action
  items, Notion pages, Discord messages, and Granola source notes.
- `relations`: explicit assertions such as `HAS_DECISION`, `ASSIGNED_TO`,
  `ASSIGNED_OWNER`, `DOCUMENTED_IN`, and `POSTED_TO`.
- `retirements`: temporal relation removals, such as ending the previous owner
  relationship when a new owner is assigned.
- `evidence`: small source-backed excerpts and URLs. Every entity and relation
  must point to evidence.
- `warnings`: non-blocking extraction gaps, such as an ownership decision whose
  project could not be resolved.

This is intentionally different from giving the model a giant context window.
Perry keeps immutable source evidence and typed operational objects; Graphiti
gets compact, validated operations that are easier to reason over. The LLM can
still enrich temporal memory, but Perry no longer asks it to infer the whole
company graph from a growing prose blob.

Perry writes the episode into `graph_sync_jobs` first. The bridge calls
`graphiti.add_episode(...)` only when `/api/graph-sync/drain` or
`PERRY_GRAPH_SYNC_WORKER=true` processes the job. Search calls
`graphiti.search(query, group_ids=[...])`. If Graphiti has not produced edge
facts for a tiny smoke episode yet, the bridge falls back to a local Neo4j node
search over `Entity` and `Episodic` `name`, `summary`, and `content`.

Perry also persists each generated `graphChangeSet` into `graph_change_sets`.
This makes graph intent reviewable outside the queue payload:

- `validation_status`: `valid` or `invalid`.
- `validation_errors_json` and `validation_warnings_json`: what Perry knew
  before posting to the sidecar.
- `apply_status`: `queued`, `applied`, or `failed`.
- `applied_at` and `last_error`: application outcome.
- `change_set_json`: the exact object operation payload for future replay or
  admin diff views.

By default, Graphiti episodes exclude Granola `privateNotes` and `transcript`.
Opt in with `PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES=true` and
`PERRY_GRAPHITI_INCLUDE_TRANSCRIPT=true` only when the local semantic graph is
allowed to store that material.

Set `PERRY_GRAPHITI_DIRECT_CHANGESETS=true` to drain graph-sync jobs through the
bridge's direct `/change-sets` endpoint instead of `/episodes`. This path writes
Perry-owned graph objects and facts to Neo4j without an LLM extraction call. It
is the lower-latency, more rational graph context path:

```text
Perry GraphChangeSet -> /change-sets -> Neo4j PerryGraphEntity/PerryGraphFact
```

The older `/episodes` path remains available when you explicitly want Graphiti
to perform additional LLM extraction over the meeting episode.

This makes Graphiti eventually consistent. If the bridge, LLM provider, or graph
database is unavailable, Perry still posts to Notion/Discord and retries the
graph sync later.

## Verified Local Smoke

This setup was verified locally on 2026-05-23 with:

- Neo4j Docker image: `neo4j:5.26-community`.
- Graphiti bridge: `http://127.0.0.1:8791`.
- LM Studio OpenAI-compatible server: `http://127.0.0.1:1234/v1`.
- Chat model: `qwen_qwen3-4b-instruct-2507`.
- Embedding model: `text-embedding-nomic-embed-text-v1.5`, `768` dimensions.

The smoke path created a direct Graphiti episode, then drained a Perry
`graph_sync_jobs` record into the bridge. Neo4j showed `Episodic` and `Entity`
nodes plus extracted edge facts such as:

- `Perry syncs Granola meeting memory into local Neo4j through Graphiti`.
- `keep LM Studio as the local semantic backend`.

Useful local checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8791/health
Invoke-RestMethod http://127.0.0.1:8791/llm/health
Invoke-RestMethod "http://localhost:8787/api/graph-sync/change-sets?detail=true" -Headers @{ Authorization = "Bearer $env:ADMIN_API_TOKEN" }
Invoke-RestMethod "http://127.0.0.1:8791/entities?groupId=direct-smoke&q=wallace"
Invoke-RestMethod "http://127.0.0.1:8791/facts?groupId=direct-smoke&subject=project:wallace&active=true"
Invoke-RestMethod "http://127.0.0.1:8791/entity-context?groupId=direct-smoke&stableKey=project:wallace"
docker exec perry-neo4j cypher-shell -u neo4j -p perry-local-dev-password "MATCH (n) RETURN labels(n) AS labels, count(n) AS count ORDER BY count DESC"
```

The direct change-set path was also verified locally on 2026-05-23 without any
LM Studio model loaded. A smoke change set for `direct-smoke` produced:

- `PerryGraphEntity`: 3
- `PerryGraphEvidence`: 1
- `PerryGraphFact`: 1
- active `ASSIGNED_OWNER` relation from `project:wallace` to `person:ada`

## Product Meaning

SQLite answers: "What did we ingest, what is pending, what did we decide in this
meeting, and what should Discord post?"

The Perry graph object layer answers: "Which typed objects and relations should
exist because of this meeting, and what evidence proves each mutation?"

The graph read tools answer: "What bounded context should a UI, Discord command,
or LLM receive about this exact entity?"

Graphiti answers: "How has this project changed over time, who owns the moving
parts, which past decisions conflict, what entity relationships matter, and what
facts are true now versus superseded?"

That is the right split for a company brain: Perry owns workflow correctness and
latency; Perry-owned graph operations keep context rational; Graphiti owns
temporal meaning.

## Replay Tooling

Persisted graph change sets can be replayed through the admin API and admin UI.
This gives Perry a deterministic debugging loop for graph memory mutations:

1. Inspect a persisted change set from `/api/graph-sync/change-sets/:id`.
2. Replay it with `POST /api/graph-sync/change-sets/:id/replay` using an admin
   token.
3. Perry validates the stored object shape and graph constraints before posting.
4. Perry posts the stored change set directly to the Graphiti bridge
   `/change-sets` endpoint with the persisted `groupId`.
5. Perry runs a bounded readback diff against entities, facts, retirements,
   and evidence.
6. Perry records the replay result by updating `apply_status`, `applied_at`,
   `last_error`, and audit-log events.

This is intentionally separate from queue draining. Queue draining handles normal
background sync. Replay handles operator-controlled repair, debugging, and
re-application after bridge or Neo4j resets.

The replay diff is proof-oriented. A successful bridge write is not treated as
full confidence by itself; Perry also asks Graphiti for bounded readback and
reports missing entities, relations, retirements, evidence, or read errors.

## Next Hardening Passes

1. Add graph diff drill-down UI for exact missing relation/evidence lists.
2. Expand extraction quality around the new ontology models: `Customer`,
   `Repository`, `Policy`, `Channel`, and `DataSource`.
3. Measure sidecar latency separately from Perry's HTTP latency, because Graphiti
   extraction is intentionally heavier than SQLite FTS.


