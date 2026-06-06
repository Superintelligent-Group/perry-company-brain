import type { GraphChangeSet, GraphEntityType, GraphEntityUpsert, GraphEvidenceLink, GraphRelationAssertion, GraphRelationType } from "@core";
export type { CompanyOntologyEntityType } from "@core";
import { companyOntologyEntityTypes, type CompanyOntologyEntityType } from "@core";
import {
  listGraphChangeSets,
  listOntologyEntities,
  listOntologyEvidence,
  listOntologyRelations,
  type OntologyEntityRow,
  type OntologyEvidenceRow,
  type OntologyRelationRow,
} from "@store";

export interface OntologyEntityRecord extends GraphEntityUpsert {
  sourceMeetingIds: string[];
  incoming: GraphRelationAssertion[];
  outgoing: GraphRelationAssertion[];
  evidence: GraphEvidenceLink[];
  updatedAt?: string;
}

export interface OntologyIndex {
  generatedAt: string;
  changeSetCount: number;
  entities: OntologyEntityRecord[];
  relations: GraphRelationAssertion[];
  evidence: GraphEvidenceLink[];
  warnings: string[];
}

export interface OntologyQueryOptions {
  project?: string;
  q?: string;
  limit?: number;
}

export interface OntologyQueryResult {
  type: CompanyOntologyEntityType;
  project?: string;
  count: number;
  entities: OntologyEntityRecord[];
}

export interface OntologyChangedSinceResult {
  since: string;
  count: number;
  entities: OntologyEntityRecord[];
}

const ontologyTypes = new Set<CompanyOntologyEntityType>(companyOntologyEntityTypes);

const projectRelationsByType: Record<CompanyOntologyEntityType, GraphRelationType[]> = {
  goal: ["SUPPORTS_GOAL"],
  metric: [],
  risk: ["HAS_RISK"],
  blocker: ["BLOCKED_BY"],
  open_question: ["HAS_OPEN_QUESTION"],
  capability: ["IMPLEMENTS_CAPABILITY"],
  feature: [],
  artifact: [],
  benchmark_report: [],
};

export function getOntologyIndex(limit = 1000): OntologyIndex {
  const rowIndex = getMaterializedOntologyIndex(limit);
  if (rowIndex.entities.length > 0 || rowIndex.relations.length > 0 || rowIndex.evidence.length > 0) return rowIndex;
  return getChangeSetOntologyIndex(limit);
}

export function buildOntologyIndex(changeSets: GraphChangeSet[]): OntologyIndex {
  const entities = new Map<string, OntologyEntityRecord>();
  const relations: GraphRelationAssertion[] = [];
  const evidence = new Map<string, GraphEvidenceLink>();
  const warnings: string[] = [];

  for (const changeSet of changeSets) {
    warnings.push(...changeSet.warnings);
    for (const item of changeSet.evidence) {
      evidence.set(item.evidenceId, { ...evidence.get(item.evidenceId), ...item });
    }
    for (const entity of changeSet.entities) {
      if (!ontologyTypes.has(entity.type as CompanyOntologyEntityType) && entity.type !== "project") continue;
      const existing = entities.get(entity.stableKey);
      if (!existing) {
        entities.set(entity.stableKey, {
          ...entity,
          aliases: unique(entity.aliases ?? []),
          evidenceIds: unique(entity.evidenceIds),
          sourceMeetingIds: [changeSet.sourceMeetingId],
          incoming: [],
          outgoing: [],
          evidence: [],
        });
        continue;
      }
      entities.set(entity.stableKey, {
        ...existing,
        aliases: unique([...(existing.aliases ?? []), ...(entity.aliases ?? [])]),
        properties: { ...(existing.properties ?? {}), ...(entity.properties ?? {}) },
        evidenceIds: unique([...existing.evidenceIds, ...entity.evidenceIds]),
        sourceMeetingIds: unique([...existing.sourceMeetingIds, changeSet.sourceMeetingId]),
      });
    }
    relations.push(...changeSet.relations);
  }

  hydrateOntologyRecords(entities, relations, evidence);

  return {
    generatedAt: new Date().toISOString(),
    changeSetCount: changeSets.length,
    entities: [...entities.values()].filter((entity) => ontologyTypes.has(entity.type as CompanyOntologyEntityType)),
    relations,
    evidence: [...evidence.values()],
    warnings: unique(warnings),
  };
}

export function queryGoals(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("goal", options, index);
}

export function queryMetrics(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("metric", options, index);
}

export function queryRisks(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("risk", options, index);
}

export function queryBlockers(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("blocker", options, index);
}

export function queryOpenQuestions(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("open_question", options, index);
}

export function queryCapabilities(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("capability", options, index);
}

export function queryFeatures(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("feature", options, index);
}

