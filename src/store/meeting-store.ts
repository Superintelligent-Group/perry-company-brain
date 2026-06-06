import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import type { MeetingNote } from "@meetings";
import type { CompanyOntologyEntityType, GraphChangeSet, GraphEntityType } from "@core";

export interface MeetingRecord {
  id: string;
  source: MeetingNote["source"];
  sourceId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notionPageId?: string;
  notionUrl?: string;
  discordMessageUrl?: string;
  status: "processed" | "dry-run" | "failed";
  error?: string;
}

export interface DecisionRecord {
  id: string;
  meetingId: string;
  text: string;
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

export interface ActionItemRecord {
  id: string;
  meetingId: string;
  text: string;
  owner?: string;
  dueDate?: string;
  status: "open" | "done" | "wont-do";
  createdAt: string;
}

export interface UserRecord {
  id: string;
  displayName: string;
  email?: string;
  discordUserId?: string;
  notionUserId?: string;
  githubUsername?: string;
  team?: string;
  timezone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IssueRecord {
  id: string;
  project?: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "blocked" | "done" | "canceled";
  priority: "low" | "normal" | "high" | "urgent";
  owner?: string;
  sourceMeetingId?: string;
  sourceActionId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueEventRecord {
  id: string;
  issueId: string;
  type: "created" | "assigned" | "status_changed" | "commented" | "pivoted" | "updated";
  actor?: string;
  detailJson: string;
  meetingId?: string;
  createdAt: string;
}

export interface PivotRecord {
  id: string;
  project?: string;
  subject: string;
  previousOwner?: string;
  newOwner?: string;
  fallbackReviewer?: string;
  reason: string;
  sourceDecisionId: string;
  sourceMeetingId: string;
  affectedIssueIds: string[];
  createdAt: string;
}

export interface BrainSearchResult {
  type: "meeting" | "decision" | "action";
  id: string;
  meetingId?: string;
  title: string;
  snippet: string;
  url?: string;
  createdAt: string;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface BrainSearchOptions extends PageOptions {
  types?: Array<BrainSearchResult["type"]>;
}

export interface ApprovalRecord {
  id: string;
  meetingId: string;
  title: string;
  payloadJson: string;
  announcement: string;
  knowledgeJson: string;
  routeJson: string;
  status: "pending" | "approved" | "rejected" | "posted";
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalSummaryRecord {
  id: string;
  meetingId: string;
  title: string;
  announcement: string;
  routeProject?: string;
  routeReason?: string;
  publishMode?: string;
  decisionCount: number;
  actionItemCount: number;
  status: ApprovalRecord["status"];
  createdAt: string;
  updatedAt: string;
}

export type ApprovalWriteInput = Omit<ApprovalRecord, "createdAt" | "updatedAt"> &
  Partial<Pick<ApprovalSummaryRecord, "routeProject" | "routeReason" | "publishMode" | "decisionCount" | "actionItemCount">>;

export interface BackfillMeetingInput {
  record: MeetingRecord;
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> };
}

export interface MeetingGraphBackfillRecord {
  record: MeetingRecord;
  knowledge: {
    decisions: Array<{ text: string }>;
    actionItems: Array<{ text: string; owner?: string; dueDate?: string }>;
  };
}

export interface IngestionJobRecord {
  id: string;
  type: "granola.ingest";
  idempotencyKey: string;
  status: "queued" | "processing" | "completed" | "failed";
  payloadJson: string;
  resultJson?: string;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface GraphSyncJobRecord {
  id: string;
  entityType: "meeting";
  entityId: string;
  status: "queued" | "processing" | "completed" | "failed";
  payloadJson: string;
  resultJson?: string;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphSyncQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface GraphChangeSetRecord {
  id: string;
  meetingId: string;
  graphSyncJobId: string;
  groupId: string;
  validationStatus: "valid" | "invalid";
  validationErrorsJson: string;
  validationWarningsJson: string;
  changeSetJson: string;
  applyStatus: "queued" | "applied" | "failed";
  appliedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyEntityRow {
  stableKey: string;
  type: GraphEntityType;
  name: string;
  aliasesJson: string;
  propertiesJson: string;
  evidenceIdsJson: string;
  sourceMeetingIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyRelationRow {
  id: string;
  subjectKey: string;
  relation: string;
  objectKey: string;
  evidenceId: string;
  validFrom?: string;
  confidence: number;
  propertiesJson: string;
  sourceMeetingId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyEvidenceRow {
  evidenceId: string;
  kind: string;
  source: string;
  sourceId: string;
  meetingId: string;
  title?: string;
  excerpt?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyBackfillResult {
  changeSets: number;
  entities: number;
  relations: number;
  evidence: number;
  dryRun?: boolean;
  reset?: boolean;
  changedSince?: string;
}

interface Row {
  [key: string]: unknown;
}

const dbCache = new Map<string, DatabaseSync>();
const migratedDbs = new WeakSet<DatabaseSync>();
const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
const approvalSummaryColumns = `id, meeting_id, title, announcement, route_project, route_reason, publish_mode,
  decision_count, action_item_count, status, created_at, updated_at`;
let transactionDepth = 0;
let auditSuppressionDepth = 0;
const ontologyEntityTypes: readonly CompanyOntologyEntityType[] = [
  "goal",
  "metric",
  "risk",
  "blocker",
  "open_question",
  "capability",
  "feature",
  "artifact",
  "benchmark_report",
];
const materializedOntologyTypes = new Set<GraphEntityType>(["project", ...ontologyEntityTypes]);

function databasePath(): string {
  if (process.env.PERRY_DB_PATH) return process.env.PERRY_DB_PATH;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Perry", "perry.sqlite");
  }
  return join(process.cwd(), "data", "perry.sqlite");
}

export function getMeetingStorePath(): string {
  return databasePath();
}

function sqliteJournalMode(): "DELETE" | "MEMORY" | "OFF" | "WAL" {
  const configured = process.env.PERRY_SQLITE_JOURNAL_MODE?.toUpperCase();
  if (configured === "DELETE" || configured === "MEMORY" || configured === "OFF" || configured === "WAL") return configured;
  return process.platform === "win32" ? "MEMORY" : "DELETE";
}

export function migrateBrainStore(): void {
  withDb((db) => {
    db.exec(`
      PRAGMA journal_mode = ${sqliteJournalMode()};
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        notion_page_id TEXT,
        notion_url TEXT,
        discord_message_url TEXT,
        status TEXT NOT NULL,
        error TEXT,
        UNIQUE(source, source_id)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_items (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        owner TEXT,
        due_date TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        url TEXT,
        title TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT,
        discord_user_id TEXT,
        notion_user_id TEXT,
        github_username TEXT,
        team TEXT,
        timezone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        project TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        owner TEXT,
        source_meeting_id TEXT,
        source_action_id TEXT,
        due_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS issue_events (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        actor TEXT,
        detail_json TEXT NOT NULL,
        meeting_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pivots (
        id TEXT PRIMARY KEY,
        project TEXT,
        subject TEXT NOT NULL,
        previous_owner TEXT,
        new_owner TEXT,
        fallback_reviewer TEXT,
        reason TEXT NOT NULL,
        source_decision_id TEXT NOT NULL,
        source_meeting_id TEXT NOT NULL,
        affected_issue_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        announcement TEXT NOT NULL,
        knowledge_json TEXT NOT NULL,
        route_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        route_project TEXT,
        route_reason TEXT,
        publish_mode TEXT,
        decision_count INTEGER NOT NULL DEFAULT 0,
        action_item_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS fts_queue (
        entity_key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        meeting_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT,
        created_at TEXT NOT NULL,
        queued_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        not_before TEXT NOT NULL,
        locked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_sync_jobs (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        not_before TEXT NOT NULL,
        locked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_change_sets (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        graph_sync_job_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        validation_errors_json TEXT NOT NULL,
        validation_warnings_json TEXT NOT NULL,
        change_set_json TEXT NOT NULL,
        apply_status TEXT NOT NULL,
        applied_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ontology_entities (
        stable_key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        properties_json TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        source_meeting_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ontology_relations (
        id TEXT PRIMARY KEY,
        subject_key TEXT NOT NULL,
        relation TEXT NOT NULL,
        object_key TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        valid_from TEXT,
        confidence REAL NOT NULL,
        properties_json TEXT NOT NULL,
        source_meeting_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ontology_evidence (
        evidence_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        title TEXT,
        excerpt TEXT,
        url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ontology_entity_evidence (
        stable_key TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        PRIMARY KEY(stable_key, evidence_id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
        type,
        entity_id UNINDEXED,
        meeting_id UNINDEXED,
        title,
        body,
        url UNINDEXED,
        created_at UNINDEXED
      );

      CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);
      CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
      CREATE INDEX IF NOT EXISTS idx_decisions_meeting_id ON decisions(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_meeting_id ON action_items(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_actions_created_at ON action_items(created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_owner_status_created ON action_items(owner, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_status_due_created ON action_items(status, due_date, created_at);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_issues_owner_status ON issues(owner, status);
      CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project, status);
      CREATE INDEX IF NOT EXISTS idx_issues_source_action ON issues(source_action_id);
      CREATE INDEX IF NOT EXISTS idx_issue_events_issue_id ON issue_events(issue_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pivots_subject_created_at ON pivots(subject, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_status_created_at ON approvals(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approvals_status_project_created_at ON approvals(status, route_project, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_not_before ON ingestion_jobs(status, not_before, created_at);
      CREATE INDEX IF NOT EXISTS idx_graph_sync_jobs_status_not_before ON graph_sync_jobs(status, not_before, created_at);
      CREATE INDEX IF NOT EXISTS idx_graph_sync_jobs_entity ON graph_sync_jobs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_graph_change_sets_meeting_id ON graph_change_sets(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_graph_change_sets_job_id ON graph_change_sets(graph_sync_job_id);
      CREATE INDEX IF NOT EXISTS idx_graph_change_sets_apply_status ON graph_change_sets(apply_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ontology_entities_type_name ON ontology_entities(type, name);
      CREATE INDEX IF NOT EXISTS idx_ontology_entities_updated ON ontology_entities(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ontology_relations_subject_relation ON ontology_relations(subject_key, relation);
      CREATE INDEX IF NOT EXISTS idx_ontology_relations_object_relation ON ontology_relations(object_key, relation);
      CREATE INDEX IF NOT EXISTS idx_ontology_relations_source_meeting ON ontology_relations(source_meeting_id);
      CREATE INDEX IF NOT EXISTS idx_ontology_relations_updated ON ontology_relations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ontology_evidence_meeting ON ontology_evidence(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_ontology_entity_evidence_evidence ON ontology_entity_evidence(evidence_id);
    `);
    migrateApprovalSummaryColumns(db);
  });
}

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

export function upsertUser(input: {
  id?: string;
  displayName: string;
  email?: string;
  discordUserId?: string;
  notionUserId?: string;
  githubUsername?: string;
  team?: string;
  timezone?: string;
  isActive?: boolean;
}): UserRecord {
  const now = new Date().toISOString();
  const id = input.id ?? `user:${slugKey(input.email ?? input.displayName)}`;
  return withDb((db) => {
    statement(
      db,
      `INSERT INTO users (
        id, display_name, email, discord_user_id, notion_user_id, github_username,
        team, timezone, is_active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        email = excluded.email,
        discord_user_id = excluded.discord_user_id,
        notion_user_id = excluded.notion_user_id,
        github_username = excluded.github_username,
        team = excluded.team,
        timezone = excluded.timezone,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at`
    ).run(
      id,
      input.displayName,
      input.email ?? null,
      input.discordUserId ?? null,
      input.notionUserId ?? null,
      input.githubUsername ?? null,
      input.team ?? null,
      input.timezone ?? null,
      input.isActive === false ? 0 : 1,
      now,
      now
    );
    const row = statement(db, "SELECT * FROM users WHERE id = ?").get(id) as Row;
    return userFromRow(row);
  });
}

export function listUsers(options: PageOptions = {}): UserRecord[] {
  const { limit, offset } = normalizePage(options, 100, 100_000);
  return withDb((db) =>
    statement(db, "SELECT * FROM users ORDER BY display_name ASC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => userFromRow(row as Row))
  );
}

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

export function searchBrain(query: string, limit = 20, options: BrainSearchOptions = {}): BrainSearchResult[] {
  let ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const types = options.types?.filter((type) => type === "meeting" || type === "decision" || type === "action") ?? [];
  if (types.length === 1) {
    ftsQuery = `type:${types[0]} ${ftsQuery}`;
  }
  return withDb((db) => {
    const rows = searchBrainFtsRows(db, ftsQuery, normalizedLimit, types);
    const relaxedQuery = rows.length === 0 ? toRelaxedFtsQuery(query) : "";
    const relaxedRows = rows.length > 0 || !relaxedQuery ? rows : searchBrainFtsRows(db, relaxedQuery, normalizedLimit, types);
    const anyQuery = relaxedRows.length === 0 ? toAnyFtsQuery(query) : "";
    return (relaxedRows.length > 0 || !anyQuery ? relaxedRows : searchBrainFtsRows(db, anyQuery, normalizedLimit, types)).map((row) => {
      const item = row as Row;
      return {
        type: String(item.type) as BrainSearchResult["type"],
        id: String(item.entity_id),
        meetingId: optionalString(item.meeting_id),
        title: String(item.title),
        snippet: String(item.body),
        url: optionalString(item.url),
        createdAt: String(item.created_at),
      };
    });
  });
}

function searchBrainFtsRows(
  db: DatabaseSync,
  ftsQuery: string,
  normalizedLimit: number,
  types: Array<BrainSearchResult["type"]>
): Row[] {
  const typeClause = types.length > 1 ? ` AND type IN (${types.map(() => "?").join(", ")})` : "";
  const params = types.length > 1 ? [ftsQuery, ...types, normalizedLimit] : [ftsQuery, normalizedLimit];
  return statement(
    db,
    `SELECT type, entity_id, meeting_id, title, body, url, created_at
     FROM brain_fts
     WHERE brain_fts MATCH ?${typeClause}
     ORDER BY bm25(brain_fts)
     LIMIT ?`
  ).all(...params) as Row[];
}

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


export function listOntologyEntities(
  options: PageOptions & { type?: GraphEntityType; q?: string; changedSince?: string; includeProjects?: boolean } = {}
): OntologyEntityRow[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.type) {
      where.push("type = ?");
      params.push(options.type);
    } else if (!options.includeProjects) {
      where.push("type IN (" + ontologyEntityTypes.map(() => "?").join(", ") + ")");
      params.push(...ontologyEntityTypes);
    }
    if (options.q?.trim()) {
      const q = "%" + options.q.trim().toLowerCase() + "%";
      where.push("(lower(name) LIKE ? OR lower(aliases_json) LIKE ? OR lower(stable_key) LIKE ?)");
      params.push(q, q, q);
    }
    if (options.changedSince?.trim()) {
      where.push("updated_at > ?");
      params.push(options.changedSince.trim());
    }
    const sql = "SELECT * FROM ontology_entities" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY updated_at DESC, name ASC LIMIT ? OFFSET ?";
    return (statement(db, sql).all(...params, limit, offset) as Row[]).map(ontologyEntityFromRow);
  });
}

export function listOntologyRelations(
  options: PageOptions & { subjectKey?: string; objectKey?: string; relation?: string; sourceMeetingId?: string; changedSince?: string } = {}
): OntologyRelationRow[] {
  const { limit, offset } = normalizePage(options, 200, 2000);
  return withDb((db) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.subjectKey) {
      where.push("subject_key = ?");
      params.push(options.subjectKey);
    }
    if (options.objectKey) {
      where.push("object_key = ?");
      params.push(options.objectKey);
    }
    if (options.relation) {
      where.push("relation = ?");
      params.push(options.relation);
    }
    if (options.sourceMeetingId) {
      where.push("source_meeting_id = ?");
      params.push(options.sourceMeetingId);
    }
    if (options.changedSince?.trim()) {
      where.push("updated_at > ?");
      params.push(options.changedSince.trim());
    }
    const sql = "SELECT * FROM ontology_relations" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
    return (statement(db, sql).all(...params, limit, offset) as Row[]).map(ontologyRelationFromRow);
  });
}

export function listOntologyEvidence(
  options: PageOptions & { stableKey?: string; evidenceId?: string; meetingId?: string; changedSince?: string } = {}
): OntologyEvidenceRow[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) => {
    const params: Array<string | number> = [];
    const where: string[] = [];
    let sql = "SELECT e.* FROM ontology_evidence e";
    if (options.stableKey) {
      sql += " JOIN ontology_entity_evidence ee ON ee.evidence_id = e.evidence_id";
      where.push("ee.stable_key = ?");
      params.push(options.stableKey);
    }
    if (options.evidenceId) {
      where.push("e.evidence_id = ?");
      params.push(options.evidenceId);
    }
    if (options.meetingId) {
      where.push("e.meeting_id = ?");
      params.push(options.meetingId);
    }
    if (options.changedSince?.trim()) {
      where.push("e.updated_at > ?");
      params.push(options.changedSince.trim());
    }
    sql += (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY e.updated_at DESC LIMIT ? OFFSET ?";
    return (statement(db, sql).all(...params, limit, offset) as Row[]).map(ontologyEvidenceFromRow);
  });
}

export function rebuildOntologyMaterializedIndex(
  options: { limit?: number; reset?: boolean; changedSince?: string; dryRun?: boolean } = {}
): OntologyBackfillResult {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100_000), 1), 1_000_000);
  const changedSince = options.changedSince?.trim();
  const reset = options.reset ?? !changedSince;
  return withDb((db) =>
    withBrainTransaction(() => {
      const rows = selectGraphChangeSetRowsForOntologyBackfill(db, limit, changedSince);
      if (options.dryRun) return { ...estimateOntologyBackfill(rows), dryRun: true, reset, changedSince };
      if (reset) clearOntologyTablesInDb(db);
      const now = new Date().toISOString();
      for (const row of rows) materializeOntologyFromChangeSet(db, String(row.change_set_json), String(row.meeting_id), now);
      return { ...ontologyBackfillCounts(db, rows.length), dryRun: false, reset, changedSince };
    })
  );
}

export function clearOntologyMaterializedIndex(): void {
  withDb((db) => withBrainTransaction(() => clearOntologyTablesInDb(db)));
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

function validIsoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function appendAudit(eventType: string, entityType: string, entityId: string, detail: unknown): void {
  withDb((db) => insertAudit(db, eventType, entityType, entityId, detail));
}

export function withBrainTransaction<T>(callback: () => T): T {
  return withDb((db) => {
    const outermost = transactionDepth === 0;
    if (outermost) db.exec("BEGIN IMMEDIATE;");
    transactionDepth += 1;
    try {
      const result = callback();
      transactionDepth -= 1;
      if (outermost) db.exec("COMMIT;");
      return result;
    } catch (error) {
      transactionDepth -= 1;
      if (outermost) db.exec("ROLLBACK;");
      throw error;
    }
  });
}

export function withAuditSuppressed<T>(callback: () => T): T {
  auditSuppressionDepth += 1;
  try {
    return callback();
  } finally {
    auditSuppressionDepth -= 1;
  }
}

export function flushFtsQueue(limit = 1000): number {
  return withDb((db) => {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100_000);
    const countRow = statement(
      db,
      "SELECT COUNT(*) AS count FROM (SELECT 1 FROM fts_queue ORDER BY queued_at LIMIT ?)"
    ).get(normalizedLimit) as Row;
    const count = Number(countRow.count);
    if (count === 0) return 0;
    withBrainTransaction(() => {
      statement(
        db,
        `INSERT INTO brain_fts (type, entity_id, meeting_id, title, body, url, created_at)
         SELECT type, entity_id, meeting_id, title, body, url, created_at
         FROM fts_queue
         ORDER BY queued_at
         LIMIT ?`
      ).run(normalizedLimit);
      statement(
        db,
        `DELETE FROM fts_queue
         WHERE entity_key IN (
           SELECT entity_key FROM fts_queue ORDER BY queued_at LIMIT ?
         )`
      ).run(normalizedLimit);
    });
    return count;
  });
}

export function pendingFtsCount(): number {
  return withDb((db) => {
    const row = statement(db, "SELECT COUNT(*) AS count FROM fts_queue").get() as Row;
    return Number(row.count);
  });
}


function selectGraphChangeSetRowsForOntologyBackfill(db: DatabaseSync, limit: number, changedSince?: string): Row[] {
  return changedSince
    ? (statement(
        db,
        "SELECT meeting_id, change_set_json FROM graph_change_sets WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?"
      ).all(changedSince, limit) as Row[])
    : (statement(db, "SELECT meeting_id, change_set_json FROM graph_change_sets ORDER BY created_at ASC LIMIT ?").all(limit) as Row[]);
}

function estimateOntologyBackfill(rows: Row[]): OntologyBackfillResult {
  const entities = new Set<string>();
  const relations = new Set<string>();
  const evidence = new Set<string>();
  for (const row of rows) {
    const changeSet = parseGraphChangeSetJson(String(row.change_set_json));
    if (!changeSet) continue;
    for (const item of changeSet.entities) {
      if (materializedOntologyTypes.has(item.type)) entities.add(item.stableKey);
    }
    for (const item of changeSet.relations) relations.add(ontologyRelationId(item));
    for (const item of changeSet.evidence) evidence.add(item.evidenceId);
  }
  return { changeSets: rows.length, entities: entities.size, relations: relations.size, evidence: evidence.size };
}

function materializeOntologyFromChangeSet(db: DatabaseSync, changeSetJson: string, fallbackMeetingId: string, now: string): void {
  const changeSet = parseGraphChangeSetJson(changeSetJson);
  if (!changeSet) return;
  const sourceMeetingId = changeSet.sourceMeetingId || fallbackMeetingId;
  const evidenceIds = new Set(changeSet.evidence.map((item) => item.evidenceId));

  for (const evidence of changeSet.evidence) {
    statement(
      db,
      `INSERT INTO ontology_evidence (
        evidence_id, kind, source, source_id, meeting_id, title, excerpt, url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evidence_id) DO UPDATE SET
        kind = excluded.kind,
        source = excluded.source,
        source_id = excluded.source_id,
        meeting_id = excluded.meeting_id,
        title = excluded.title,
        excerpt = excluded.excerpt,
        url = excluded.url,
        updated_at = excluded.updated_at`
    ).run(
      evidence.evidenceId,
      evidence.kind,
      evidence.source,
      evidence.sourceId,
      evidence.meetingId || sourceMeetingId,
      evidence.title ?? null,
      evidence.excerpt ?? null,
      evidence.url ?? null,
      now,
      now
    );
  }

  for (const entity of changeSet.entities) {
    if (!materializedOntologyTypes.has(entity.type)) continue;
    const existing = statement(db, "SELECT * FROM ontology_entities WHERE stable_key = ?").get(entity.stableKey) as Row | undefined;
    const aliases = mergeJsonArrays(existing?.aliases_json, entity.aliases ?? []);
    const evidenceForEntity = mergeJsonArrays(existing?.evidence_ids_json, entity.evidenceIds.filter((id) => evidenceIds.has(id)));
    const sourceMeetings = mergeJsonArrays(existing?.source_meeting_ids_json, [sourceMeetingId]);
    const properties = { ...parseJsonObject(existing?.properties_json), ...(entity.properties ?? {}) };
    statement(
      db,
      `INSERT INTO ontology_entities (
        stable_key, type, name, aliases_json, properties_json, evidence_ids_json, source_meeting_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stable_key) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        aliases_json = excluded.aliases_json,
        properties_json = excluded.properties_json,
        evidence_ids_json = excluded.evidence_ids_json,
        source_meeting_ids_json = excluded.source_meeting_ids_json,
        updated_at = excluded.updated_at`
    ).run(
      entity.stableKey,
      entity.type,
      entity.name,
      JSON.stringify(aliases),
      JSON.stringify(properties),
      JSON.stringify(evidenceForEntity),
      JSON.stringify(sourceMeetings),
      existing?.created_at ? String(existing.created_at) : now,
      now
    );
    for (const evidenceId of evidenceForEntity) {
      statement(db, "INSERT OR IGNORE INTO ontology_entity_evidence (stable_key, evidence_id) VALUES (?, ?)").run(
        entity.stableKey,
        evidenceId
      );
    }
  }

  for (const relation of changeSet.relations) {
    const id = ontologyRelationId(relation);
    statement(
      db,
      `INSERT INTO ontology_relations (
        id, subject_key, relation, object_key, evidence_id, valid_from, confidence, properties_json, source_meeting_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        subject_key = excluded.subject_key,
        relation = excluded.relation,
        object_key = excluded.object_key,
        evidence_id = excluded.evidence_id,
        valid_from = excluded.valid_from,
        confidence = excluded.confidence,
        properties_json = excluded.properties_json,
        source_meeting_id = excluded.source_meeting_id,
        updated_at = excluded.updated_at`
    ).run(
      id,
      relation.subjectKey,
      relation.relation,
      relation.objectKey,
      relation.evidenceId,
      relation.validFrom ?? null,
      relation.confidence,
      JSON.stringify(relation.properties ?? {}),
      sourceMeetingId,
      now,
      now
    );
  }
}

function clearOntologyTablesInDb(db: DatabaseSync): void {
  statement(db, "DELETE FROM ontology_entity_evidence").run();
  statement(db, "DELETE FROM ontology_relations").run();
  statement(db, "DELETE FROM ontology_evidence").run();
  statement(db, "DELETE FROM ontology_entities").run();
}

function ontologyBackfillCounts(db: DatabaseSync, changeSets: number): OntologyBackfillResult {
  const count = (table: string) => Number((statement(db, "SELECT COUNT(*) AS count FROM " + table).get() as Row).count);
  return {
    changeSets,
    entities: count("ontology_entities"),
    relations: count("ontology_relations"),
    evidence: count("ontology_evidence"),
  };
}

function parseGraphChangeSetJson(value: string): GraphChangeSet | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isGraphChangeSetRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isGraphChangeSetRecord(value: unknown): value is GraphChangeSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && Array.isArray(record.entities) && Array.isArray(record.relations) && Array.isArray(record.evidence);
}

