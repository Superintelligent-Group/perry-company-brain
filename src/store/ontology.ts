// ontology — split out of the former monolithic meeting-store.ts
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type CompanyOntologyEntityType, type GraphChangeSet, type GraphEntityType } from "@core";
import { type OntologyBackfillResult, type OntologyEntityRow, type OntologyEvidenceRow, type OntologyRelationRow, type PageOptions, type Row } from "./types";
import { mergeJsonArrays, normalizePage, optionalString, parseJsonObject, statement, withBrainTransaction, withDb } from "./db";

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

export function materializeOntologyFromChangeSet(db: DatabaseSync, changeSetJson: string, fallbackMeetingId: string, now: string): void {
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
