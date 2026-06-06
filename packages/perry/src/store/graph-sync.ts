// graph-sync — split out of the former monolithic meeting-store.ts
import { join } from "node:path";
import { type GraphChangeSetRecord, type GraphSyncJobRecord, type GraphSyncQueueStats, type PageOptions, type Row } from "./types";
import { insertAudit, normalizePage, statement, withBrainTransaction, withDb } from "./db";
import { graphSyncJobFromRow } from "./rows";
import { markGraphChangeSetApplied, markGraphChangeSetFailed, upsertGraphChangeSet } from "./change-sets";

export function enqueueGraphSyncJob(input: {
  id: string;
  entityType?: GraphSyncJobRecord["entityType"];
  entityId: string;
  payloadJson: string;
  maxAttempts?: number;
  graphChangeSet?: {
    id: string;
    groupId: string;
    validationStatus: GraphChangeSetRecord["validationStatus"];
    validationErrors: unknown[];
    validationWarnings: unknown[];
    changeSet: unknown;
  };
}): GraphSyncJobRecord {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      statement(
        db,
        `INSERT INTO graph_sync_jobs (
          id, entity_type, entity_id, status, payload_json, attempts, max_attempts,
          not_before, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = ?,
          payload_json = excluded.payload_json,
          result_json = NULL,
          attempts = 0,
          max_attempts = excluded.max_attempts,
          not_before = excluded.not_before,
          locked_at = NULL,
          last_error = NULL,
          updated_at = excluded.updated_at`
      ).run(
        input.id,
        input.entityType ?? "meeting",
        input.entityId,
        "queued",
        input.payloadJson,
        0,
        input.maxAttempts ?? 5,
        now,
        now,
        now,
        "queued"
      );
      insertAudit(db, "graph_sync.queued", "graph_sync_job", input.id, { entityId: input.entityId });
      if (input.graphChangeSet) {
        upsertGraphChangeSet(db, {
          id: input.graphChangeSet.id,
          meetingId: input.entityId,
          graphSyncJobId: input.id,
          groupId: input.graphChangeSet.groupId,
          validationStatus: input.graphChangeSet.validationStatus,
          validationErrorsJson: JSON.stringify(input.graphChangeSet.validationErrors),
          validationWarningsJson: JSON.stringify(input.graphChangeSet.validationWarnings),
          changeSetJson: JSON.stringify(input.graphChangeSet.changeSet),
          applyStatus: "queued",
        });
      }
      const row = statement(db, "SELECT * FROM graph_sync_jobs WHERE id = ?").get(input.id) as Row;
      return graphSyncJobFromRow(row);
    })
  );
}

export function claimGraphSyncJobs(limit = 10): GraphSyncJobRecord[] {
  if (limit <= 0) return [];
  const normalizedLimit = normalizePage({ limit }, 10, 1000).limit;
  return withDb((db) =>
    withBrainTransaction(() => {
      const now = new Date().toISOString();
      const rows = statement(
        db,
        `SELECT * FROM graph_sync_jobs
         WHERE status = ? AND not_before <= ?
         ORDER BY created_at ASC
         LIMIT ?`
      ).all("queued", now, normalizedLimit) as Row[];
      if (rows.length === 0) return [];
      for (const row of rows) {
        statement(db, "UPDATE graph_sync_jobs SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?").run(
          "processing",
          now,
          now,
          String(row.id)
        );
      }
      const placeholders = rows.map(() => "?").join(", ");
      return statement(db, `SELECT * FROM graph_sync_jobs WHERE id IN (${placeholders}) ORDER BY created_at ASC`)
        .all(...rows.map((row) => String(row.id)))
        .map((row) => graphSyncJobFromRow(row as Row));
    })
  );
}

export function completeGraphSyncJob(id: string, result: unknown): GraphSyncJobRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    statement(
      db,
      "UPDATE graph_sync_jobs SET status = ?, result_json = ?, locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?"
    ).run("completed", JSON.stringify(result), now, id);
    markGraphChangeSetApplied(db, id, now);
    insertAudit(db, "graph_sync.completed", "graph_sync_job", id, {});
    const row = statement(db, "SELECT * FROM graph_sync_jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? graphSyncJobFromRow(row) : undefined;
  });
}

export function failGraphSyncJob(id: string, error: unknown): GraphSyncJobRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    const row = statement(db, "SELECT attempts, max_attempts FROM graph_sync_jobs WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    const attempts = Number(row.attempts) + 1;
    const maxAttempts = Number(row.max_attempts);
    const finalFailure = attempts >= maxAttempts;
    const notBefore = new Date(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(attempts, 8))).toISOString();
    const message = error instanceof Error ? error.message : String(error);
    statement(
      db,
      `UPDATE graph_sync_jobs
       SET status = ?, attempts = ?, locked_at = NULL, last_error = ?, not_before = ?, updated_at = ?
       WHERE id = ?`
    ).run(finalFailure ? "failed" : "queued", attempts, message, finalFailure ? now : notBefore, now, id);
    markGraphChangeSetFailed(db, id, message, finalFailure ? "failed" : "queued");
    insertAudit(db, finalFailure ? "graph_sync.failed" : "graph_sync.retry_queued", "graph_sync_job", id, {
      attempts,
      error: message,
    });
    const updated = statement(db, "SELECT * FROM graph_sync_jobs WHERE id = ?").get(id) as Row;
    return graphSyncJobFromRow(updated);
  });
}

export function getGraphSyncQueueStats(): GraphSyncQueueStats {
  return withDb((db) => {
    const rows = statement(db, "SELECT status, COUNT(*) AS count FROM graph_sync_jobs GROUP BY status").all() as Row[];
    const stats: GraphSyncQueueStats = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      const status = String(row.status) as keyof GraphSyncQueueStats;
      if (status in stats) stats[status] = Number(row.count);
    }
    return stats;
  });
}

export function listGraphSyncJobs(options: PageOptions = {}): GraphSyncJobRecord[] {
  const { limit, offset } = normalizePage(options, 50, 200);
  return withDb((db) =>
    statement(db, "SELECT * FROM graph_sync_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => graphSyncJobFromRow(row as Row))
  );
}
