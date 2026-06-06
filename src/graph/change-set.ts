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

const knownProjects = ["Wallace", "Perry", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory"];

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

function upsertEntity(entities: Map<string, GraphEntityUpsert>, entity: GraphEntityUpsert): void {
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

function addMentionedOperatingObjects(
  entities: Map<string, GraphEntityUpsert>,
  relations: GraphRelationAssertion[],
  input: GraphMemorySyncInput,
  meetingKey: string,
  evidenceId: string,
  referenceTime: string,
  projectName?: string
): void {
  const corpus = [
    input.note.title,
    input.note.calendarTitle,
    input.note.folderName,
    input.note.summaryMarkdown,
    ...input.knowledge.decisions.map((decision) => decision.text),
    ...input.knowledge.actionItems.map((action) => action.text),
  ]
    .filter(Boolean)
    .join("\n");

  for (const repository of extractRepositories(corpus)) {
    const key = `repository:${normalizeKey(repository)}`;
    upsertEntity(entities, {
      type: "repository",
      stableKey: key,
      name: repository,
      aliases: unique([repository]),
      properties: cleanProperties({ provider: repository.includes("/") ? "github" : undefined }),
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "MENTIONS_REPOSITORY", key, evidenceId, referenceTime, 0.78));
  }

  for (const customer of extractNamedObjects(corpus, /\b(?:[Cc]ustomer|[Cc]lient|[Aa]ccount)\s+(?<name>[A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*){0,4})/gu)) {
    const key = `customer:${normalizeKey(customer)}`;
    upsertEntity(entities, {
      type: "customer",
      stableKey: key,
      name: customer,
      aliases: unique([customer]),
      properties: {},
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "MENTIONS_CUSTOMER", key, evidenceId, referenceTime, 0.72));
  }

  for (const policy of extractNamedObjects(corpus, /\b(?:[Pp]olicy|SOP|[Rr]unbook)\s+(?<name>[A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*){0,5})/gu)) {
    const key = `policy:${normalizeKey(policy)}`;
    upsertEntity(entities, {
      type: "policy",
      stableKey: key,
      name: policy,
      aliases: unique([policy]),
      properties: {},
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "REFERENCES_POLICY", key, evidenceId, referenceTime, 0.72));
  }

  const projectKey = projectName ? projectStableKey(projectName) : undefined;
  const goals = addTypedMentions(entities, relations, corpus, {
    type: "goal",
    relation: "MENTIONS_GOAL",
    prefix: "goal",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Gg]oal|OKR|[Oo]bjective|[Tt]arget)\s*[:\-]\s*(?<name>[^\n.;]{4,140})/gu,
      /\b(?:goal|objective|target)\s+(?:is|is to|to)\s+(?<name>[^\n.;]{4,140})/giu,
    ],
  });
  const metrics = addTypedMentions(entities, relations, corpus, {
    type: "metric",
    relation: "MENTIONS_METRIC",
    prefix: "metric",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Mm]etric|KPI|SLO)\s*[:\-]\s*(?<name>[^\n.;]{3,120})/gu,
      /\b(?<name>p(?:50|90|95|99)\s+[A-Za-z][^\n.;]{3,100})/gu,
    ],
  });
  const risks = addTypedMentions(entities, relations, corpus, {
    type: "risk",
    relation: "MENTIONS_RISK",
    prefix: "risk",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Rr]isk|[Rr]isk accepted|[Rr]isk identified)\s*[:\-]\s*(?<name>[^\n.;]{4,140})/gu,
    ],
  });
  const blockers = addTypedMentions(entities, relations, corpus, {
    type: "blocker",
    relation: "MENTIONS_BLOCKER",
    prefix: "blocker",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Bb]locker|[Bb]locked by|[Dd]ependency)\s*[:\-]\s*(?<name>[^\n.;]{4,140})/gu,
    ],
  });
  const openQuestions = addTypedMentions(entities, relations, corpus, {
    type: "open_question",
    relation: "MENTIONS_OPEN_QUESTION",
    prefix: "open-question",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Oo]pen question|[Qq]uestion)\s*[:\-]\s*(?<name>[^\n.;?]{4,140}\??)/gu,
    ],
  });
  const capabilities = addTypedMentions(entities, relations, corpus, {
    type: "capability",
    relation: "MENTIONS_CAPABILITY",
    prefix: "capability",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Cc]apability|[Ww]orkflow)\s*[:\-]\s*(?<name>[^\n.;]{4,120})/gu,
    ],
  });
  const features = addTypedMentions(entities, relations, corpus, {
    type: "feature",
    relation: "MENTIONS_FEATURE",
    prefix: "feature",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Ff]eature|[Ii]ntegration)\s*[:\-]\s*(?<name>[^\n.;]{4,120})/gu,
    ],
  });
  const artifacts = addTypedMentions(entities, relations, corpus, {
    type: "artifact",
    relation: "REFERENCES_ARTIFACT",
    prefix: "artifact",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Aa]rtifact|[Dd]ocument|[Dd]oc|[Dd]ashboard|[Cc]onfig|[Pp]rompt)\s*[:\-]\s*(?<name>[^\n.;]{4,160})/gu,
      /\b(?<name>reports\/[A-Za-z0-9_.\-\/]+\.(?:json|md|sqlite|db))/gu,
    ],
  });
  const benchmarkReports = addTypedMentions(entities, relations, corpus, {
    type: "benchmark_report",
    relation: "REFERENCES_BENCHMARK_REPORT",
    prefix: "benchmark-report",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Bb]enchmark report|[Pp]erformance report|[Ee]valuation report)\s*[:\-]\s*(?<name>[^\n.;]{4,160})/gu,
    ],
  });

  if (projectKey) {
    for (const item of goals) relations.push(assertRelation(projectKey, "SUPPORTS_GOAL", item.key, evidenceId, referenceTime, 0.72));
    for (const item of risks) relations.push(assertRelation(projectKey, "HAS_RISK", item.key, evidenceId, referenceTime, 0.72));
    for (const item of blockers) relations.push(assertRelation(projectKey, "BLOCKED_BY", item.key, evidenceId, referenceTime, 0.72));
    for (const item of openQuestions) relations.push(assertRelation(projectKey, "HAS_OPEN_QUESTION", item.key, evidenceId, referenceTime, 0.72));
    for (const item of capabilities) relations.push(assertRelation(projectKey, "IMPLEMENTS_CAPABILITY", item.key, evidenceId, referenceTime, 0.68));
  }
  for (const feature of features) {
    for (const capability of capabilities) relations.push(assertRelation(feature.key, "IMPLEMENTS_CAPABILITY", capability.key, evidenceId, referenceTime, 0.62));
    for (const report of benchmarkReports) relations.push(assertRelation(feature.key, "VALIDATED_BY", report.key, evidenceId, referenceTime, 0.62));
  }
  for (const metric of metrics) {
    for (const report of benchmarkReports) relations.push(assertRelation(metric.key, "VALIDATED_BY", report.key, evidenceId, referenceTime, 0.62));
  }
  for (const artifact of artifacts) {
    for (const report of benchmarkReports) relations.push(assertRelation(artifact.key, "VALIDATED_BY", report.key, evidenceId, referenceTime, 0.62));
  }
}