function ontologyRelationId(relation: { subjectKey: string; relation: string; objectKey: string; evidenceId: string; validFrom?: string }): string {
  const raw = [relation.subjectKey, relation.relation, relation.objectKey, relation.evidenceId, relation.validFrom ?? ""].join("|");
  return "ontology_relation:" + createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function mergeJsonArrays(existingJson: unknown, next: string[]): string[] {
  return uniqueStringValues([...parseJsonStringArray(existingJson), ...next]);
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, string | number | boolean | null> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string | number | boolean | null>)
      : {};
  } catch {
    return {};
  }
}

function uniqueStringValues(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function ontologyEntityFromRow(row: Row): OntologyEntityRow {
  return {
    stableKey: String(row.stable_key),
    type: String(row.type) as GraphEntityType,
    name: String(row.name),
    aliasesJson: String(row.aliases_json),
    propertiesJson: String(row.properties_json),
    evidenceIdsJson: String(row.evidence_ids_json),
    sourceMeetingIdsJson: String(row.source_meeting_ids_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function ontologyRelationFromRow(row: Row): OntologyRelationRow {
  return {
    id: String(row.id),
    subjectKey: String(row.subject_key),
    relation: String(row.relation),
    objectKey: String(row.object_key),
    evidenceId: String(row.evidence_id),
    validFrom: optionalString(row.valid_from),
    confidence: Number(row.confidence),
    propertiesJson: String(row.properties_json),
    sourceMeetingId: String(row.source_meeting_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function ontologyEvidenceFromRow(row: Row): OntologyEvidenceRow {
  return {
    evidenceId: String(row.evidence_id),
    kind: String(row.kind),
    source: String(row.source),
    sourceId: String(row.source_id),
    meetingId: String(row.meeting_id),
    title: optionalString(row.title),
    excerpt: optionalString(row.excerpt),
    url: optionalString(row.url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function upsertGraphChangeSet(
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

function markGraphChangeSetApplied(db: DatabaseSync, graphSyncJobId: string, appliedAt: string): void {
  statement(
    db,
    "UPDATE graph_change_sets SET apply_status = ?, applied_at = ?, last_error = NULL, updated_at = ? WHERE graph_sync_job_id = ?"
  ).run("applied", appliedAt, appliedAt, graphSyncJobId);
  const row = statement(db, "SELECT id FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
    | Row
    | undefined;
  if (row) insertAudit(db, "graph_change_set.applied", "graph_change_set", String(row.id), { graphSyncJobId });
}

function markGraphChangeSetFailed(
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

function insertAudit(db: DatabaseSync, eventType: string, entityType: string, entityId: string, detail: unknown): void {
  if (auditSuppressionDepth > 0 || process.env.PERRY_AUDIT_MODE === "off") return;
  const now = new Date().toISOString();
    statement(
      db,
      "INSERT INTO audit_log (id, event_type, entity_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(`${now}:${eventType}:${entityId}`, eventType, entityType, entityId, JSON.stringify(detail), now);
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

function withDb<T>(callback: (db: DatabaseSync) => T): T {
  const path = databasePath();
  const db = getDb(path);
  return callback(db);
}

export function closeBrainStore(path = databasePath()): void {
  const db = dbCache.get(path);
  if (!db) return;
  db.close();
  dbCache.delete(path);
}


function getDb(path: string): DatabaseSync {
  const cached = dbCache.get(path);
  if (cached) return cached;
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = ${sqliteJournalMode()};`);
  db.exec("PRAGMA foreign_keys = ON;");
  if (!migratedDbs.has(db)) {
    migrateOpenDb(db);
    migratedDbs.add(db);
  }
  dbCache.set(path, db);
  return db;
}

function statement(db: DatabaseSync, sql: string): StatementSync {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map<string, StatementSync>();
    statementCache.set(db, cache);
  }
  const cached = cache.get(sql);
  if (cached) return cached;
  const prepared = db.prepare(sql);
  cache.set(sql, prepared);
  return prepared;
}

function migrateOpenDb(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      notion_page_id TEXT,
      notion_url TEXT,
      discord_message_url TEXT,
      status TEXT NOT NULL,
      error TEXT,
      UNIQUE(source, source_id)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      owner TEXT,
      due_date TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      url TEXT,
      title TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT,
      discord_user_id TEXT,
      notion_user_id TEXT,
      github_username TEXT,
      team TEXT,
      timezone TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      project TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      owner TEXT,
      source_meeting_id TEXT,
      source_action_id TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_events (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor TEXT,
      detail_json TEXT NOT NULL,
      meeting_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pivots (
      id TEXT PRIMARY KEY,
      project TEXT,
      subject TEXT NOT NULL,
      previous_owner TEXT,
      new_owner TEXT,
      fallback_reviewer TEXT,
      reason TEXT NOT NULL,
      source_decision_id TEXT NOT NULL,
      source_meeting_id TEXT NOT NULL,
      affected_issue_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      announcement TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      route_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      route_project TEXT,
      route_reason TEXT,
      publish_mode TEXT,
      decision_count INTEGER NOT NULL DEFAULT 0,
      action_item_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fts_queue (
      entity_key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      meeting_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT,
      created_at TEXT NOT NULL,
      queued_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      not_before TEXT NOT NULL,
      locked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_sync_jobs (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      not_before TEXT NOT NULL,
      locked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_change_sets (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      graph_sync_job_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_errors_json TEXT NOT NULL,
      validation_warnings_json TEXT NOT NULL,
      change_set_json TEXT NOT NULL,
      apply_status TEXT NOT NULL,
      applied_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );



    CREATE TABLE IF NOT EXISTS ontology_entities (
      stable_key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      source_meeting_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ontology_relations (
      id TEXT PRIMARY KEY,
      subject_key TEXT NOT NULL,
      relation TEXT NOT NULL,
      object_key TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      valid_from TEXT,
      confidence REAL NOT NULL,
      properties_json TEXT NOT NULL,
      source_meeting_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ontology_evidence (
      evidence_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      title TEXT,
      excerpt TEXT,
      url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ontology_entity_evidence (
      stable_key TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      PRIMARY KEY(stable_key, evidence_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
      type,
      entity_id UNINDEXED,
      meeting_id UNINDEXED,
      title,
      body,
      url UNINDEXED,
      created_at UNINDEXED
    );

    CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);
    CREATE INDEX IF NOT EXISTS idx_meetings_source_id ON meetings(source, source_id);
    CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
    CREATE INDEX IF NOT EXISTS idx_decisions_meeting_id ON decisions(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);
    CREATE INDEX IF NOT EXISTS idx_actions_meeting_id ON action_items(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_actions_created_at ON action_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_actions_owner_status_created ON action_items(owner, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_actions_status_due_created ON action_items(status, due_date, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_issues_owner_status ON issues(owner, status);
    CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project, status);
    CREATE INDEX IF NOT EXISTS idx_issues_source_action ON issues(source_action_id);
    CREATE INDEX IF NOT EXISTS idx_issue_events_issue_id ON issue_events(issue_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pivots_subject_created_at ON pivots(subject, created_at);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_status_created_at ON approvals(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at);
    CREATE INDEX IF NOT EXISTS idx_approvals_status_project_created_at ON approvals(status, route_project, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fts_queue_queued_at ON fts_queue(queued_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_not_before ON ingestion_jobs(status, not_before, created_at);
    CREATE INDEX IF NOT EXISTS idx_graph_sync_jobs_status_not_before ON graph_sync_jobs(status, not_before, created_at);
    CREATE INDEX IF NOT EXISTS idx_graph_sync_jobs_entity ON graph_sync_jobs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_graph_change_sets_meeting_id ON graph_change_sets(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_graph_change_sets_job_id ON graph_change_sets(graph_sync_job_id);
    CREATE INDEX IF NOT EXISTS idx_graph_change_sets_apply_status ON graph_change_sets(apply_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ontology_entities_type_name ON ontology_entities(type, name);
    CREATE INDEX IF NOT EXISTS idx_ontology_entities_updated ON ontology_entities(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ontology_relations_subject_relation ON ontology_relations(subject_key, relation);
    CREATE INDEX IF NOT EXISTS idx_ontology_relations_object_relation ON ontology_relations(object_key, relation);
    CREATE INDEX IF NOT EXISTS idx_ontology_relations_source_meeting ON ontology_relations(source_meeting_id);
    CREATE INDEX IF NOT EXISTS idx_ontology_relations_updated ON ontology_relations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ontology_evidence_meeting ON ontology_evidence(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_ontology_entity_evidence_evidence ON ontology_entity_evidence(evidence_id);
  `);
  migrateApprovalSummaryColumns(db);
}

function migrateApprovalSummaryColumns(db: DatabaseSync): void {
  addColumnIfMissing(db, "approvals", "route_project", "TEXT");
  addColumnIfMissing(db, "approvals", "route_reason", "TEXT");
  addColumnIfMissing(db, "approvals", "publish_mode", "TEXT");
  addColumnIfMissing(db, "approvals", "decision_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "approvals", "action_item_count", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Row[];
  if (rows.some((row) => row.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

function queueFts(
  db: DatabaseSync,
  record: {
    type: BrainSearchResult["type"];
    entityId: string;
    meetingId?: string;
    title: string;
    body: string;
    url?: string;
    createdAt: string;
    queuedAt?: string;
  }
): void {
  statement(
    db,
    `INSERT INTO fts_queue (
      entity_key, type, entity_id, meeting_id, title, body, url, created_at, queued_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_key) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      url = excluded.url,
      created_at = excluded.created_at,
      queued_at = excluded.queued_at`
  ).run(
    `${record.type}:${record.entityId}`,
    record.type,
    record.entityId,
    record.meetingId ?? null,
    record.title,
    record.body,
    record.url ?? null,
    record.createdAt,
    record.queuedAt ?? new Date().toISOString()
  );
}

function queueFtsAppendOnly(
  db: DatabaseSync,
  record: {
    type: BrainSearchResult["type"];
    entityId: string;
    meetingId?: string;
    title: string;
    body: string;
    url?: string;
    createdAt: string;
    queuedAt?: string;
  }
): void {
  statement(
    db,
    `INSERT INTO fts_queue (
      entity_key, type, entity_id, meeting_id, title, body, url, created_at, queued_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${record.type}:${record.entityId}`,
    record.type,
    record.entityId,
    record.meetingId ?? null,
    record.title,
    record.body,
    record.url ?? null,
    record.createdAt,
    record.queuedAt ?? new Date().toISOString()
  );
}

function insertFts(
  db: DatabaseSync,
  record: {
    type: BrainSearchResult["type"];
    entityId: string;
    meetingId?: string;
    title: string;
    body: string;
    url?: string;
    createdAt: string;
  }
): void {
  statement(
    db,
    "INSERT INTO brain_fts (type, entity_id, meeting_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    record.type,
    record.entityId,
    record.meetingId ?? null,
    record.title,
    record.body,
    record.url ?? null,
    record.createdAt
  );
}

function toFtsQuery(query: string): string {
  return ftsQueryParts(query)
    .map((part) => `${part}*`)
    .join(" ");
}

function toRelaxedFtsQuery(query: string): string {
  return ftsQueryParts(query)
    .filter((part) => !/^\d$/u.test(part))
    .map((part) => `${part}*`)
    .join(" ");
}

function toAnyFtsQuery(query: string): string {
  return ftsQueryParts(query)
    .filter((part) => !/^\d$/u.test(part))
    .map((part) => `${part}*`)
    .join(" OR ");
}

function ftsQueryParts(query: string): string[] {
  return query
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function meetingFromRow(row: Row): MeetingRecord {
  return {
    id: String(row.id),
    source: String(row.source) as MeetingNote["source"],
    sourceId: optionalString(row.source_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    notionPageId: optionalString(row.notion_page_id),
    notionUrl: optionalString(row.notion_url),
    discordMessageUrl: optionalString(row.discord_message_url),
    status: String(row.status) as MeetingRecord["status"],
    error: optionalString(row.error),
  };
}

function decisionFromRow(row: Row): DecisionRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    text: String(row.text),
    status: String(row.status) as DecisionRecord["status"],
    createdAt: String(row.created_at),
  };
}

function actionFromRow(row: Row): ActionItemRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    text: String(row.text),
    owner: optionalString(row.owner),
    dueDate: optionalString(row.due_date),
    status: String(row.status) as ActionItemRecord["status"],
    createdAt: String(row.created_at),
  };
}

function userFromRow(row: Row): UserRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: optionalString(row.email),
    discordUserId: optionalString(row.discord_user_id),
    notionUserId: optionalString(row.notion_user_id),
    githubUsername: optionalString(row.github_username),
    team: optionalString(row.team),
    timezone: optionalString(row.timezone),
    isActive: Number(row.is_active) !== 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function issueFromRow(row: Row): IssueRecord {
  return {
    id: String(row.id),
    project: optionalString(row.project),
    title: String(row.title),
    description: optionalString(row.description),
    status: String(row.status) as IssueRecord["status"],
    priority: String(row.priority) as IssueRecord["priority"],
    owner: optionalString(row.owner),
    sourceMeetingId: optionalString(row.source_meeting_id),
    sourceActionId: optionalString(row.source_action_id),
    dueDate: optionalString(row.due_date),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function issueEventFromRow(row: Row): IssueEventRecord {
  return {
    id: String(row.id),
    issueId: String(row.issue_id),
    type: String(row.type) as IssueEventRecord["type"],
    actor: optionalString(row.actor),
    detailJson: String(row.detail_json),
    meetingId: optionalString(row.meeting_id),
    createdAt: String(row.created_at),
  };
}

function pivotFromRow(row: Row): PivotRecord {
  return {
    id: String(row.id),
    project: optionalString(row.project),
    subject: String(row.subject),
    previousOwner: optionalString(row.previous_owner),
    newOwner: optionalString(row.new_owner),
    fallbackReviewer: optionalString(row.fallback_reviewer),
    reason: String(row.reason),
    sourceDecisionId: String(row.source_decision_id),
    sourceMeetingId: String(row.source_meeting_id),
    affectedIssueIds: JSON.parse(String(row.affected_issue_ids_json)) as string[],
    createdAt: String(row.created_at),
  };
}

function approvalFromRow(row: Row): ApprovalRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    title: String(row.title),
    payloadJson: String(row.payload_json),
    announcement: String(row.announcement),
    knowledgeJson: String(row.knowledge_json),
    routeJson: String(row.route_json),
    status: String(row.status) as ApprovalRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function approvalSummaryFromRow(row: Row): ApprovalSummaryRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    title: String(row.title),
    announcement: String(row.announcement),
    routeProject: optionalString(row.route_project),
    routeReason: optionalString(row.route_reason),
    publishMode: optionalString(row.publish_mode),
    decisionCount: Number(row.decision_count ?? 0),
    actionItemCount: Number(row.action_item_count ?? 0),
    status: String(row.status) as ApprovalRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function ingestionJobFromRow(row: Row): IngestionJobRecord {
  return {
    id: String(row.id),
    type: String(row.type) as IngestionJobRecord["type"],
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as IngestionJobRecord["status"],
    payloadJson: String(row.payload_json),
    resultJson: optionalString(row.result_json),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    notBefore: String(row.not_before),
    lockedAt: optionalString(row.locked_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function graphSyncJobFromRow(row: Row): GraphSyncJobRecord {
  return {
    id: String(row.id),
    entityType: String(row.entity_type) as GraphSyncJobRecord["entityType"],
    entityId: String(row.entity_id),
    status: String(row.status) as GraphSyncJobRecord["status"],
    payloadJson: String(row.payload_json),
    resultJson: optionalString(row.result_json),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    notBefore: String(row.not_before),
    lockedAt: optionalString(row.locked_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function graphChangeSetFromRow(row: Row): GraphChangeSetRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    graphSyncJobId: String(row.graph_sync_job_id),
    groupId: String(row.group_id),
    validationStatus: String(row.validation_status) as GraphChangeSetRecord["validationStatus"],
    validationErrorsJson: String(row.validation_errors_json),
    validationWarningsJson: String(row.validation_warnings_json),
    changeSetJson: String(row.change_set_json),
    applyStatus: String(row.apply_status) as GraphChangeSetRecord["applyStatus"],
    appliedAt: optionalString(row.applied_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
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

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function slugKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function normalizePage(options: PageOptions, defaultLimit: number, maxLimit: number): Required<PageOptions> {
  return {
    limit: Math.min(Math.max(Math.trunc(options.limit ?? defaultLimit), 0), maxLimit),
    offset: Math.max(Math.trunc(options.offset ?? 0), 0),
  };
}


