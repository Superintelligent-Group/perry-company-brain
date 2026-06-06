# Perry Rust SQLite Benchmark

This sidecar measures raw SQLite write throughput for Perry-shaped synthetic
meeting data from Rust. It does not call or modify the TypeScript runtime.

The benchmark creates the same storage shape used by Perry's brain store:

- `meetings`
- `decisions`
- `action_items`
- `approvals`
- `fts_queue`
- supporting source, audit, index, and FTS tables

Each synthetic meeting writes:

- one meeting row
- two decision rows
- two action item rows
- one pending approval row
- five deferred FTS queue rows for the meeting, decisions, and actions

Rows are append-only and inserted inside one bulk transaction. Generated IDs
include a run identifier, so repeated file-backed runs append new rows instead
of updating existing rows.

## Run

```sh
cd benchmarks/rust-sqlite
cargo run --release -- --records 100000 --db target/perry-rust-sqlite.sqlite
```

Useful options:

```sh
cargo run --release -- --records 50000
cargo run --release -- --records 100000 --db :memory:
cargo run --release -- --records 100000 --journal DELETE --sync NORMAL
```

Defaults:

- `--records 10000`
- `--db target/perry-rust-sqlite.sqlite`
- `--journal DELETE`
- `--sync NORMAL`

## Output

The program prints:

- schema setup
- one bulk insert transaction, reported as synthetic meetings/sec
- total measured runtime, reported as inserted rows/sec
- row counts for each Perry-shaped table written

The total inserted row count includes every row written across the
Perry-shaped tables, not only meetings.

## Notes

This is a storage-sidecar benchmark only. It intentionally excludes:

- Granola payload normalization
- TypeScript knowledge extraction
- Discord or Notion work
- approval workflow behavior
- FTS queue flushing/search

If Cargo cannot fetch `rusqlite`, the scaffold still documents the intended
benchmark and can be run once dependencies are available.
