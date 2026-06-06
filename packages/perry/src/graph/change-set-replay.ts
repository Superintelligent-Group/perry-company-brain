import { validateGraphChangeSet, type GraphChangeSet, type GraphChangeSetValidation } from "./change-set";
import {
  getGraphEntityContext,
  getGraphEvidence,
  getGraphMemoryStatus,
  postGraphChangeSet,
  type GraphEntityContextResponse,
} from "./memory";
import {
  getGraphChangeSet,
  markGraphChangeSetReplayApplied,
  markGraphChangeSetReplayFailed,
  type GraphChangeSetRecord,
} from "@store";

export interface GraphReplayDiffRelation {
  subjectKey: string;
  relation: string;
  objectKey: string;
  evidenceId?: string;
}

export interface GraphReplayDiff {
  checkedAt: string;
  passed: boolean;
  expected: {
    entities: number;
    relations: number;
    retirements: number;
    evidence: number;
  };
  missing: {
    entities: string[];
    relations: GraphReplayDiffRelation[];
    retirements: GraphReplayDiffRelation[];
    evidence: string[];
  };
  errors: string[];
}

export interface GraphChangeSetReplayResult {
  changeSetId: string;
  meetingId: string;
  groupId: string;
  status: "applied";
  appliedAt?: string;
  validation: GraphChangeSetValidation;
  bridgeResult: unknown;
  diff: GraphReplayDiff;
  record: GraphChangeSetRecord;
}

export class GraphChangeSetReplayError extends Error {
  status: number;
  record?: GraphChangeSetRecord;
  validation?: GraphChangeSetValidation;

  constructor(status: number, message: string, options: { record?: GraphChangeSetRecord; validation?: GraphChangeSetValidation } = {}) {
    super(message);
    this.name = "GraphChangeSetReplayError";
    this.status = status;
    this.record = options.record;
    this.validation = options.validation;
  }
}

export async function replayGraphChangeSet(id: string): Promise<GraphChangeSetReplayResult> {
  const record = getGraphChangeSet(id);
  if (!record) throw new GraphChangeSetReplayError(404, "Graph change set not found.");

  const changeSet = parseStoredChangeSet(record);
  const validation = validateGraphChangeSet(changeSet);
  if (!validation.valid) {
    const updated = markGraphChangeSetReplayFailed(record.id, `Validation failed: ${validation.errors.join("; ")}`) ?? record;
    throw new GraphChangeSetReplayError(400, "Graph change set is invalid and cannot be replayed.", {
      record: updated,
      validation,
    });
  }

  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) {
    throw new GraphChangeSetReplayError(503, "Graph memory is disabled or missing PERRY_GRAPHITI_BRIDGE_URL.", {
      record,
      validation,
    });
  }

  try {
    const bridgeResult = await postGraphChangeSet(changeSet, record.groupId, status);
    const diff = await diffGraphChangeSetReadback(changeSet);
    const updated = markGraphChangeSetReplayApplied(record.id, { bridgeResult, diff }) ?? record;
    return {
      changeSetId: record.id,
      meetingId: record.meetingId,
      groupId: record.groupId,
      status: "applied",
      appliedAt: updated.appliedAt,
      validation,
      bridgeResult,
      diff,
      record: updated,
    };
  } catch (error) {
    const updated = markGraphChangeSetReplayFailed(record.id, error) ?? record;
    throw new GraphChangeSetReplayError(502, error instanceof Error ? error.message : String(error), {
      record: updated,
      validation,
    });
  }
}

export async function diffGraphChangeSetReadback(changeSet: GraphChangeSet): Promise<GraphReplayDiff> {
  const contexts = new Map<string, GraphEntityContextResponse>();
  const errors: string[] = [];
  const missingEntities: string[] = [];
  const missingRelations: GraphReplayDiffRelation[] = [];
  const missingRetirements: GraphReplayDiffRelation[] = [];
  const missingEvidence: string[] = [];

  const contextFor = async (stableKey: string): Promise<GraphEntityContextResponse | undefined> => {
    const cached = contexts.get(stableKey);
    if (cached) return cached;
    const context = await getGraphEntityContext(stableKey, 100);
    contexts.set(stableKey, context);
    if (context.error) errors.push(`${stableKey}: ${context.error}`);
    return context;
  };

  for (const entity of changeSet.entities) {
    const context = await contextFor(entity.stableKey);
    if (!context?.entity?.stableKey) missingEntities.push(entity.stableKey);
  }

  for (const relation of changeSet.relations) {
    const context = await contextFor(relation.subjectKey);
    const found = context?.facts.some((row) => {
      const fact = row.fact;
      return (
        fact?.subjectKey === relation.subjectKey &&
        fact.relation === relation.relation &&
        fact.objectKey === relation.objectKey &&
        (!relation.evidenceId || !fact.evidenceId || fact.evidenceId === relation.evidenceId)
      );
    });
    if (!found) {
      missingRelations.push({
        subjectKey: relation.subjectKey,
        relation: relation.relation,
        objectKey: relation.objectKey,
        evidenceId: relation.evidenceId,
      });
    }
  }

  for (const retirement of changeSet.retirements) {
    const context = await contextFor(retirement.subjectKey);
    const found = context?.retirements.some((row) => {
      const item = row.retirement;
      return (
        item?.subjectKey === retirement.subjectKey &&
        item.relation === retirement.relation &&
        item.objectKey === retirement.objectKey &&
        (!retirement.evidenceId || !item.evidenceId || item.evidenceId === retirement.evidenceId)
      );
    });
    if (!found) {
      missingRetirements.push({
        subjectKey: retirement.subjectKey,
        relation: retirement.relation,
        objectKey: retirement.objectKey,
        evidenceId: retirement.evidenceId,
      });
    }
  }

  for (const evidence of changeSet.evidence) {
    const result = await getGraphEvidence(evidence.evidenceId);
    if (result.error) errors.push(`${evidence.evidenceId}: ${result.error}`);
    if (!result.evidence?.evidenceId) missingEvidence.push(evidence.evidenceId);
  }

  const passed =
    missingEntities.length === 0 &&
    missingRelations.length === 0 &&
    missingRetirements.length === 0 &&
    missingEvidence.length === 0 &&
    errors.length === 0;

  return {
    checkedAt: new Date().toISOString(),
    passed,
    expected: {
      entities: changeSet.entities.length,
      relations: changeSet.relations.length,
      retirements: changeSet.retirements.length,
      evidence: changeSet.evidence.length,
    },
    missing: {
      entities: missingEntities,
      relations: missingRelations,
      retirements: missingRetirements,
      evidence: missingEvidence,
    },
    errors,
  };
}

function parseStoredChangeSet(record: GraphChangeSetRecord): GraphChangeSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.changeSetJson) as unknown;
  } catch (error) {
    markGraphChangeSetReplayFailed(record.id, error);
    throw new GraphChangeSetReplayError(400, "Stored graph change set JSON could not be parsed.", { record });
  }
  if (!isGraphChangeSetLike(parsed)) {
    markGraphChangeSetReplayFailed(record.id, "Stored graph change set JSON has the wrong shape.");
    throw new GraphChangeSetReplayError(400, "Stored graph change set JSON has the wrong shape.", { record });
  }
  return parsed;
}

function isGraphChangeSetLike(value: unknown): value is GraphChangeSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.sourceMeetingId === "string" &&
    typeof record.generatedAt === "string" &&
    Array.isArray(record.entities) &&
    Array.isArray(record.relations) &&
    Array.isArray(record.retirements) &&
    Array.isArray(record.evidence) &&
    Array.isArray(record.warnings)
  );
}