function addTypedMentions(
  entities: Map<string, GraphEntityUpsert>,
  relations: GraphRelationAssertion[],
  corpus: string,
  options: {
    type: GraphEntityType;
    relation: GraphRelationType;
    prefix: string;
    evidenceId: string;
    meetingKey: string;
    referenceTime: string;
    patterns: RegExp[];
  }
): Array<{ key: string; name: string }> {
  const mentions = extractTypedMentions(corpus, options.patterns);
  const output: Array<{ key: string; name: string }> = [];
  for (const name of mentions) {
    const key = `${options.prefix}:${normalizeKey(name)}`;
    upsertEntity(entities, {
      type: options.type,
      stableKey: key,
      name,
      aliases: unique([name]),
      properties: cleanProperties({ extractedFrom: "meeting_text" }),
      evidenceIds: [options.evidenceId],
    });
    relations.push(assertRelation(options.meetingKey, options.relation, key, options.evidenceId, options.referenceTime, 0.7));
    output.push({ key, name });
  }
  return output;
}

function extractTypedMentions(corpus: string, patterns: RegExp[]): string[] {
  const values = new Set<string>();
  for (const pattern of patterns) {
    for (const match of corpus.matchAll(pattern)) {
      const value = cleanMention(match.groups?.name ?? "");
      if (isSpecificOperatingMention(value)) values.add(value);
    }
  }
  return [...values].slice(0, 12);
}

