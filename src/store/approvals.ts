// approvals — split out of the former monolithic meeting-store.ts
import { DatabaseSync } from "node:sqlite";
import { type ApprovalRecord, type ApprovalSummaryRecord, type ApprovalWriteInput, type PageOptions, type Row } from "./types";
import { insertAudit, normalizePage, parseJsonRecord, statement, withBrainTransaction, withDb } from "./db";
import { approvalFromRow, approvalSummaryFromRow } from "./rows";

const approvalSummaryColumns = `id, meeting_id, title, announcement, route_project, route_reason, publish_mode,
  decision_count, action_item_count, status, created_at, updated_at`;

export function createApproval(record: ApprovalWriteInput): ApprovalRecord {
  const now = new Date().toISOString();
  const fullRecord: ApprovalRecord = { ...record, createdAt: now, updatedAt: now };
  const summary = summarizeApproval(record);
  return withDb((db) => {
    statement(
      db,
      `INSERT INTO approvals (
        id, meeting_id, title, payload_json, announcement, knowledge_json,
        route_json, status, created_at, updated_at, route_project, route_reason,
        publish_mode, decision_count, action_item_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        payload_json = excluded.payload_json,
        announcement = excluded.announcement,
        knowledge_json = excluded.knowledge_json,
        route_json = excluded.route_json,
        status = excluded.status,
        updated_at = excluded.updated_at,
        route_project = excluded.route_project,
        route_reason = excluded.route_reason,
        publish_mode = excluded.publish_mode,
        decision_count = excluded.decision_count,
        action_item_count = excluded.action_item_count`
    ).run(
      fullRecord.id,
      fullRecord.meetingId,
      fullRecord.title,
      fullRecord.payloadJson,
      fullRecord.announcement,
      fullRecord.knowledgeJson,
      fullRecord.routeJson,
      fullRecord.status,
      fullRecord.createdAt,
      fullRecord.updatedAt,
      summary.routeProject ?? null,
      summary.routeReason ?? null,
      summary.publishMode ?? null,
      summary.decisionCount,
      summary.actionItemCount
    );
    insertAudit(db, "approval.created", "approval", fullRecord.id, fullRecord);
    return fullRecord;
  });
}

export function insertBackfillApproval(record: ApprovalWriteInput): ApprovalRecord {
  const now = new Date().toISOString();
  const fullRecord: ApprovalRecord = { ...record, createdAt: now, updatedAt: now };
  return withDb((db) => {
    insertBackfillApprovalInDb(db, fullRecord, summarizeApproval(record));
    return fullRecord;
  });
}

export function insertBackfillApprovalBatch(records: ApprovalWriteInput[]): number {
  if (records.length === 0) return 0;
  return withDb((db) =>
    withBrainTransaction(() => {
      const now = new Date().toISOString();
      for (const record of records) {
        insertBackfillApprovalInDb(db, { ...record, createdAt: now, updatedAt: now }, summarizeApproval(record));
      }
      return records.length;
    })
  );
}

function insertBackfillApprovalInDb(
  db: DatabaseSync,
  fullRecord: ApprovalRecord,
  summary: Pick<ApprovalSummaryRecord, "routeProject" | "routeReason" | "publishMode" | "decisionCount" | "actionItemCount">
): void {
  statement(
    db,
    `INSERT INTO approvals (
      id, meeting_id, title, payload_json, announcement, knowledge_json,
      route_json, status, created_at, updated_at, route_project, route_reason,
      publish_mode, decision_count, action_item_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fullRecord.id,
    fullRecord.meetingId,
    fullRecord.title,
    fullRecord.payloadJson,
    fullRecord.announcement,
    fullRecord.knowledgeJson,
    fullRecord.routeJson,
    fullRecord.status,
    fullRecord.createdAt,
    fullRecord.updatedAt,
    summary.routeProject ?? null,
    summary.routeReason ?? null,
    summary.publishMode ?? null,
    summary.decisionCount,
    summary.actionItemCount
  );
  insertAudit(db, "approval.backfilled", "approval", fullRecord.id, fullRecord);
}

export function listApprovals(status?: ApprovalRecord["status"], options: PageOptions = {}): ApprovalRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) => {
    const rows = status
      ? statement(db, "SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(
          status,
          limit,
          offset
        )
      : statement(db, "SELECT * FROM approvals ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
    return rows.map((row) => approvalFromRow(row as Row));
  });
}

export function listApprovalSummaries(
  status?: ApprovalRecord["status"],
  options: PageOptions = {}
): ApprovalSummaryRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) => {
    const rows = status
      ? statement(
          db,
          `SELECT ${approvalSummaryColumns} FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(status, limit, offset)
      : statement(db, `SELECT ${approvalSummaryColumns} FROM approvals ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(
          limit,
          offset
        );
    return rows.map((row) => approvalSummaryFromRow(row as Row));
  });
}

export function countApprovals(status?: ApprovalRecord["status"]): number {
  return withDb((db) => {
    const row = status
      ? (statement(db, "SELECT COUNT(*) AS count FROM approvals WHERE status = ?").get(status) as Row)
      : (statement(db, "SELECT COUNT(*) AS count FROM approvals").get() as Row);
    return Number(row.count);
  });
}

export function getApproval(id: string): ApprovalRecord | undefined {
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? approvalFromRow(row as Row) : undefined;
  });
}

export function updateApprovalStatus(id: string, status: ApprovalRecord["status"]): ApprovalRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    statement(db, "UPDATE approvals SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    insertAudit(db, "approval.status_changed", "approval", id, { status });
    const row = statement(db, "SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? approvalFromRow(row as Row) : undefined;
  });
}

function summarizeApproval(record: ApprovalWriteInput): Pick<
  ApprovalSummaryRecord,
  "routeProject" | "routeReason" | "publishMode" | "decisionCount" | "actionItemCount"
> {
  const route = parseJsonRecord(record.routeJson);
  const knowledge = parseJsonRecord(record.knowledgeJson);
  const decisions = Array.isArray(knowledge?.decisions) ? knowledge.decisions.length : 0;
  const actionItems = Array.isArray(knowledge?.actionItems) ? knowledge.actionItems.length : 0;
  return {
    routeProject: record.routeProject ?? (typeof route?.project === "string" ? route.project : undefined),
    routeReason: record.routeReason ?? (typeof route?.reason === "string" ? route.reason : undefined),
    publishMode: record.publishMode ?? (typeof route?.publishMode === "string" ? route.publishMode : undefined),
    decisionCount: record.decisionCount ?? decisions,
    actionItemCount: record.actionItemCount ?? actionItems,
  };
}
