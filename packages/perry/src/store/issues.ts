// issues — split out of the former monolithic meeting-store.ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type IssueEventRecord, type IssueRecord, type PageOptions, type PivotRecord, type Row } from "./types";
import { insertAudit, normalizePage, optionalString, statement, withBrainTransaction, withDb } from "./db";
import { issueEventFromRow, issueFromRow, pivotFromRow } from "./rows";

export function upsertIssue(input: {
  id: string;
  project?: string;
  title: string;
  description?: string;
  status?: IssueRecord["status"];
  priority?: IssueRecord["priority"];
  owner?: string;
  sourceMeetingId?: string;
  sourceActionId?: string;
  dueDate?: string;
  preserveMutableFields?: boolean;
}): IssueRecord {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      const existing = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row | undefined;
      const preservedExisting = existing && input.preserveMutableFields ? existing : undefined;
      const status = preservedExisting
        ? (String(preservedExisting.status) as IssueRecord["status"])
        : input.status ?? (existing ? (String(existing.status) as IssueRecord["status"]) : "open");
      const priority = preservedExisting
        ? (String(preservedExisting.priority) as IssueRecord["priority"])
        : input.priority ?? (existing ? (String(existing.priority) as IssueRecord["priority"]) : "normal");
      const owner = preservedExisting ? optionalString(preservedExisting.owner) : input.owner;
      statement(
        db,
        `INSERT INTO issues (
          id, project, title, description, status, priority, owner, source_meeting_id,
          source_action_id, due_date, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project = excluded.project,
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          priority = excluded.priority,
          owner = excluded.owner,
          source_meeting_id = excluded.source_meeting_id,
          source_action_id = excluded.source_action_id,
          due_date = excluded.due_date,
          updated_at = excluded.updated_at`
      ).run(
        input.id,
        input.project ?? null,
        input.title,
        input.description ?? null,
        status,
        priority,
        owner ?? null,
        input.sourceMeetingId ?? null,
        input.sourceActionId ?? null,
        input.dueDate ?? null,
        now,
        now
      );
      if (!existing) {
        appendIssueEventInDb(db, {
          id: `${input.id}:event:created`,
          issueId: input.id,
          type: "created",
          detailJson: JSON.stringify({ sourceActionId: input.sourceActionId, title: input.title }),
          meetingId: input.sourceMeetingId,
          createdAt: now,
        });
      }
      const row = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row;
      return issueFromRow(row);
    })
  );
}

export function updateIssue(input: {
  id: string;
  project?: string;
  title?: string;
  description?: string;
  status?: IssueRecord["status"];
  priority?: IssueRecord["priority"];
  owner?: string;
  dueDate?: string;
  actor?: string;
  comment?: string;
}): IssueRecord | undefined {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      const existing = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row | undefined;
      if (!existing) return undefined;
      const before = issueFromRow(existing);
      const next: IssueRecord = {
        ...before,
        project: input.project ?? before.project,
        title: input.title ?? before.title,
        description: input.description ?? before.description,
        status: input.status ?? before.status,
        priority: input.priority ?? before.priority,
        owner: input.owner ?? before.owner,
        dueDate: input.dueDate ?? before.dueDate,
        updatedAt: now,
      };
      statement(
        db,
        `UPDATE issues
         SET project = ?, title = ?, description = ?, status = ?, priority = ?,
           owner = ?, due_date = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        next.project ?? null,
        next.title,
        next.description ?? null,
        next.status,
        next.priority,
        next.owner ?? null,
        next.dueDate ?? null,
        now,
        input.id
      );
      appendIssueMutationEvents(db, before, next, input, now);
      insertAudit(db, "issue.updated", "issue", input.id, {
        actor: input.actor,
        before,
        after: next,
        comment: input.comment,
      });
      const row = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row;
      return issueFromRow(row);
    })
  );
}

export function listIssues(options: PageOptions & { owner?: string; status?: IssueRecord["status"]; project?: string } = {}): IssueRecord[] {
  const { limit, offset } = normalizePage(options, 100, 100_000);
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.owner) {
    clauses.push("owner = ?");
    params.push(options.owner);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.project) {
    clauses.push("project = ?");
    params.push(options.project);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return withDb((db) =>
    statement(db, `SELECT * FROM issues ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map((row) => issueFromRow(row as Row))
  );
}

