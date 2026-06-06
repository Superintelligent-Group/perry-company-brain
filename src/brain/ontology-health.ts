import { companyOntologyEntityTypes, type GraphChangeSet } from "@core";
import {
  listGraphChangeSets,
  listOntologyEntities,
  listOntologyEvidence,
  listOntologyRelations,
  type OntologyEntityRow,
  type OntologyEvidenceRow,
  type OntologyRelationRow,
} from "@store";

export type OntologyHealthSeverity = "pass" | "warning" | "critical";

export interface OntologyHealthCheck {
  id: string;
  severity: OntologyHealthSeverity;
  passed: boolean;
  detail: string;
}

export interface OntologyHealthReport {
  ok: boolean;
  generatedAt: string;
  limits: {
    changeSets: number;
    entities: number;
    relations: number;
    evidence: number;
  };
  counts: {
    sampledGraphChangeSets: number;
    parsedGraphChangeSets: number;
    expectedEntities: number;
    expectedRelations: number;
    expectedEvidence: number;
    materializedEntities: number;
    materializedRelations: number;
    materializedEvidence: number;
    duplicateNameGroups: number;
    orphanedEvidence: number;
    relationsMissingEvidence: number;
    entitiesMissingEvidence: number;
    unprojectedEntities: number;
  };
  duplicateNameGroups: Array<{ type: string; name: string; stableKeys: string[] }>;
  orphanedEvidenceIds: string[];
  relationIdsMissingEvidence: string[];
  entityKeysMissingEvidence: string[];
  unprojectedEntityKeys: string[];
  checks: OntologyHealthCheck[];
}

const materializedEntityTypes = new Set<string>(["project", ...companyOntologyEntityTypes]);

export function getOntologyHealthReport(
  options: { changeSetLimit?: number; entityLimit?: number; relationLimit?: number; evidenceLimit?: number } = {}
): OntologyHealthReport {
  const limits = {
    changeSets: clamp(options.changeSetLimit ?? 200, 1, 200),
    entities: clamp(options.entityLimit ?? 1000, 1, 1000),
    relations: clamp(options.relationLimit ?? 2000, 1, 2000),
    evidence: clamp(options.evidenceLimit ?? 1000, 1, 1000),
  };
  const changeSetRows = listGraphChangeSets({ limit: limits.changeSets });
  const parsedChangeSets = changeSetRows.map((row) => parseGraphChangeSet(row.changeSetJson)).filter((item): item is GraphChangeSet => Boolean(item));
  const entities = listOntologyEntities({ includeProjects: true, limit: limits.entities });
  const relations = listOntologyRelations({ limit: limits.relations });
  const evidence = listOntologyEvidence({ limit: limits.evidence });

  const expected = expectedGraphCounts(parsedChangeSets);
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  const relationIdsMissingEvidence = relations
    .filter((relation) => relation.evidenceId && !evidenceIds.has(relation.evidenceId))
    .map(relationKey)
    .slice(0, 50);
  const entityKeysMissingEvidence = entities
    .filter((entity) => entity.type !== "project" && parseStringArray(entity.evidenceIdsJson).length === 0)
    .map((entity) => entity.stableKey)
    .slice(0, 50);
  const orphanedEvidenceIds = findOrphanedEvidence(evidence, entities, relations).slice(0, 50);
  const duplicateNameGroups = findDuplicateNameGroups(entities).slice(0, 50);
  const unprojectedEntityKeys = findUnprojectedEntities(entities, relations).slice(0, 50);

  const checks: OntologyHealthCheck[] = [
    check(
      "graph_change_sets_parse",
      parsedChangeSets.length === changeSetRows.length,
      "critical",
      `${parsedChangeSets.length}/${changeSetRows.length} sampled graph change sets parse`
    ),
    check(
      "materialized_entities_present",
      changeSetRows.length === 0 || entities.length > 0,
      "critical",
      `${entities.length} sampled materialized entities`
    ),
    check(
      "materialized_entity_coverage",
      expected.entities === 0 || entities.length >= Math.min(expected.entities, limits.entities),
      "warning",
      `${entities.length} materialized vs ${expected.entities} expected in sampled change sets`
    ),
    check(
      "materialized_relation_coverage",
      expected.relations === 0 || relations.length >= Math.min(expected.relations, limits.relations),
      "warning",
      `${relations.length} materialized vs ${expected.relations} expected in sampled change sets`
    ),
    check(
      "materialized_evidence_coverage",
      expected.evidence === 0 || evidence.length >= Math.min(expected.evidence, limits.evidence),
      "warning",
      `${evidence.length} materialized vs ${expected.evidence} expected in sampled change sets`
    ),
    check("relations_have_evidence", relationIdsMissingEvidence.length === 0, "critical", `${relationIdsMissingEvidence.length} sampled relations point at missing evidence`),
    check("entities_have_evidence", entityKeysMissingEvidence.length === 0, "warning", `${entityKeysMissingEvidence.length} sampled non-project entities have no direct evidence`),
    check("evidence_is_linked", orphanedEvidenceIds.length === 0, "warning", `${orphanedEvidenceIds.length} sampled evidence rows are not referenced`),
    check("semantic_name_duplicates", duplicateNameGroups.length === 0, "warning", `${duplicateNameGroups.length} sampled duplicate type/name groups`),
    check("project_link_coverage", unprojectedEntityKeys.length === 0, "warning", `${unprojectedEntityKeys.length} sampled non-project entities lack a project/meeting link`),
  ];

  const counts = {
    sampledGraphChangeSets: changeSetRows.length,
    parsedGraphChangeSets: parsedChangeSets.length,
    expectedEntities: expected.entities,
    expectedRelations: expected.relations,
    expectedEvidence: expected.evidence,
    materializedEntities: entities.length,
    materializedRelations: relations.length,
    materializedEvidence: evidence.length,
    duplicateNameGroups: duplicateNameGroups.length,
    orphanedEvidence: orphanedEvidenceIds.length,
    relationsMissingEvidence: relationIdsMissingEvidence.length,
    entitiesMissingEvidence: entityKeysMissingEvidence.length,
    unprojectedEntities: unprojectedEntityKeys.length,
  };

  return {
    ok: checks.every((item) => item.passed || item.severity !== "critical"),
    generatedAt: new Date().toISOString(),
    limits,
    counts,
    duplicateNameGroups,
    orphanedEvidenceIds,
    relationIdsMissingEvidence,
    entityKeysMissingEvidence,
    unprojectedEntityKeys,
    checks,
  };
}

