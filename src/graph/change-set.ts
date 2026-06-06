import { parseOwnershipDecision } from "@brain";
export type {
  GraphChangeSet,
  GraphChangeSetValidation,
  GraphEntityType,
  GraphEntityUpsert,
  GraphEvidenceLink,
  GraphRelationAssertion,
  GraphRelationRetirement,
  GraphRelationType,
} from "@core";
import type {
  GraphChangeSet,
  GraphEntityType,
  GraphEntityUpsert,
  GraphEvidenceLink,
  GraphRelationAssertion,
  GraphRelationRetirement,
  GraphRelationType,
} from "@core";
export { validateGraphChangeSet } from "./change-set-validation";
import type { GraphMemorySyncInput } from "./memory";

import { assertRelation, dedupeRelations, dedupeRetirements, personEntity, upsertEntity } from "./change-set-builders";
import { cleanProperties, compactExcerpt, inferProject, inferProjectFromText, normalizeKey, personKey, projectStableKey, unique, validIso } from "./change-set-helpers";
import { addMentionedOperatingObjects } from "./change-set-mentions";

export function buildGraphChangeSet(input: GraphMemorySyncInput): GraphChangeSet {
  const generatedAt = new Date().toISOString();
  const referenceTime = validIso(input.note.startedAt) ?? input.record.updatedAt ?? generatedAt;
  const sourceMeetingId = input.record.id;
  const entities = new Map<string, GraphEntityUpsert>();
  const relations: GraphRelationAssertion[] = [];
  const retirements: GraphRelationRetirement[] = [];
  const evidence: GraphEvidenceLink[] = [];
  const warnings: string[] = [];

  const meetingKey = `meeting:${sourceMeetingId}`;
  const meetingEvidenceId = `evidence:meeting:${sourceMeetingId}`;
  evidence.push({
    evidenceId: meetingEvidenceId,
    kind: "meeting",
    source: "granola",
    sourceId: input.note.sourceId ?? sourceMeetingId,
    meetingId: sourceMeetingId,
    title: input.note.title,
    excerpt: compactExcerpt(input.note.summaryMarkdown),
    url: input.note.sourceUrl,
  });
  upsertEntity(entities, {
    type: "meeting",
    stableKey: meetingKey,
    name: input.note.title,
    aliases: unique([input.note.calendarTitle, input.note.sourceId]),
    properties: cleanProperties({
      source: input.note.source,
      sourceId: input.note.sourceId,
      folderName: input.note.folderName,
      startedAt: validIso(input.note.startedAt),
      status: input.record.status,
    }),
    evidenceIds: [meetingEvidenceId],
  });

  if (input.note.sourceUrl) {
    const sourceKey = `source_note:${normalizeKey(input.note.sourceUrl)}`;
    const sourceEvidenceId = `evidence:source:${sourceMeetingId}`;
    evidence.push({
      evidenceId: sourceEvidenceId,
      kind: "source_link",
      source: "granola",
      sourceId: input.note.sourceId ?? sourceMeetingId,
      meetingId: sourceMeetingId,
      title: "Granola source note",
      url: input.note.sourceUrl,
    });
    upsertEntity(entities, {
      type: "source_note",
      stableKey: sourceKey,
      name: "Granola source note",
      properties: cleanProperties({ url: input.note.sourceUrl }),
      evidenceIds: [sourceEvidenceId],
    });
    relations.push(assertRelation(meetingKey, "DERIVED_FROM", sourceKey, sourceEvidenceId, referenceTime, 1));
  }

  if (input.note.creatorName || input.note.creatorEmail) {
    const creatorKey = personKey(input.note.creatorName, input.note.creatorEmail);
    upsertEntity(entities, personEntity(creatorKey, input.note.creatorName, input.note.creatorEmail, meetingEvidenceId));
    relations.push(assertRelation(meetingKey, "CAPTURED_BY", creatorKey, meetingEvidenceId, referenceTime, 0.95));
  }

  for (const attendee of input.note.attendees) {
    if (!attendee.name && !attendee.email) continue;
    const attendeeKey = personKey(attendee.name, attendee.email);
    upsertEntity(entities, personEntity(attendeeKey, attendee.name, attendee.email, meetingEvidenceId));
    relations.push(assertRelation(meetingKey, "ATTENDED_BY", attendeeKey, meetingEvidenceId, referenceTime, 0.9));
  }

  const projectName = inferProject(input);
  if (projectName) {
    const projectKey = projectStableKey(projectName);
    upsertEntity(entities, {
      type: "project",
      stableKey: projectKey,
      name: projectName,
      aliases: unique([input.route?.project, input.note.folderName, input.note.calendarTitle]),
      properties: cleanProperties({
        routeRuleId: input.route?.ruleId,
        routeRuleName: input.route?.ruleName,
      }),
      evidenceIds: [meetingEvidenceId],
    });
    relations.push(assertRelation(meetingKey, "ROUTED_TO_PROJECT", projectKey, meetingEvidenceId, referenceTime, 0.85));
  }

  if (input.route?.discordChannelId) {
    const channelKey = `channel:discord:${normalizeKey(input.route.discordChannelId)}`;
    upsertEntity(entities, {
      type: "channel",
      stableKey: channelKey,
      name: input.route.discordChannelId,
      properties: cleanProperties({ platform: "discord", channelId: input.route.discordChannelId, routeRuleId: input.route.ruleId }),
      evidenceIds: [meetingEvidenceId],
    });
    relations.push(assertRelation(meetingKey, "ROUTED_TO_CHANNEL", channelKey, meetingEvidenceId, referenceTime, 0.9));
  }

  if (input.route?.notionDataSourceId) {
    const dataSourceKey = `data_source:notion:${normalizeKey(input.route.notionDataSourceId)}`;
    upsertEntity(entities, {
      type: "data_source",
      stableKey: dataSourceKey,
      name: input.route.notionDataSourceId,
      properties: cleanProperties({ platform: "notion", dataSourceId: input.route.notionDataSourceId, routeRuleId: input.route.ruleId }),
      evidenceIds: [meetingEvidenceId],
    });
    relations.push(assertRelation(meetingKey, "WRITES_TO_DATA_SOURCE", dataSourceKey, meetingEvidenceId, referenceTime, 0.9));
  }

  addMentionedOperatingObjects(entities, relations, input, meetingKey, meetingEvidenceId, referenceTime, projectName);

  input.knowledge.decisions.forEach((decision, index) => {
    const evidenceId = `evidence:decision:${sourceMeetingId}:${index + 1}`;
    const decisionKey = `decision:${sourceMeetingId}:${index + 1}`;
    evidence.push({
      evidenceId,
      kind: "decision",
      source: "perry",
      sourceId: decisionKey,
      meetingId: sourceMeetingId,
      title: `Decision ${index + 1}`,
      excerpt: decision.text,
    });
    upsertEntity(entities, {
      type: "decision",
      stableKey: decisionKey,
      name: decision.text,
      properties: cleanProperties({ text: decision.text }),
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "HAS_DECISION", decisionKey, evidenceId, referenceTime, 1));

    const ownership = parseOwnershipDecision({
      id: decisionKey,
      meetingId: sourceMeetingId,
      text: decision.text,
      status: "accepted",
      createdAt: referenceTime,
    });
    if (!ownership) return;

    const subjectProjectName = inferProjectFromText(ownership.subject) ?? projectName;
    if (!subjectProjectName) {
      warnings.push(`Ownership decision had no resolvable project: ${decision.text}`);
      return;
    }
    const ownerKey = personKey(ownership.owner);
    const subjectKey = projectStableKey(subjectProjectName);
    upsertEntity(entities, {
      type: "project",
      stableKey: subjectKey,
      name: subjectProjectName,
      aliases: unique([ownership.subject]),
      properties: cleanProperties({ ownershipSubject: ownership.subject }),
      evidenceIds: [evidenceId],
    });
    upsertEntity(entities, personEntity(ownerKey, ownership.owner, undefined, evidenceId));
    relations.push(
      assertRelation(subjectKey, "ASSIGNED_OWNER", ownerKey, evidenceId, referenceTime, 0.95, {
        subject: ownership.subject,
        decisionText: decision.text,
      })
    );

    if (ownership.previousOwner && ownership.previousOwner !== ownership.owner) {
      const previousOwnerKey = personKey(ownership.previousOwner);
      upsertEntity(entities, personEntity(previousOwnerKey, ownership.previousOwner, undefined, evidenceId));
      retirements.push({
        subjectKey,
        relation: "ASSIGNED_OWNER",
        objectKey: previousOwnerKey,
        evidenceId,
        validUntil: referenceTime,
        reason: decision.text,
      });
    }

    if (ownership.fallbackReviewer) {
      const fallbackKey = personKey(ownership.fallbackReviewer);
      upsertEntity(entities, personEntity(fallbackKey, ownership.fallbackReviewer, undefined, evidenceId));
      relations.push(assertRelation(subjectKey, "HAS_FALLBACK_REVIEWER", fallbackKey, evidenceId, referenceTime, 0.9));
    }
  });

  input.knowledge.actionItems.forEach((action, index) => {
    const evidenceId = `evidence:action:${sourceMeetingId}:${index + 1}`;
    const actionKey = `action_item:${sourceMeetingId}:${index + 1}`;
    evidence.push({
      evidenceId,
      kind: "action_item",
      source: "perry",
      sourceId: actionKey,
      meetingId: sourceMeetingId,
      title: `Action item ${index + 1}`,
      excerpt: action.text,
    });
    upsertEntity(entities, {
      type: "action_item",
      stableKey: actionKey,
      name: action.text,
      properties: cleanProperties({ text: action.text, dueDate: action.dueDate }),
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "HAS_ACTION_ITEM", actionKey, evidenceId, referenceTime, 1));
    if (!action.owner) return;
    const ownerKey = personKey(action.owner);
    upsertEntity(entities, personEntity(ownerKey, action.owner, undefined, evidenceId));
    relations.push(assertRelation(actionKey, "ASSIGNED_TO", ownerKey, evidenceId, referenceTime, 0.95));
  });

  if (input.notionUrl ?? input.record.notionUrl) {
    const url = input.notionUrl ?? input.record.notionUrl;
    const evidenceId = `evidence:notion:${sourceMeetingId}`;
    const notionKey = `notion_page:${normalizeKey(url)}`;
    evidence.push({
      evidenceId,
      kind: "source_link",
      source: "notion",
      sourceId: notionKey,
      meetingId: sourceMeetingId,
      title: "Notion meeting page",
      url,
    });
    upsertEntity(entities, {
      type: "notion_page",
      stableKey: notionKey,
      name: input.note.title,
      properties: cleanProperties({ url }),
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "DOCUMENTED_IN", notionKey, evidenceId, referenceTime, 1));
  }

  if (input.discordMessageUrl ?? input.record.discordMessageUrl) {
    const url = input.discordMessageUrl ?? input.record.discordMessageUrl;
    const evidenceId = `evidence:discord:${sourceMeetingId}`;
    const discordKey = `discord_message:${normalizeKey(url)}`;
    evidence.push({
      evidenceId,
      kind: "source_link",
      source: "discord",
      sourceId: discordKey,
      meetingId: sourceMeetingId,
      title: "Discord meeting announcement",
      url,
    });
    upsertEntity(entities, {
      type: "discord_message",
      stableKey: discordKey,
      name: input.note.title,
      properties: cleanProperties({ url }),
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "POSTED_TO", discordKey, evidenceId, referenceTime, 1));
  }

  return {
    schemaVersion: 1,
    sourceMeetingId,
    generatedAt,
    entities: [...entities.values()],
    relations: dedupeRelations(relations),
    retirements: dedupeRetirements(retirements),
    evidence,
    warnings,
  };
}
