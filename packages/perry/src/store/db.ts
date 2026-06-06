// db — split out of the former monolithic meeting-store.ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { type BrainSearchResult, type PageOptions } from "./types";
import { migrateApprovalSummaryColumns, migrateOpenDb } from "./schema";

const dbCache = new Map<string, DatabaseSync>();

const migratedDbs = new WeakSet<DatabaseSync>();

const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

let transactionDepth = 0;

let auditSuppressionDepth = 0;

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

export function validIsoOrUndefined(value: string | undefined): string | undefined {
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

export function mergeJsonArrays(existingJson: unknown, next: string[]): string[] {
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

export function parseJsonObject(value: unknown): Record<string, string | number | boolean | null> {
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

export function insertAudit(db: DatabaseSync, eventType: string, entityType: string, entityId: string, detail: unknown): void {
  if (auditSuppressionDepth > 0 || process.env.PERRY_AUDIT_MODE === "off") return;
  const now = new Date().toISOString();
    statement(
      db,
      "INSERT INTO audit_log (id, event_type, entity_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(`${now}:${eventType}:${entityId}`, eventType, entityType, entityId, JSON.stringify(detail), now);
}

export function withDb<T>(callback: (db: DatabaseSync) => T): T {
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

export function statement(db: DatabaseSync, sql: string): StatementSync {
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

export function queueFts(
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

export function queueFtsAppendOnly(
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

export function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function slugKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

export function normalizePage(options: PageOptions, defaultLimit: number, maxLimit: number): Required<PageOptions> {
  return {
    limit: Math.min(Math.max(Math.trunc(options.limit ?? defaultLimit), 0), maxLimit),
    offset: Math.max(Math.trunc(options.offset ?? 0), 0),
  };
}