export function queryArtifacts(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("artifact", options, index);
}

export function queryBenchmarkReports(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("benchmark_report", options, index);
}

export function queryOntologyChangedSince(since: string, options: OntologyQueryOptions = {}): OntologyChangedSinceResult {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const changed = buildOntologyIndexFromRows({
    entityRows: listOntologyEntities({ includeProjects: true, changedSince: since, limit: Math.max(limit, 500) }),
    relationRows: listOntologyRelations({ changedSince: since, limit: 5_000 }),
    evidenceRows: listOntologyEvidence({ changedSince: since, limit: 5_000 }),
  });
  let entities = changed.entities;
  const project = options.project?.trim();
  if (project) {
    entities = entities.filter((entity) => filterByProject([entity], entity.type as CompanyOntologyEntityType, project, changed).length > 0);
  }
  if (options.q?.trim()) entities = entities.filter((entity) => matches(`${entity.name} ${(entity.aliases ?? []).join(" ")}`, options.q ?? ""));
  entities = entities.sort(compareOntologyEntities);
  return { since, count: entities.length, entities: entities.slice(0, limit) };
}

export function queryEvidenceFor(stableKey: string, index = getOntologyIndex()): {
  stableKey: string;
  entity?: OntologyEntityRecord;
  evidence: GraphEvidenceLink[];
  relations: GraphRelationAssertion[];
} {
  const entity = index.entities.find((item) => item.stableKey === stableKey);
  const relations = index.relations.filter((relation) => relation.subjectKey === stableKey || relation.objectKey === stableKey);
  const evidenceIds = unique([...(entity?.evidenceIds ?? []), ...relations.map((relation) => relation.evidenceId)]);
  return {
    stableKey,
    entity,
    evidence: evidenceIds.map((id) => index.evidence.find((item) => item.evidenceId === id)).filter((item): item is GraphEvidenceLink => Boolean(item)),
    relations,
  };
}

export function summarizeOntology(index = getOntologyIndex()): {
  changeSetCount: number;
  counts: Record<CompanyOntologyEntityType, number>;
  topProjects: Array<{ project: string; linkedEntities: number }>;
} {
  const counts = Object.fromEntries([...ontologyTypes].map((type) => [type, 0])) as Record<CompanyOntologyEntityType, number>;
  for (const entity of index.entities) counts[entity.type as CompanyOntologyEntityType] += 1;
  const projects = new Map<string, number>();
  for (const relation of index.relations) {
    if (!relation.subjectKey.startsWith("project:")) continue;
    projects.set(relation.subjectKey, (projects.get(relation.subjectKey) ?? 0) + 1);
  }
  return {
    changeSetCount: index.changeSetCount,
    counts,
    topProjects: [...projects.entries()]
      .map(([project, linkedEntities]) => ({ project, linkedEntities }))
      .sort((a, b) => b.linkedEntities - a.linkedEntities || a.project.localeCompare(b.project))
      .slice(0, 20),
  };
}

function getMaterializedOntologyIndex(limit: number): OntologyIndex {
  return buildOntologyIndexFromRows({
    entityRows: listOntologyEntities({ includeProjects: true, limit: Math.max(limit, 1_000) }),
    relationRows: listOntologyRelations({ limit: Math.max(limit * 20, 10_000) }),
    evidenceRows: listOntologyEvidence({ limit: Math.max(limit * 10, 10_000) }),
  });
}

function getChangeSetOntologyIndex(limit: number): OntologyIndex {
  const changeSets: GraphChangeSet[] = [];
  let offset = 0;
  while (changeSets.length < limit) {
    const records = listGraphChangeSets({ limit: Math.min(200, limit - changeSets.length), offset });
    if (records.length === 0) break;
    for (const record of records) {
      const parsed = parseGraphChangeSet(record.changeSetJson);
      if (parsed) changeSets.push(parsed);
    }
    offset += records.length;
    if (records.length < 200) break;
  }
  return buildOntologyIndex(changeSets);
}

