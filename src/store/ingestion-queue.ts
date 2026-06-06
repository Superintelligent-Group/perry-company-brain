// ingestion-queue — split out of the former monolithic meeting-store.ts
import { join } from "node:path";
import { type IngestionJobRecord, type IngestionQueueStats, type PageOptions, type Row } from "./types";
import { insertAudit, normalizePage, statement, withBrainTransaction, withDb } from "./db";
import { ingestionJobFromRow } from "./rows";

export function enqueueIngestionJob(input: {
  id: string;
  idempotencyKey: string;
  payloadJson: string;
  type?: IngestionJobRecord["type"];
  maxAttempts?: number;
}): { job: IngestionJobRecord; created: boolean } {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      const existing = statement(db, "SELECT * FROM ingestion_jobs WHERE idempotency_key = ?").get(
        input.idempotencyKey
      ) as Row | undefined;
      if (existing) return { job: ingestionJobFromRow(existing), created: false };

      statement(
        db,
        `INSERT INTO ingestion_jobs (
        id, type, idempotency_key, status, payload_json, attempts, max_attempts,
        not_before, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.id,
        input.type ?? "granola.ingest",
        input.idempotencyKey,
        "queued",
        input.payloadJson,
        0,
        input.maxAttempts ?? 5,
        now,
        now,
        now
      );
      statement(db, "INSERT INTO idempotency_keys (key, job_id, created_at) VALUES (?, ?, ?)").run(
        input.idempotencyKey,
        input.id,
        now
      );
      const row = statement(db, "SELECT * FROM ingestion_jobs WHERE id = ?").get(input.id) as Row;
      insertAudit(db, "ingestion_job.queued", "ingestion_job", input.id, { idempotencyKey: input.idempotencyKey });
      return { job: ingestionJobFromRow(row), created: true };
    })
  );
}

export function claimNextIngestionJob(): IngestionJobRecord | undefined {
  return withDb((db) =>
    withBrainTransaction(() => {
      const now = new Date().toISOString();
      const row = statement(
        db,
        `SELECT * FROM ingestion_jobs
         WHERE type = ? AND status = ? AND not_before <= ?
         ORDER BY created_at ASC
         LIMIT 1`
      ).get("granola.ingest", "queued", now) as Row | undefined;
      if (!row) return undefined;
      const id = String(row.id);
      statement(db, "UPDATE ingestion_jobs SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?").run(
        "processing",
        now,
        now,
        id
      );
      const claimed = statement(db, "SELECT * FROM ingestion_jobs WHERE id = ?").get(id) as Row;
      return ingestionJobFromRow(claimed);
    })
  );
}

export function claimIngestionJobs(limit = 10): IngestionJobRecord[] {
  if (limit <= 0) return [];
  const normalizedLimit = normalizePage({ limit }, 10, 1000).limit;
  return withDb((db) =>
    withBrainTransaction(() => {
      const now = new Date().toISOString();
      const rows = statement(
        db,
        `SELECT * FROM ingestion_jobs
         WHERE type = ? AND status = ? AND not_before <= ?
         ORDER BY created_at ASC
         LIMIT ?`
      ).all("granola.ingest", "queued", now, normalizedLimit) as Row[];
      if (rows.length === 0) return [];
      for (const row of rows) {
        statement(db, "UPDATE ingestion_jobs SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?").run(
          "processing",
          now,
          now,
          String(row.id)
        );
      }
      const placeholders = rows.map(() => "?").join(", ");
      return statement(db, `SELECT * FROM ingestion_jobs WHERE id IN (${placeholders}) ORDER BY created_at ASC`)
        .all(...rows.map((row) => String(row.id)))
        .map((row) => ingestionJobFromRow(row as Row));
    })
  );
}

export function completeIngestionJob(id: string, result: unknown): IngestionJobRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    statement(
      db,
      "UPDATE ingestion_jobs SET status = ?, result_json = ?, locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?"
    ).run("completed", JSON.stringify(result), now, id);
    insertAudit(db, "ingestion_job.completed", "ingestion_job", id, {});
    const row = statement(db, "SELECT * FROM ingestion_jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? ingestionJobFromRow(row) : undefined;
  });
}

export function failIngestionJob(id: string, error: unknown): IngestionJobRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    const row = statement(db, "SELECT attempts, max_attempts FROM ingestion_jobs WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    const attempts = Number(row.attempts) + 1;
    const maxAttempts = Number(row.max_attempts);
    const finalFailure = attempts >= maxAttempts;
    const notBefore = new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6))).toISOString();
    const message = error instanceof Error ? error.message : String(error);
    statement(
      db,
      `UPDATE ingestion_jobs
       SET status = ?, attempts = ?, locked_at = NULL, last_error = ?, not_before = ?, updated_at = ?
       WHERE id = ?`
    ).run(finalFailure ? "failed" : "queued", attempts, message, finalFailure ? now : notBefore, now, id);
    insertAudit(db, finalFailure ? "ingestion_job.failed" : "ingestion_job.retry_queued", "ingestion_job", id, {
      attempts,
      error: message,
    });
    const updated = statement(db, "SELECT * FROM ingestion_jobs WHERE id = ?").get(id) as Row;
    return ingestionJobFromRow(updated);
  });
}

export function getIngestionQueueStats(): IngestionQueueStats {
  return withDb((db) => {
    const rows = statement(db, "SELECT status, COUNT(*) AS count FROM ingestion_jobs GROUP BY status").all() as Row[];
    const stats: IngestionQueueStats = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      const status = String(row.status) as keyof IngestionQueueStats;
      if (status in stats) stats[status] = Number(row.count);
    }
    return stats;
  });
}

export function listIngestionJobs(options: PageOptions = {}): IngestionJobRecord[] {
  const { limit, offset } = normalizePage(options, 50, 200);
  return withDb((db) =>
    statement(db, "SELECT * FROM ingestion_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => ingestionJobFromRow(row as Row))
  );
}
