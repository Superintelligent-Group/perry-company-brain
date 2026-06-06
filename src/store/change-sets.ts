// change-sets — split out of the former monolithic meeting-store.ts
import { DatabaseSync } from "node:sqlite";
import { type GraphChangeSetRecord, type PageOptions, type Row } from "./types";
import { insertAudit, normalizePage, statement, withDb } from "./db";
import { graphChangeSetFromRow } from "./rows";
import { materializeOntologyFromChangeSet } from "./ontology";

export function listGraphChangeSets(options: PageOptions & { status?: GraphChangeSetRecord["applyStatus"] } = {}): GraphChangeSetRecord[] {
  const { limit, offset } = normalizePage(options, 50, 200);
  return withDb((db) => {
    const status = options.status;
    const rows = status
      ? (statement(
          db,
          "SELECT * FROM graph_change_sets WHERE apply_status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(status, limit, offset) as Row[])
      : (statement(db, "SELECT * FROM graph_change_sets ORDER BY created_at DESC LIMIT ? OFFSET ?").all(
          limit,
          offset
        ) as Row[]);
    return rows.map(graphChangeSetFromRow);
  });
}

export function getGraphChangeSet(id: string): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

export function getGraphChangeSetByJobId(graphSyncJobId: string): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
      | Row
      | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

export function markGraphChangeSetReplayApplied(id: string, result: unknown): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    statement(
      db,
      "UPDATE graph_change_sets SET apply_status = ?, applied_at = ?, last_error = NULL, updated_at = ? WHERE id = ?"
    ).run("applied", now, now, id);
    insertAudit(db, "graph_change_set.replayed", "graph_change_set", id, { result });
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

export function markGraphChangeSetReplayFailed(id: string, error: unknown): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    statement(db, "UPDATE graph_change_sets SET apply_status = ?, last_error = ?, updated_at = ? WHERE id = ?").run(
      "failed",
      message,
      now,
      id
    );
    insertAudit(db, "graph_change_set.replay_failed", "graph_change_set", id, { error: message });
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

export function upsertGraphChangeSet(
  db: DatabaseSync,
  input: Omit<GraphChangeSetRecord, "createdAt" | "updatedAt">
): void {
  const now = new Date().toISOString();
  statement(
    db,
    `INSERT INTO graph_change_sets (
      id, meeting_id, graph_sync_job_id, group_id, validation_status,
      validation_errors_json, validation_warnings_json, change_set_json,
      apply_status, applied_at, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      meeting_id = excluded.meeting_id,
      graph_sync_job_id = excluded.graph_sync_job_id,
      group_id = excluded.group_id,
      validation_status = excluded.validation_status,
      validation_errors_json = excluded.validation_errors_json,
      validation_warnings_json = excluded.validation_warnings_json,
      change_set_json = excluded.change_set_json,
      apply_status = excluded.apply_status,
      applied_at = excluded.applied_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at`
  ).run(
    input.id,
    input.meetingId,
    input.graphSyncJobId,
    input.groupId,
    input.validationStatus,
    input.validationErrorsJson,
    input.validationWarningsJson,
    input.changeSetJson,
    input.applyStatus,
    input.appliedAt ?? null,
    input.lastError ?? null,
    now,
    now
  );
  materializeOntologyFromChangeSet(db, input.changeSetJson, input.meetingId, now);
  insertAudit(db, "graph_change_set.queued", "graph_change_set", input.id, {
    meetingId: input.meetingId,
    graphSyncJobId: input.graphSyncJobId,
    validationStatus: input.validationStatus,
  });
}

export function markGraphChangeSetApplied(db: DatabaseSync, graphSyncJobId: string, appliedAt: string): void {
  statement(
    db,
    "UPDATE graph_change_sets SET apply_status = ?, applied_at = ?, last_error = NULL, updated_at = ? WHERE graph_sync_job_id = ?"
  ).run("applied", appliedAt, appliedAt, graphSyncJobId);
  const row = statement(db, "SELECT id FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
    | Row
    | undefined;
  if (row) insertAudit(db, "graph_change_set.applied", "graph_change_set", String(row.id), { graphSyncJobId });
}

export function markGraphChangeSetFailed(
  db: DatabaseSync,
  graphSyncJobId: string,
  message: string,
  applyStatus: GraphChangeSetRecord["applyStatus"]
): void {
  const now = new Date().toISOString();
  statement(
    db,
    "UPDATE graph_change_sets SET apply_status = ?, last_error = ?, updated_at = ? WHERE graph_sync_job_id = ?"
  ).run(applyStatus, message, now, graphSyncJobId);
  const row = statement(db, "SELECT id FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
    | Row
    | undefined;
  if (row) insertAudit(db, "graph_change_set.apply_failed", "graph_change_set", String(row.id), { graphSyncJobId, message });
}
