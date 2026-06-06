// change-set-builders — split out of change-set.ts
import { type GraphEntityUpsert, type GraphRelationAssertion, type GraphRelationRetirement, type GraphRelationType } from "@core";
import { cleanProperties, unique } from "./change-set-helpers";

export function upsertEntity(entities: Map<string, GraphEntityUpsert>, entity: GraphEntityUpsert): void {
  const existing = entities.get(entity.stableKey);
  if (!existing) {
    entities.set(entity.stableKey, { ...entity, aliases: unique(entity.aliases), evidenceIds: unique(entity.evidenceIds) });
    return;
  }
  entities.set(entity.stableKey, {
    ...existing,
    aliases: unique([...(existing.aliases ?? []), ...(entity.aliases ?? [])]),
    properties: cleanProperties({ ...(existing.properties ?? {}), ...(entity.properties ?? {}) }),
    evidenceIds: unique([...existing.evidenceIds, ...entity.evidenceIds]),
  });
}

export function personEntity(stableKey: string, name?: string, email?: string, evidenceId?: string): GraphEntityUpsert {
  return {
    type: "person",
    stableKey,
    name: name ?? email ?? stableKey.replace(/^person:/u, ""),
    aliases: unique([email]),
    properties: cleanProperties({ email }),
    evidenceIds: evidenceId ? [evidenceId] : [],
  };
}

export function assertRelation(
  subjectKey: string,
  relation: GraphRelationType,
  objectKey: string,
  evidenceId: string,
  validFrom: string,
  confidence: number,
  properties?: Record<string, string | number | boolean | null>
): GraphRelationAssertion {
  return {
    subjectKey,
    relation,
    objectKey,
    evidenceId,
    validFrom,
    confidence,
    properties: cleanProperties(properties ?? {}),
  };
}

export function dedupeRelations(relations: GraphRelationAssertion[]): GraphRelationAssertion[] {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const key = [
      relation.subjectKey,
      relation.relation,
      relation.objectKey,
      relation.evidenceId,
      relation.validFrom ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeRetirements(retirements: GraphRelationRetirement[]): GraphRelationRetirement[] {
  const seen = new Set<string>();
  return retirements.filter((retirement) => {
    const key = [
      retirement.subjectKey,
      retirement.relation,
      retirement.objectKey,
      retirement.evidenceId,
      retirement.validUntil,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
