// meetings — split out of the former monolithic meeting-store.ts
import { DatabaseSync } from "node:sqlite";
import { type MeetingNote } from "@meetings";
import { type ActionItemRecord, type BackfillMeetingInput, type DecisionRecord, type MeetingGraphBackfillRecord, type MeetingRecord, type PageOptions, type Row } from "./types";
import { insertAudit, normalizePage, optionalString, queueFts, queueFtsAppendOnly, statement, validIsoOrUndefined, withBrainTransaction, withDb } from "./db";
import { actionFromRow, decisionFromRow, meetingFromRow } from "./rows";

export function listMeetingRecords(options: PageOptions = {}): MeetingRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) =>
    statement(
      db,
      `SELECT id, source, source_id, title, created_at, updated_at, notion_page_id,
        notion_url, discord_message_url, status, error
       FROM meetings ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(limit, offset)
      .map((row) => row as Row)
      .map(meetingFromRow)
  );
}

export function listMeetingRecordsByStatus(status: MeetingRecord["status"], options: PageOptions = {}): MeetingRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) =>
    statement(
      db,
      `SELECT id, source, source_id, title, created_at, updated_at, notion_page_id,
        notion_url, discord_message_url, status, error
       FROM meetings WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(status, limit, offset)
      .map((row) => row as Row)
      .map(meetingFromRow)
  );
}

export function countMeetingRecords(status?: MeetingRecord["status"]): number {
  return withDb((db) => {
    const row = status
      ? (statement(db, "SELECT COUNT(*) AS count FROM meetings WHERE status = ?").get(status) as Row)
      : (statement(db, "SELECT COUNT(*) AS count FROM meetings").get() as Row);
    return Number(row.count);
  });
}

export function findMeetingRecord(note: MeetingNote): MeetingRecord | undefined {
  const sourceId = note.sourceId;
  if (!sourceId) return undefined;
  return withDb((db) => {
    const row = db
      .prepare("SELECT * FROM meetings WHERE source = ? AND source_id = ?")
      .get(note.source, sourceId);
    return row ? meetingFromRow(row as Row) : undefined;
  });
}

export function upsertMeetingRecord(record: MeetingRecord): MeetingRecord {
  return withDb((db) => {
    const existing = statement(db, "SELECT 1 FROM meetings WHERE id = ?").get(record.id);
    statement(
      db,
      `INSERT INTO meetings (
        id, source, source_id, title, created_at, updated_at, notion_page_id,
        notion_url, discord_message_url, status, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        notion_page_id = excluded.notion_page_id,
        notion_url = excluded.notion_url,
        discord_message_url = excluded.discord_message_url,
        status = excluded.status,
        error = excluded.error`
    ).run(
      record.id,
      record.source,
      record.sourceId ?? null,
      record.title,
      record.createdAt,
      record.updatedAt,
      record.notionPageId ?? null,
      record.notionUrl ?? null,
      record.discordMessageUrl ?? null,
      record.status,
      record.error ?? null
    );
    if (existing) {
      statement(db, "DELETE FROM brain_fts WHERE type = ? AND entity_id = ?").run("meeting", record.id);
    }
    queueFts(db, {
      type: "meeting",
      entityId: record.id,
      title: record.title,
      body: record.title,
      url: record.notionUrl,
      createdAt: record.createdAt,
      queuedAt: record.updatedAt,
    });
    insertAudit(db, "meeting.upserted", "meeting", record.id, record);
    return record;
  });
}

export function insertBackfillMeeting(
  record: MeetingRecord,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> }
): MeetingRecord {
  return withDb((db) => {
    insertBackfillMeetingInDb(db, record, knowledge);
    return record;
  });
}

export function insertBackfillMeetingBatch(items: BackfillMeetingInput[]): number {
  if (items.length === 0) return 0;
  return withDb((db) =>
    withBrainTransaction(() => {
      for (const item of items) {
        insertBackfillMeetingInDb(db, item.record, item.knowledge);
      }
      return items.length;
    })
  );
}