function buildOntologyIndexFromRows(input: {
  entityRows: OntologyEntityRow[];
  relationRows: OntologyRelationRow[];
  evidenceRows: OntologyEvidenceRow[];
}): OntologyIndex {
  const entities = new Map<string, OntologyEntityRecord>();
  const evidence = new Map<string, GraphEvidenceLink>();
  const sourceMeetingIds = new Set<string>();

  for (const row of input.evidenceRows) {
    evidence.set(row.evidenceId, {
      evidenceId: row.evidenceId,
      kind: row.kind as GraphEvidenceLink["kind"],
      source: row.source as GraphEvidenceLink["source"],
      sourceId: row.sourceId,
      meetingId: row.meetingId,
      title: row.title,
      excerpt: row.excerpt,
      url: row.url,
    });
  }

  for (const row of input.entityRows) {
    const sourceMeetings = parseStringArray(row.sourceMeetingIdsJson);
    for (const id of sourceMeetings) sourceMeetingIds.add(id);
    entities.set(row.stableKey, {
      type: row.type,
      stableKey: row.stableKey,
      name: row.name,
      aliases: parseStringArray(row.aliasesJson),
      properties: parseProperties(row.propertiesJson),
      evidenceIds: parseStringArray(row.evidenceIdsJson),
      sourceMeetingIds: sourceMeetings,
      incoming: [],
      outgoing: [],
      evidence: [],
      updatedAt: row.updatedAt,
    });
  }

  const relations = input.relationRows.map((row) => ({
    subjectKey: row.subjectKey,
    relation: row.relation as GraphRelationType,
    objectKey: row.objectKey,
    evidenceId: row.evidenceId,
    validFrom: row.validFrom,
    confidence: row.confidence,
    properties: parseProperties(row.propertiesJson),
  }));
  hydrateOntologyRecords(entities, relations, evidence);

  return {
    generatedAt: new Date().toISOString(),
    changeSetCount: sourceMeetingIds.size,
    entities: [...entities.values()].filter((entity) => ontologyTypes.has(entity.type as CompanyOntologyEntityType)),
    relations,
    evidence: [...evidence.values()],
    warnings: [],
  };
}

function hydrateOntologyRecords(
  entities: Map<string, OntologyEntityRecord>,
  relations: GraphRelationAssertion[],
  evidence: Map<string, GraphEvidenceLink>
): void {
  for (const relation of relations) {
    const subject = entities.get(relation.subjectKey);
    const object = entities.get(relation.objectKey);
    if (subject) subject.outgoing.push(relation);
    if (object) object.incoming.push(relation);
  }

  for (const entity of entities.values()) {
    const evidenceIds = unique([
      ...entity.evidenceIds,
      ...entity.incoming.map((relation) => relation.evidenceId),
      ...entity.outgoing.map((relation) => relation.evidenceId),
    ]);
    entity.evidence = evidenceIds.map((id) => evidence.get(id)).filter((item): item is GraphEvidenceLink => Boolean(item));
  }
}

function queryOntologyType(type: CompanyOntologyEntityType, options: OntologyQueryOptions, index: OntologyIndex): OntologyQueryResult {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  let entities = index.entities.filter((entity) => entity.type === type);
  if (options.project?.trim()) entities = filterByProject(entities, type, options.project, index);
  if (options.q?.trim()) entities = entities.filter((entity) => matches(`${entity.name} ${(entity.aliases ?? []).join(" ")}`, options.q ?? ""));
  entities = entities.sort(compareOntologyEntities);
  return { type, project: options.project?.trim() || undefined, count: entities.length, entities: entities.slice(0, limit) };
}

function filterByProject(
  entities: OntologyEntityRecord[],
  type: CompanyOntologyEntityType,
  project: string,
  index: OntologyIndex
): OntologyEntityRecord[] {
  const projectKey = `project:${normalizeKey(project)}`;
  const directRelations = projectRelationsByType[type] ?? [];
  const directlyLinked = new Set(
    index.relations
      .filter((relation) => relation.subjectKey === projectKey && directRelations.includes(relation.relation))
      .map((relation) => relation.objectKey)
  );
  if (directlyLinked.size > 0) return entities.filter((entity) => directlyLinked.has(entity.stableKey));

  const projectMeetingIds = new Set(
    index.relations
      .filter((relation) => relation.relation === "ROUTED_TO_PROJECT" && relation.objectKey === projectKey)
      .map((relation) => relation.subjectKey)
  );
  return entities.filter((entity) =>
    entity.incoming.some((relation) => projectMeetingIds.has(relation.subjectKey)) ||
    entity.sourceMeetingIds.some((meetingId) => projectMeetingIds.has(`meeting:${meetingId}`))
  );
}

function parseGraphChangeSet(value: string): GraphChangeSet | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isGraphChangeSet(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isGraphChangeSet(value: unknown): value is GraphChangeSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && Array.isArray(record.entities) && Array.isArray(record.relations) && Array.isArray(record.evidence);
}

function compareOntologyEntities(a: OntologyEntityRecord, b: OntologyEntityRecord): number {
  return b.sourceMeetingIds.length - a.sourceMeetingIds.length || b.evidence.length - a.evidence.length || a.name.localeCompare(b.name);
}

function matches(value: string, query: string): boolean {
  return normalizeText(value).includes(normalizeText(query));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 160);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseProperties(value: string): Record<string, string | number | boolean | null> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string | number | boolean | null>)
      : {};
  } catch {
    return {};
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