function isSpecificOperatingMention(value: string): boolean {
  if (value.length < 4) return false;
  if (/^(the|this|that|next|team|review|cleanup|follow up)$/iu.test(value)) return false;
  return /[A-Z0-9]|\d|\/|-|_|#|\b(?:p50|p90|p95|p99|ms|sec|sqlite|json|md|db|api|slo|okr)\b/iu.test(value);
}
function extractRepositories(corpus: string): string[] {
  const repositories = new Set<string>();
  for (const match of corpus.matchAll(/github\.com\/(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)/gu)) {
    if (match.groups?.owner && match.groups.repo) repositories.add(`${match.groups.owner}/${match.groups.repo}`);
  }
  for (const match of corpus.matchAll(/\b(?:[Rr]epo|[Rr]epository)\s+(?<repo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]{3,64})/gu)) {
    const repo = cleanMention(match.groups?.repo ?? "");
    if (isSpecificRepositoryMention(repo)) repositories.add(repo);
  }
  return [...repositories].filter(Boolean).slice(0, 12);
}

function isSpecificRepositoryMention(value: string): boolean {
  return value.includes("/") || /[-_.]/u.test(value) || /^[A-Z][A-Za-z0-9_.-]{2,63}$/u.test(value);
}

function extractNamedObjects(corpus: string, pattern: RegExp): string[] {
  const values = new Set<string>();
  for (const match of corpus.matchAll(pattern)) {
    const value = cleanMention(match.groups?.name ?? "");
    if (value) values.add(value);
  }
  return [...values].slice(0, 12);
}

function cleanMention(value: string): string {
  return value.replace(/[.,;:)\]]+$/u, "").replace(/\s+/gu, " ").trim();
}
function personEntity(stableKey: string, name?: string, email?: string, evidenceId?: string): GraphEntityUpsert {
  return {
    type: "person",
    stableKey,
    name: name ?? email ?? stableKey.replace(/^person:/u, ""),
    aliases: unique([email]),
    properties: cleanProperties({ email }),
    evidenceIds: evidenceId ? [evidenceId] : [],
  };
}

function assertRelation(
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

function dedupeRelations(relations: GraphRelationAssertion[]): GraphRelationAssertion[] {
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

function dedupeRetirements(retirements: GraphRelationRetirement[]): GraphRelationRetirement[] {
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

function inferProject(input: GraphMemorySyncInput): string | undefined {
  return (
    input.route?.project ??
    inferProjectFromText(input.note.folderName) ??
    inferProjectFromText(input.note.title) ??
    inferProjectFromText(
      [
        ...input.knowledge.decisions.map((item) => item.text),
        ...input.knowledge.actionItems.map((item) => item.text),
      ].join("\n")
    )
  );
}

function inferProjectFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return knownProjects.find((project) => text.toLowerCase().includes(project.toLowerCase()));
}

function projectStableKey(project: string): string {
  return `project:${normalizeKey(project)}`;
}

function personKey(name?: string, email?: string): string {
  return `person:${normalizeKey(email ?? name ?? "unknown")}`;
}

function normalizeKey(value: string | undefined): string {
  return (value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 160);
}

function compactExcerpt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const compact = value
    .replace(/\bprivate notes?\s*:.*$/gimu, "")
    .replace(/\btranscript\s*:.*$/gimu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return compact.length > 500 ? `${compact.slice(0, 497).trimEnd()}...` : compact;
}

function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function cleanProperties(
  properties: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function unique(items: Array<string | undefined> | undefined): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items ?? []) {
    const normalized = item?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}






