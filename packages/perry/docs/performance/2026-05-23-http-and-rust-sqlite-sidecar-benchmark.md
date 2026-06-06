# HTTP Latency and Rust SQLite Sidecar Benchmark

Date: 2026-05-23

## Purpose

This pass separates product-runtime performance from raw storage ceiling checks.
Perry should remain a TypeScript Discord, Notion, Granola, and admin-panel
application. Rust is useful here as a sidecar benchmark so we can understand how
much headroom SQLite has before blaming the TypeScript runtime.

## TypeScript HTTP Benchmark

The benchmark ran against the built admin server on `http://localhost:8787` with
`PERRY_DB_PATH=:memory:`, a seeded in-memory dataset, and the background FTS
worker enabled.

```sh
pnpm build
pnpm start:server
pnpm perf:http -- 300
pnpm perf:http -- 500 16
```

Results:

| Endpoint | p50 | p95 | Max |
| --- | ---: | ---: | ---: |
| `GET /api/health` | 2.58ms | 3.56ms | 5.46ms |
| `GET /api/approvals?status=pending&limit=100` | 2.80ms | 4.26ms | 11.19ms |
| `GET /api/brain/search?q=wallace&limit=25` | 1.05ms | 1.83ms | 4.10ms |
| `POST /api/granola/preview` | 1.27ms | 2.16ms | 4.39ms |

Single-client tiny-read results after adding lean tool-call paths:

| Endpoint | p50 | p95 | Max |
| --- | ---: | ---: | ---: |
| `GET /api/ping` | 0.39ms | 0.84ms | 3.32ms |
| `GET /api/counts?status=pending` | 0.45ms | 0.84ms | 6.12ms |
| `GET /api/approvals?status=pending&limit=5` | 0.46ms | 0.81ms | 3.54ms |
| `GET /api/brain/search?q=wallace&limit=1` | 0.36ms | 0.48ms | 2.69ms |
| `GET /api/brain/search?q=wallace&limit=25` | 0.53ms | 0.86ms | 2.63ms |
| `POST /api/granola/zapier?dryRun=true` | 0.83ms | 1.52ms | 5.17ms |

16-concurrent-client results:

| Endpoint | p50 | p95 | Max |
| --- | ---: | ---: | ---: |
| `GET /api/counts?status=pending` | 3.86ms | 7.02ms | 7.70ms |
| `GET /api/approvals?status=pending&limit=5` | 7.50ms | 14.76ms | 16.95ms |
| `GET /api/brain/search?q=wallace&limit=1` | 2.71ms | 5.62ms | 9.34ms |
| `GET /api/brain/search?q=wallace&limit=25` | 5.86ms | 10.75ms | 13.06ms |
| `POST /api/granola/preview` | 5.87ms | 9.69ms | 10.14ms |
| `POST /api/granola/zapier?dryRun=true` | 6.90ms | 13.96ms | 19.04ms |

The approval list endpoint returns summary records by default. Full JSON
approval payloads remain available with `detail=true` for debugging and approve
flows. On a seeded 100-row queue, summary responses were 46,681 bytes versus
109,851 bytes for full-detail responses.

Interpretation:

- The admin API is not currently a bottleneck at local scale.
- Fast inference/tool-call loops should prefer `/api/ping`, `/api/counts`,
  tiny approval pages, and low-limit search calls instead of diagnostics or
  full-detail list endpoints.
- Approval summary lists and search requests are comfortably below interactive
  UI thresholds. Full-detail approval lists are intentionally slower and larger.
- Preview stays cheap because it normalizes and extracts without touching
  Discord or Notion.
- Webhook posting should keep Discord and Notion work asynchronous or
  approval-gated so those external APIs never dominate request latency.

## Rust SQLite Sidecar

The Rust sidecar lives at `benchmarks/rust-sqlite`. It uses `rusqlite` with
bundled SQLite and writes Perry-shaped synthetic rows, but it does not call the
TypeScript runtime.

```sh
cd benchmarks/rust-sqlite
cargo run --release -- --records 10000 --db :memory:
cargo run --release -- --records 50000 --db :memory:
```

Results:

| Records | Rows Written | Bulk Insert Time | Meeting Throughput | Total Row Throughput |
| ---: | ---: | ---: | ---: | ---: |
| 10,000 | 110,000 | 533.1ms | 18,757 meetings/sec | 205,586 rows/sec |
| 50,000 | 550,000 | 3.33s | 15,003 meetings/sec | 164,928 rows/sec |

Each synthetic meeting writes:

- one meeting row
- two decision rows
- two action item rows
- one approval row
- five deferred FTS queue rows

## Product Decision

Rust does not make sense as the main Perry runtime right now. The TypeScript
implementation already measures well for the company-brain workload, and the
real product complexity is Discord, Notion, Granola, identity mapping, approval
flows, routing, search, source preservation, and admin UX.

The Rust result is still valuable. It gives us a rough upper bound for raw
append-only SQLite inserts. If Perry later needs to process thousands of
companies or very large historical imports, Rust can be revisited for a narrow
native worker, not for the whole application.

## Current Guidance

Keep the runtime in TypeScript. Optimize through:

- bounded HTTP handlers
- paginated admin APIs
- background FTS flushing
- append-only backfill mode for historical imports
- file-backed SQLite on an uncompressed path
- avoiding Discord and Notion calls in hot ingestion transactions
- explicit search/project/date indexes before language rewrites

The current data points say the architecture needs better product workflow and
operational polish more than it needs a faster language.