function insertBackfillMeetingInDb(
  db: DatabaseSync,
  record: MeetingRecord,
  knowledge: BackfillMeetingInput["knowledge"]
): void {
  statement(
    db,
    `INSERT INTO meetings (
      id, source, source_id, title, created_at, updated_at, notion_page_id,
      notion_url, discord_message_url, status, error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.source,
    record.sourceId ?? null,
    record.title,
    record.createdAt,
    record.updatedAt,
    record.notionPageId ?? null,
    record.notionUrl ?? null,
    record.discordMessageUrl ?? null,
    record.status,
    record.error ?? null
  );
  queueFtsAppendOnly(db, {
    type: "meeting",
    entityId: record.id,
    title: record.title,
    body: record.title,
    url: record.notionUrl,
    createdAt: record.createdAt,
    queuedAt: record.updatedAt,
  });
  insertMeetingKnowledgeFast(db, record.id, record.title, record.notionUrl, knowledge, record.updatedAt, true);
  insertAudit(db, "meeting.backfilled", "meeting", record.id, record);
}

export function replaceMeetingKnowledge(
  meetingId: string,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> }
): void {
  withDb((db) => {
    replaceMeetingKnowledgeInDb(db, meetingId, knowledge);
  });
}

function replaceMeetingKnowledgeInDb(
  db: DatabaseSync,
  meetingId: string,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> }
): void {
    const hasExistingKnowledge =
      statement(db, "SELECT 1 FROM decisions WHERE meeting_id = ? LIMIT 1").get(meetingId) ??
      statement(db, "SELECT 1 FROM action_items WHERE meeting_id = ? LIMIT 1").get(meetingId);
    statement(db, "DELETE FROM decisions WHERE meeting_id = ?").run(meetingId);
    statement(db, "DELETE FROM action_items WHERE meeting_id = ?").run(meetingId);
    if (hasExistingKnowledge) {
      statement(db, "DELETE FROM brain_fts WHERE meeting_id = ? AND type IN ('decision', 'action')").run(meetingId);
      statement(db, "DELETE FROM fts_queue WHERE meeting_id = ? AND type IN ('decision', 'action')").run(meetingId);
    }
    const meetingRow = statement(db, "SELECT title, notion_url, created_at FROM meetings WHERE id = ?").get(meetingId) as
      | Row
      | undefined;
    const meetingTitle = meetingRow ? String(meetingRow.title) : meetingId;
    const meetingUrl = meetingRow ? optionalString(meetingRow.notion_url) : undefined;
    const now = meetingRow ? String(meetingRow.created_at) : new Date().toISOString();
    knowledge.decisions.forEach((decision, index) => {
      const id = `${meetingId}:decision:${index + 1}`;
      statement(db, "INSERT INTO decisions (id, meeting_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        meetingId,
        decision.text,
        "accepted",
        now
      );
      queueFts(db, {
        type: "decision",
        entityId: id,
        meetingId,
        title: meetingTitle,
        body: decision.text,
        url: meetingUrl,
        createdAt: now,
        queuedAt: now,
      });
    });
    knowledge.actionItems.forEach((action, index) => {
      const id = `${meetingId}:action:${index + 1}`;
      statement(
        db,
        "INSERT INTO action_items (id, meeting_id, text, owner, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id,
        meetingId,
        action.text,
        action.owner ?? null,
        action.dueDate ?? null,
        "open",
        now
      );
      queueFts(db, {
        type: "action",
        entityId: id,
        meetingId,
        title: meetingTitle,
        body: action.text,
        url: meetingUrl,
        createdAt: now,
        queuedAt: now,
      });
    });
    insertAudit(db, "knowledge.replaced", "meeting", meetingId, {
      decisions: knowledge.decisions.length,
      actionItems: knowledge.actionItems.length,
    });
}

function insertMeetingKnowledgeFast(
  db: DatabaseSync,
  meetingId: string,
  meetingTitle: string,
  meetingUrl: string | undefined,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> },
  queuedAt = new Date().toISOString(),
  appendOnly = false
): void {
  const now = queuedAt;
  const queue = appendOnly ? queueFtsAppendOnly : queueFts;
  knowledge.decisions.forEach((decision, index) => {
    const id = `${meetingId}:decision:${index + 1}`;
    statement(db, "INSERT INTO decisions (id, meeting_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      meetingId,
      decision.text,
      "accepted",
      now
    );
    queue(db, {
      type: "decision",
      entityId: id,
      meetingId,
      title: meetingTitle,
      body: decision.text,
      url: meetingUrl,
      createdAt: now,
      queuedAt,
    });
  });
  knowledge.actionItems.forEach((action, index) => {
    const id = `${meetingId}:action:${index + 1}`;
    statement(
      db,
      "INSERT INTO action_items (id, meeting_id, text, owner, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      meetingId,
      action.text,
      action.owner ?? null,
      action.dueDate ?? null,
      "open",
      now
    );
    queue(db, {
      type: "action",
      entityId: id,
      meetingId,
      title: meetingTitle,
      body: action.text,
      url: meetingUrl,
      createdAt: now,
      queuedAt,
    });
  });
}

export function listDecisions(limit = 50, offset = 0): DecisionRecord[] {
  return withDb((db) =>
    statement(db, "SELECT id, meeting_id, text, status, created_at FROM decisions ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => row as Row)
      .map(decisionFromRow)
  );
}

export function listActionItems(limit = 50, offset = 0): ActionItemRecord[] {
  return withDb((db) =>
    statement(
      db,
      `SELECT id, meeting_id, text, owner, due_date, status, created_at
       FROM action_items ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(limit, offset)
      .map((row) => row as Row)
      .map(actionFromRow)
  );
}

export function getMeetingKnowledge(meetingId: string): MeetingGraphBackfillRecord["knowledge"] {
  return withDb((db) => {
    const decisions = statement(db, "SELECT id, meeting_id, text, status, created_at FROM decisions WHERE meeting_id = ? ORDER BY created_at")
      .all(meetingId)
      .map((row) => decisionFromRow(row as Row))
      .map((decision) => ({ text: decision.text }));
    const actionItems = statement(
      db,
      `SELECT id, meeting_id, text, owner, due_date, status, created_at
       FROM action_items WHERE meeting_id = ? ORDER BY created_at`
    )
      .all(meetingId)
      .map((row) => actionFromRow(row as Row))
      .map((action) => ({ text: action.text, owner: action.owner, dueDate: action.dueDate }));
    return { decisions, actionItems };
  });
}

export function listMeetingGraphBackfillRecords(options: PageOptions = {}): MeetingGraphBackfillRecord[] {
  return listMeetingRecordsByStatus("processed", options).map((record) => ({
    record,
    knowledge: getMeetingKnowledge(record.id),
  }));
}

export function meetingRecordFromNote(note: MeetingNote, status: MeetingRecord["status"]): MeetingRecord {
  const now = new Date().toISOString();
  const createdAt = validIsoOrUndefined(note.startedAt) ?? now;
  return {
    id: note.sourceId ? `${note.source}:${note.sourceId}` : `${note.source}:${now}`,
    source: note.source,
    sourceId: note.sourceId,
    title: note.title,
    createdAt,
    updatedAt: now,
    status,
  };
}