function expectedGraphCounts(changeSets: GraphChangeSet[]): { entities: number; relations: number; evidence: number } {
  const entities = new Set<string>();
  const relations = new Set<string>();
  const evidence = new Set<string>();
  for (const changeSet of changeSets) {
    for (const entity of changeSet.entities) {
      if (materializedEntityTypes.has(entity.type)) entities.add(entity.stableKey);
    }
    for (const relation of changeSet.relations) {
      relations.add(`${relation.subjectKey}|${relation.relation}|${relation.objectKey}|${relation.evidenceId}|${relation.validFrom ?? ""}`);
    }
    for (const item of changeSet.evidence) evidence.add(item.evidenceId);
  }
  return { entities: entities.size, relations: relations.size, evidence: evidence.size };
}

function findOrphanedEvidence(
  evidence: OntologyEvidenceRow[],
  entities: OntologyEntityRow[],
  relations: OntologyRelationRow[]
): string[] {
  const referenced = new Set<string>();
  for (const entity of entities) {
    for (const evidenceId of parseStringArray(entity.evidenceIdsJson)) referenced.add(evidenceId);
  }
  for (const relation of relations) referenced.add(relation.evidenceId);
  return evidence.map((item) => item.evidenceId).filter((evidenceId) => !referenced.has(evidenceId));
}

function findDuplicateNameGroups(entities: OntologyEntityRow[]): Array<{ type: string; name: string; stableKeys: string[] }> {
  const groups = new Map<string, { type: string; name: string; stableKeys: string[] }>();
  for (const entity of entities) {
    if (entity.type === "project") continue;
    const key = `${entity.type}:${normalizeName(entity.name)}`;
    const group = groups.get(key) ?? { type: entity.type, name: entity.name, stableKeys: [] };
    group.stableKeys.push(entity.stableKey);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.stableKeys.length > 1);
}

function findUnprojectedEntities(entities: OntologyEntityRow[], relations: OntologyRelationRow[]): string[] {
  const linked = new Set<string>();
  for (const relation of relations) {
    if (relation.subjectKey.startsWith("project:") || relation.subjectKey.startsWith("meeting:")) linked.add(relation.objectKey);
    if (relation.objectKey.startsWith("project:") || relation.objectKey.startsWith("meeting:")) linked.add(relation.subjectKey);
  }
  return entities.filter((entity) => entity.type !== "project" && !linked.has(entity.stableKey)).map((entity) => entity.stableKey);
}

function check(id: string, passed: boolean, severity: Exclude<OntologyHealthSeverity, "pass">, detail: string): OntologyHealthCheck {
  return { id, passed, severity: passed ? "pass" : severity, detail };
}

function parseGraphChangeSet(value: string): GraphChangeSet | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Partial<GraphChangeSet>;
    return record.schemaVersion === 1 && Array.isArray(record.entities) && Array.isArray(record.relations) && Array.isArray(record.evidence)
      ? (record as GraphChangeSet)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function relationKey(relation: OntologyRelationRow): string {
  return `${relation.subjectKey}|${relation.relation}|${relation.objectKey}|${relation.evidenceId}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}


