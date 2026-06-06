import type { GraphChangeSet, GraphChangeSetValidation } from "@core";

export function validateGraphChangeSet(changeSet: GraphChangeSet): GraphChangeSetValidation {
  const errors: string[] = [];
  const warnings = [...changeSet.warnings];
  const entityKeys = new Set(changeSet.entities.map((entity) => entity.stableKey));
  const evidenceIds = new Set(changeSet.evidence.map((item) => item.evidenceId));

  for (const entity of changeSet.entities) {
    if (!entity.stableKey) errors.push(`Entity is missing stableKey: ${entity.name}`);
    if (!entity.name) errors.push(`Entity is missing name: ${entity.stableKey}`);
    for (const evidenceId of entity.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) errors.push(`Entity ${entity.stableKey} references missing evidence ${evidenceId}`);
    }
  }

  for (const relation of changeSet.relations) {
    if (!entityKeys.has(relation.subjectKey)) errors.push(`Relation subject missing: ${relation.subjectKey}`);
    if (!entityKeys.has(relation.objectKey)) errors.push(`Relation object missing: ${relation.objectKey}`);
    if (!evidenceIds.has(relation.evidenceId)) errors.push(`Relation evidence missing: ${relation.evidenceId}`);
    if (relation.confidence <= 0 || relation.confidence > 1) {
      errors.push(`Relation confidence out of range: ${relation.subjectKey} ${relation.relation}`);
    }
  }

  for (const retirement of changeSet.retirements) {
    if (!entityKeys.has(retirement.subjectKey)) errors.push(`Retirement subject missing: ${retirement.subjectKey}`);
    if (!entityKeys.has(retirement.objectKey)) errors.push(`Retirement object missing: ${retirement.objectKey}`);
    if (!evidenceIds.has(retirement.evidenceId)) errors.push(`Retirement evidence missing: ${retirement.evidenceId}`);
  }

  const unsafeEvidence = changeSet.evidence.filter((item) => /\b(private notes?|transcript)\b/iu.test(item.excerpt ?? ""));
  if (unsafeEvidence.length > 0) {
    errors.push(`Graph evidence contains private/transcript marker: ${unsafeEvidence.map((item) => item.evidenceId).join(", ")}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
