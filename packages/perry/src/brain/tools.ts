import {
  getOntologyIndex,
  queryArtifacts,
  queryBenchmarkReports,
  queryBlockers,
  queryCapabilities,
  queryEvidenceFor,
  queryFeatures,
  queryGoals,
  queryMetrics,
  queryOntologyChangedSince,
  queryOpenQuestions,
  queryRisks,
  summarizeOntology,
  type CompanyOntologyEntityType,
  type OntologyEntityRecord,
  type OntologyIndex,
  type OntologyQueryOptions,
} from "./ontology-queries";
import { companyOntologyEntityTypes, type GraphEvidenceLink, type GraphRelationAssertion } from "@core";

export interface BrainToolProjectStateInput extends OntologyQueryOptions {
  types?: CompanyOntologyEntityType[];
}

export interface BrainToolChangedSinceInput extends OntologyQueryOptions {
  since: string;
}

export interface BrainToolEvidenceInput {
  stableKey: string;
}

export interface BrainToolEntityRef {
  stableKey: string;
  type: CompanyOntologyEntityType;
  name: string;
  aliases: string[];
  sourceMeetingIds: string[];
  evidenceCount: number;
  relationCount: number;
  updatedAt?: string;
}

export interface BrainToolEvidenceRef {
  evidenceId: string;
  title?: string;
  source?: string;
  meetingId?: string;
  excerpt?: string;
  url?: string;
}

export interface BrainToolRelationRef {
  subjectKey: string;
  relation: string;
  objectKey: string;
  evidenceId?: string;
  confidence?: number;
  validFrom?: string;
}

export function getBrainToolProjectState(input: BrainToolProjectStateInput = {}): {
  tool: "company_brain.project_state";
  generatedAt: string;
  input: Required<Pick<BrainToolProjectStateInput, "types" | "limit">> & Pick<BrainToolProjectStateInput, "project" | "q">;
  summary: ReturnType<typeof summarizeOntology>;
  sections: Array<{ type: CompanyOntologyEntityType; count: number; entities: BrainToolEntityRef[] }>;
} {
  const index = getOntologyIndex();
  const types = normalizeTypes(input.types);
  const limit = clampLimit(input.limit ?? 10, 1, 50);
  const options = { project: input.project, q: input.q, limit };
  return {
    tool: "company_brain.project_state",
    generatedAt: index.generatedAt,
    input: { types, limit, project: input.project?.trim() || undefined, q: input.q?.trim() || undefined },
    summary: summarizeOntology(index),
    sections: types.map((type) => {
      const result = runOntologyQuery(type, options, index);
      return { type, count: result.count, entities: result.entities.map(toEntityRef) };
    }),
  };
}

export function getBrainToolChangedSince(input: BrainToolChangedSinceInput): {
  tool: "company_brain.changed_since";
  generatedAt: string;
  input: Required<Pick<BrainToolChangedSinceInput, "since" | "limit">> & Pick<BrainToolChangedSinceInput, "project" | "q">;
  count: number;
  entities: BrainToolEntityRef[];
} {
  const limit = clampLimit(input.limit ?? 50, 1, 200);
  const result = queryOntologyChangedSince(input.since, {
    project: input.project,
    q: input.q,
    limit,
  });
  return {
    tool: "company_brain.changed_since",
    generatedAt: new Date().toISOString(),
    input: { since: result.since, limit, project: input.project?.trim() || undefined, q: input.q?.trim() || undefined },
    count: result.count,
    entities: result.entities.map(toEntityRef),
  };
}

export function getBrainToolEvidence(input: BrainToolEvidenceInput): {
  tool: "company_brain.evidence";
  generatedAt: string;
  input: BrainToolEvidenceInput;
  entity?: BrainToolEntityRef;
  evidence: BrainToolEvidenceRef[];
  relations: BrainToolRelationRef[];
} {
  const index = getOntologyIndex();
  const result = queryEvidenceFor(input.stableKey, index);
  return {
    tool: "company_brain.evidence",
    generatedAt: index.generatedAt,
    input,
    entity: result.entity ? toEntityRef(result.entity) : undefined,
    evidence: result.evidence.map(toEvidenceRef),
    relations: result.relations.map(toRelationRef),
  };
}

function runOntologyQuery(
  type: CompanyOntologyEntityType,
  options: OntologyQueryOptions,
  index: OntologyIndex
): { count: number; entities: OntologyEntityRecord[] } {
  switch (type) {
    case "goal":
      return queryGoals(options, index);
    case "metric":
      return queryMetrics(options, index);
    case "risk":
      return queryRisks(options, index);
    case "blocker":
      return queryBlockers(options, index);
    case "open_question":
      return queryOpenQuestions(options, index);
    case "capability":
      return queryCapabilities(options, index);
    case "feature":
      return queryFeatures(options, index);
    case "artifact":
      return queryArtifacts(options, index);
    case "benchmark_report":
      return queryBenchmarkReports(options, index);
  }
}

function normalizeTypes(types?: CompanyOntologyEntityType[]): CompanyOntologyEntityType[] {
  if (!types?.length) return ["goal", "risk", "blocker", "open_question", "capability"];
  const allowed = new Set(companyOntologyEntityTypes);
  return [...new Set(types.filter((type) => allowed.has(type)))];
}

function toEntityRef(entity: OntologyEntityRecord): BrainToolEntityRef {
  return {
    stableKey: entity.stableKey,
    type: entity.type as CompanyOntologyEntityType,
    name: entity.name,
    aliases: entity.aliases ?? [],
    sourceMeetingIds: entity.sourceMeetingIds,
    evidenceCount: entity.evidence.length,
    relationCount: entity.incoming.length + entity.outgoing.length,
    updatedAt: entity.updatedAt,
  };
}

function toEvidenceRef(evidence: GraphEvidenceLink): BrainToolEvidenceRef {
  return {
    evidenceId: evidence.evidenceId,
    title: evidence.title,
    source: evidence.source,
    meetingId: evidence.meetingId,
    excerpt: evidence.excerpt ? evidence.excerpt.slice(0, 600) : undefined,
    url: evidence.url,
  };
}

function toRelationRef(relation: GraphRelationAssertion): BrainToolRelationRef {
  return {
    subjectKey: relation.subjectKey,
    relation: relation.relation,
    objectKey: relation.objectKey,
    evidenceId: relation.evidenceId,
    confidence: relation.confidence,
    validFrom: relation.validFrom,
  };
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
