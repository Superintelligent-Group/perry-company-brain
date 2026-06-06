# Perry Performance

This folder tracks empirical performance work for Perry's company-brain runtime.

## Reports

- [2026-05-23 synthetic brain storage benchmark](2026-05-23-synthetic-brain-storage-benchmark.md)
- [2026-05-23 HTTP latency and Rust SQLite sidecar benchmark](2026-05-23-http-and-rust-sqlite-sidecar-benchmark.md)
- [2026-05-23 local LLM Graphiti model routing benchmark](2026-05-23-local-llm-graphiti-model-routing-benchmark.md)

## Benchmark Commands

```sh
pnpm build
pnpm perf:brain -- 10000
pnpm perf:brain -- 50000
pnpm perf:http -- 300
pnpm perf:http -- 500 16
pnpm backfill:meetings -- --input granola-export.jsonl --batch 1000
```

Use `PERRY_DB_PATH=:memory:` for pure application/storage overhead, or set
`PERRY_DB_PATH` to an uncompressed local path for file-backed SQLite testing.

The Rust sidecar is intentionally outside the TypeScript product runtime:

```sh
cd benchmarks/rust-sqlite
cargo run --release -- --records 50000 --db :memory:
```

## Current Performance Thesis

The first scaling bottleneck is storage and index shape, not TypeScript CPU.
Measured wins have come from:

- connection caching
- one-time migrations
- prepared statement caching
- batch transactions
- batch backfill APIs
- append-only FTS queue writes for known-new backfills
- deferred FTS indexing
- set-based FTS queue flushing
- list/status/date indexes
- lightweight approval summary rows for admin list views
- direct approval summary metadata on write paths to avoid JSON re-parsing
- lean tool-call endpoints for sub-millisecond tiny reads
- durable ingestion queue with idempotency keys for reliable fast acknowledgement

Next scaling work should focus on keyset pagination, narrower search domains,
route and project columns on meeting rows, file-backed testing on an
uncompressed path, and keeping slow external APIs out of the write path.

## Operational Shape

Granola webhooks can run in two modes:

- inline: process immediately through the existing workflow.
- queue: write an idempotent `granola.ingest` job quickly, then process it with
  `/api/ingestion/drain` or `PERRY_INGESTION_WORKER=true`.

Queue mode is the safer production default once Discord and Notion calls are
live, because it separates webhook acknowledgement from external API latency.
Keep dry-run and preview flows inline. Queue mode records a durable job, so
`/api/granola/zapier?enqueue=true&dryRun=true` is rejected instead of silently
creating state for what should have been a preview.

Queue-specific benchmark command:

```powershell
pnpm perf:ingestion-queue -- 5000
```

Latest in-memory result:

- enqueue unique jobs: 314.77ms total, 15,885 jobs/sec
- dedupe existing jobs: 157.96ms total, 31,654 checks/sec
- drain to approval queue: 1,449.19ms total, 3,450 jobs/sec

The important implication is that webhook acknowledgement is not the bottleneck.
The heavier path is turning queued jobs into meeting records, extracted
knowledge, and approval rows. The current batch drain path keeps approval-mode
jobs inside SQLite transactions and falls back to the normal async workflow only
for jobs that need Notion or Discord calls. That path is now comfortably above
normal team meeting volume and viable for large historical imports through the
same queue abstraction.

## Latest Read

The latest 100k in-memory synthetic run shows:

- 12,051 meeting ingests/sec in append-only batch-backfill mode before deferred FTS catch-up
- 29,595 approval writes/sec in append-only batch-backfill mode
- sub-millisecond paginated admin list views
- 70k FTS rows/sec flush throughput
- single-digit millisecond common broad search at 50k-100k
- low double-digit millisecond worst typed search at 100k

The latest 50k confirmation run after the backfill command and append-only FTS
queue path shows:

- 10,476 meeting ingests/sec
- 26,866 approval writes/sec
- 68.8k FTS rows/sec flush throughput
- 8.85s total measured runtime

The latest 50k approval-list read shows:

- meeting ingest: 12,320 meetings/sec
- approval creation: 25,917 approvals/sec
- FTS flush: 81,988 rows/sec
- total measured runtime: 7.85s

The latest single-client tiny-read HTTP pass shows:

- `GET /api/ping`: 0.39ms p50, 0.84ms p95
- `GET /api/counts?status=pending`: 0.45ms p50, 0.84ms p95
- `GET /api/approvals?status=pending&limit=5`: 0.46ms p50, 0.81ms p95
- `GET /api/brain/search?q=wallace&limit=1`: 0.36ms p50, 0.48ms p95
- `GET /api/brain/search?q=wallace&limit=25`: 0.53ms p50, 0.86ms p95

The latest 250k in-memory synthetic run shows:

- 11,694 meeting ingests/sec
- 29,518 approval writes/sec
- 65.5k FTS rows/sec flush throughput
- broad search mostly 14-19ms
- worst typed search 40.5ms

The latest single-client local admin HTTP pass against the built server shows:

- `GET /api/health`: 2.58ms p50, 3.56ms p95
- `GET /api/approvals?status=pending&limit=100`: 2.80ms p50, 4.26ms p95
- `GET /api/brain/search?q=wallace&limit=25`: 1.05ms p50, 1.83ms p95
- `POST /api/granola/preview`: 1.27ms p50, 2.16ms p95

The latest 16-concurrent-client local admin HTTP pass shows:

- `GET /api/counts?status=pending`: 3.86ms p50, 7.02ms p95
- `GET /api/approvals?status=pending&limit=5`: 7.50ms p50, 14.76ms p95
- `GET /api/brain/search?q=wallace&limit=1`: 2.71ms p50, 5.62ms p95
- `GET /api/brain/search?q=wallace&limit=25`: 5.86ms p50, 10.75ms p95
- `POST /api/granola/preview`: 5.87ms p50, 9.69ms p95
- `POST /api/granola/zapier?dryRun=true`: 6.90ms p50, 13.96ms p95

Direct response-size check on a 100-row seeded queue:

- approval summary payload: 46,681 bytes
- full approval payload: 109,851 bytes

The Rust SQLite sidecar shows a useful raw-storage ceiling, but does not justify
moving Perry's product runtime off TypeScript yet:

- 10k in-memory append-only synthetic meetings: 18,757 meetings/sec
- 50k in-memory append-only synthetic meetings: 15,003 meetings/sec

The latest local Graphiti/LM Studio benchmark shows model routing is the right
quality path:

- Gemma 4 alone drained jobs but failed all fixture graph retrieval checks in
  this Graphiti extraction path.
- Qwen 4B with 16k context fixed the prior accumulated-group 4k context failure.
- Gemma 4 main 8k plus Qwen small 8k passed the 100-meeting synthetic graph
  workload in 64.36s with 5/5 graph checks passing.
- Gemma 4 main 8k plus Qwen small 16k also passed, but took 78.94s on the same
  synthetic workload.

The current local semantic default should use Gemma 4 for synthesis and Qwen 4B
16k for Graphiti's structured extraction contract.

The current architecture is good enough for large internal-team scale on a
single local SQLite process, assuming file-backed SQLite runs on an uncompressed
path and FTS flushing is backgrounded.

There are now two explicit performance modes:

- live-safe mode: upsert, conflict handling, replacement-safe knowledge updates, normal audit.
- append-only backfill mode: known-new rows, audit suppressed, batch transaction.
- append-only batch-backfill mode: same safety assumptions, but with chunked store APIs for lower per-record overhead.

Backfills should use append-only batch-backfill mode in chunks. Live webhook
processing should use the safer upsert path.
