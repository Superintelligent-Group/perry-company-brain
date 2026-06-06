# Synthetic Brain Storage Benchmark

Date: 2026-05-23

## Benchmark Command

```sh
pnpm build
pnpm perf:brain -- 10000
pnpm perf:brain -- 50000
pnpm perf:http -- 300
pnpm perf:http -- 500 16
pnpm backfill:meetings -- --input granola-export.jsonl --batch 1000
```

The benchmark uses `PERRY_DB_PATH=:memory:` by default to avoid compressed
filesystem SQLite failures in this workspace. It measures:

- meeting ingest
- deterministic knowledge extraction
- decision/action persistence
- approval creation
- list views
- deferred FTS indexing
- brain search

## Baseline History

### Before Storage Tuning

10k synthetic meetings:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 31.18s | 321 meetings/sec |
| Total measured | 33.38s | n/a |

### After Connection Cache, Statements, Transactions, Deferred FTS

10k synthetic meetings:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 1.77s | 5,654 meetings/sec |
| Create approvals | 0.64s | 15,718 approvals/sec |
| List meetings | 73.5ms | 136k rows/sec |
| List decisions | 0.5ms | 195k rows/sec |
| List action items | 0.5ms | 187k rows/sec |
| List pending approvals | 156.9ms | 63.8k rows/sec |
| Flush FTS queue | 1.07s | 27,909 FTS rows/sec |
| Common-term search | 11-25ms | n/a |
| Negative search | 0.2ms | n/a |
| Total measured | 3.78s | n/a |

50k synthetic meetings:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 8.51s | 5,877 meetings/sec |
| Create approvals | 2.55s | 19,588 approvals/sec |
| List meetings | 292.0ms | 171k rows/sec |
| List decisions | 0.8ms | 133k rows/sec |
| List action items | 1.0ms | 103k rows/sec |
| List pending approvals | 837.6ms | 59.7k rows/sec |
| Flush FTS queue | 4.30s | 34,900 FTS rows/sec |
| Common-term search | 75-131ms | n/a |
| Negative search | 0.3ms | n/a |
| Total measured | 16.90s | n/a |

### After Pagination, Composite Approval Index, Typed FTS Query Pushdown

10k synthetic meetings:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 1.33s | 7,496 meetings/sec |
| Create approvals | 0.48s | 20,720 approvals/sec |
| List meetings page | 0.7ms | 146k rows/sec |
| List decisions | 0.3ms | 307k rows/sec |
| List action items | 0.4ms | 263k rows/sec |
| List pending approvals page | 0.7ms | 134k rows/sec |
| Flush FTS queue | 0.58s | 51,745 FTS rows/sec |
| Common-term search | 0.6-1.5ms | n/a |
| Negative search | 0.1ms | n/a |
| Worst typed search | 12.5ms | n/a |
| Total measured | 2.42s | n/a |

50k synthetic meetings:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 7.39s | 6,767 meetings/sec |
| Create approvals | 2.70s | 18,507 approvals/sec |
| List meetings page | 0.8ms | 127k rows/sec |
| List decisions | 0.4ms | 279k rows/sec |
| List action items | 0.5ms | 213k rows/sec |
| List pending approvals page | 0.7ms | 138k rows/sec |
| Flush FTS queue | 3.95s | 38,021 FTS rows/sec |
| Common-term search | 2.5-5.5ms | n/a |
| Negative search | 0.2ms | n/a |
| Worst typed search | 6.6ms | n/a |
| Total measured | 14.07s | n/a |

100k synthetic meetings:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 19.12s | 5,229 meetings/sec |
| Create approvals | 5.74s | 17,436 approvals/sec |
| List meetings page | 0.7ms | 135k rows/sec |
| List decisions | 0.4ms | 285k rows/sec |
| List action items | 0.4ms | 252k rows/sec |
| List pending approvals page | 0.6ms | 160k rows/sec |
| Flush FTS queue | 6.76s | 44,389 FTS rows/sec |
| Common-term search | 4.6-6.6ms | n/a |
| Negative search | 0.3ms | n/a |
| Worst typed search | 12.6ms | n/a |
| Total measured | 31.67s | n/a |

### After Append-Only Backfill Fast Path

The benchmark now defaults to append-only backfill mode:

- `PERRY_PERF_AUDIT=bulk-off`
- `PERRY_PERF_BACKFILL_FAST=true`

This mode is appropriate for known-new historical imports. It skips upsert
conflict handling, old-knowledge deletes, replacement checks, and per-row audit.

50k synthetic meetings, live-safe mode:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 8.81s | 5,675 meetings/sec |
| Create approvals | 3.73s | 13,393 approvals/sec |
| Flush FTS queue | 3.72s | 40,347 FTS rows/sec |
| Common-term search | 2.8-6.7ms | n/a |
| Worst typed search | 6.1ms | n/a |
| Total measured | 16.30s | n/a |

50k synthetic meetings, append-only backfill mode:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 4.63s | 10,809 meetings/sec |
| Create approvals | 1.76s | 28,424 approvals/sec |
| Flush FTS queue | 4.01s | 37,427 FTS rows/sec |
| Common-term search | 2.5-4.7ms | n/a |
| Worst typed search | 10.6ms | n/a |
| Total measured | 10.43s | n/a |

100k synthetic meetings, append-only backfill mode:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 12.73s | 7,854 meetings/sec |
| Create approvals | 4.86s | 20,575 approvals/sec |
| Flush FTS queue | 9.69s | 30,947 FTS rows/sec |
| Common-term search | 7.8-9.8ms | n/a |
| Worst typed search | 20.2ms | n/a |
| Total measured | 27.37s | n/a |