export function listIssueEvents(issueId: string, options: PageOptions = {}): IssueEventRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) =>
    statement(db, "SELECT * FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(issueId, limit, offset)
      .map((row) => issueEventFromRow(row as Row))
  );
}

export function upsertPivot(input: Omit<PivotRecord, "createdAt"> & { createdAt?: string }): PivotRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return withDb((db) => {
    statement(
      db,
      `INSERT INTO pivots (
        id, project, subject, previous_owner, new_owner, fallback_reviewer, reason,
        source_decision_id, source_meeting_id, affected_issue_ids_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project = excluded.project,
        subject = excluded.subject,
        previous_owner = excluded.previous_owner,
        new_owner = excluded.new_owner,
        fallback_reviewer = excluded.fallback_reviewer,
        reason = excluded.reason,
        affected_issue_ids_json = excluded.affected_issue_ids_json`
    ).run(
      input.id,
      input.project ?? null,
      input.subject,
      input.previousOwner ?? null,
      input.newOwner ?? null,
      input.fallbackReviewer ?? null,
      input.reason,
      input.sourceDecisionId,
      input.sourceMeetingId,
      JSON.stringify(input.affectedIssueIds),
      createdAt
    );
    const row = statement(db, "SELECT * FROM pivots WHERE id = ?").get(input.id) as Row;
    return pivotFromRow(row);
  });
}

export function listPivots(options: PageOptions = {}): PivotRecord[] {
  const { limit, offset } = normalizePage(options, 100, 100_000);
  return withDb((db) =>
    statement(db, "SELECT * FROM pivots ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => pivotFromRow(row as Row))
  );
}

function appendIssueMutationEvents(
  db: DatabaseSync,
  before: IssueRecord,
  after: IssueRecord,
  input: {
    actor?: string;
    comment?: string;
    project?: string;
    title?: string;
    description?: string;
    status?: IssueRecord["status"];
    priority?: IssueRecord["priority"];
    owner?: string;
    dueDate?: string;
  },
  createdAt: string
): void {
  const base = {
    issueId: after.id,
    actor: input.actor,
    meetingId: after.sourceMeetingId,
    createdAt,
  };
  if (before.owner !== after.owner) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "assigned",
      detailJson: JSON.stringify({ previousOwner: before.owner, owner: after.owner }),
    });
  }
  if (before.status !== after.status) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "status_changed",
      detailJson: JSON.stringify({ previousStatus: before.status, status: after.status }),
    });
  }
  const metadataChanged =
    before.project !== after.project ||
    before.title !== after.title ||
    before.description !== after.description ||
    before.priority !== after.priority ||
    before.dueDate !== after.dueDate;
  if (metadataChanged) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "updated",
      detailJson: JSON.stringify({
        project: after.project,
        title: after.title,
        description: after.description,
        priority: after.priority,
        dueDate: after.dueDate,
      }),
    });
  }
  if (input.comment?.trim()) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "commented",
      detailJson: JSON.stringify({ comment: input.comment.trim() }),
    });
  }
}

function appendIssueEventInDb(
  db: DatabaseSync,
  event: {
    id: string;
    issueId: string;
    type: IssueEventRecord["type"];
    actor?: string;
    detailJson: string;
    meetingId?: string;
    createdAt: string;
  }
): void {
  statement(
    db,
    `INSERT OR IGNORE INTO issue_events (
      id, issue_id, type, actor, detail_json, meeting_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.issueId,
    event.type,
    event.actor ?? null,
    event.detailJson,
    event.meetingId ?? null,
    event.createdAt
  );
}