### After Set-Based FTS Flush and Batch Backfill APIs

This pass keeps TypeScript as the product runtime and removes two avoidable
costs:

- `flushFtsQueue` now moves queued rows into FTS with set-based SQLite
  `INSERT ... SELECT` and deletes them in bulk.
- historical backfills can call chunked batch APIs instead of paying one store
  wrapper call per meeting or approval.

100k synthetic meetings, append-only batch-backfill mode:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 8.30s | 12,051 meetings/sec |
| Create approvals | 3.38s | 29,595 approvals/sec |
| Flush FTS queue | 4.29s | 70,001 FTS rows/sec |
| Common-term search | 6.1-6.7ms | n/a |
| Worst typed search | 27.0ms | n/a |
| Total measured | 16.04s | n/a |

250k synthetic meetings, append-only batch-backfill mode:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 21.38s | 11,694 meetings/sec |
| Create approvals | 8.47s | 29,518 approvals/sec |
| Flush FTS queue | 11.45s | 65,499 FTS rows/sec |
| Common-term search | 13.9-19.4ms | n/a |
| Worst typed search | 40.5ms | n/a |
| Total measured | 41.46s | n/a |

### After Backfill Operator Command and Append-Only FTS Queue Writes

This pass added the actual operator command for historical JSON/JSONL imports:

```sh
pnpm backfill:meetings -- --input granola-export.jsonl --batch 1000
```

It also keeps live webhook FTS queueing conflict-safe while letting known-new
backfills use append-only queue inserts.

5k JSONL backfill smoke:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Insert meetings and approvals | 232.3ms | 21,526 meetings/sec |

50k synthetic benchmark confirmation:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 4.77s | 10,476 meetings/sec |
| Create approvals | 1.86s | 26,866 approvals/sec |
| Flush FTS queue | 2.18s | 68,781 FTS rows/sec |
| Common-term search | 3.5-5.7ms | n/a |
| Worst typed search | 6.8ms | n/a |
| Total measured | 8.85s | n/a |

### After Lightweight Approval Summary Rows

This pass added stored approval summary columns:

- `route_project`
- `route_reason`
- `publish_mode`
- `decision_count`
- `action_item_count`

The admin approval list now reads these columns by default instead of returning
and parsing full `payload_json`, `knowledge_json`, and `route_json` fields.

50k synthetic benchmark confirmation:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 4.34s | 11,531 meetings/sec |
| Create approvals | 2.20s | 22,737 approvals/sec |
| List pending approval summaries | 1.3ms | 75,563 rows/sec |
| List pending approvals full | 3.7ms | 27,356 rows/sec |
| Flush FTS queue | 2.21s | 67,928 FTS rows/sec |
| Total measured | 8.79s | n/a |

### After Direct Approval Summary Metadata

The previous pass made approval reads lighter but still derived summary columns
by parsing `knowledge_json` and `route_json` during writes. This pass lets
workflow and backfill callers pass the route summary and knowledge counts
directly, while preserving JSON fallback behavior for older call sites.

50k synthetic benchmark confirmation:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 4.26s | 11,746 meetings/sec |
| Create approvals | 2.12s | 23,568 approvals/sec |
| List pending approval summaries | 0.8ms | 122,026 rows/sec |
| Flush FTS queue | 2.26s | 66,288 FTS rows/sec |
| Total measured | 8.68s | n/a |

### After Lean Tool-Call Read Paths

This pass optimized the fixed overhead that matters in fast inference loops:

- added `GET /api/ping` as a constant-buffer liveness response
- added `GET /api/counts?status=pending` for indexed count-only checks
- cached FTS search statements
- replaced several hot `SELECT *` reads with explicit column lists
- added tiny-page and tiny-search benchmark coverage

50k synthetic benchmark confirmation:

| Step | Time | Throughput |
| --- | ---: | ---: |
| Ingest meetings + knowledge | 4.06s | 12,320 meetings/sec |
| Create approvals | 1.93s | 25,917 approvals/sec |
| Flush FTS queue | 1.83s | 81,988 FTS rows/sec |
| Common-term search | 2.6-4.9ms | n/a |
| Worst typed search | 6.0ms | n/a |
| Total measured | 7.85s | n/a |

## Interpretation

The current bottleneck is not TypeScript compute. It is write amplification and
index maintenance. Pagination and typed FTS query pushdown removed the large
admin-list and common-search costs observed in earlier runs. Append-only
backfill mode roughly doubles known-new ingest throughput at 50k scale. The
batch-backfill API and set-based FTS flush push the 100k benchmark from 28.18s
before this pass to 16.04s after this pass.

Rust would not be the first move. The measured wins are from storage shape:

- batch writes
- append-only queue writes when inputs are known-new
- avoid synchronous search indexing
- cache statements
- query indexed columns
- avoid sending full JSON blobs in hot list views
- avoid re-parsing JSON that the caller already has as structured data
- provide specialized low-latency read endpoints for tool callers
- keep external APIs out of hot paths

## Next Performance Work

1. Add search domain filters: project and date range.
2. Store route/project/publish fields as real columns on meeting/search rows, not only approval rows.
3. Benchmark file-backed SQLite on an uncompressed disk path.
4. Add concurrent mutating HTTP benchmark coverage for approval creation and approval actions.
5. Add long-running background FTS worker soak tests.
6. Add retained-size/memory profiling at 250k-1M synthetic meetings.

See
[2026-05-23 HTTP latency and Rust SQLite sidecar benchmark](2026-05-23-http-and-rust-sqlite-sidecar-benchmark.md)
for the admin API latency pass and Rust raw-SQLite ceiling check.
