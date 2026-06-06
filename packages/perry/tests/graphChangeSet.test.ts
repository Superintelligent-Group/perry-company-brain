import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphChangeSet, validateGraphChangeSet } from "@graph";
import { buildGraphitiMeetingEpisode, type GraphMemorySyncInput } from "@graph";

test("builds a typed graph change set with bounded evidence instead of raw transcript context", () => {
  const changeSet = buildGraphChangeSet(sampleInput());
  const validation = validateGraphChangeSet(changeSet);

  assert.equal(validation.valid, true);
  assert.equal(changeSet.sourceMeetingId, "granola:graph-object-1");
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "project:wallace"), true);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "person:ada-doppel-example"), true);
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "meeting:granola:graph-object-1" &&
        relation.relation === "ROUTED_TO_PROJECT" &&
        relation.objectKey === "project:wallace"
    ),
    true
  );

  const serializedEvidence = JSON.stringify(changeSet.evidence);
  assert.equal(serializedEvidence.includes("Operator-only private context"), false);
  assert.equal(serializedEvidence.includes("Full transcript should stay outside graph ops"), false);
});

test("represents ownership pivots as explicit relation assertions and retirements", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      decisions: [{ text: "Ada now owns Wallace onboarding; Ben is the fallback reviewer." }],
      actionItems: [],
    })
  );
  const validation = validateGraphChangeSet(changeSet);

  assert.equal(validation.valid, true);
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "project:wallace" &&
        relation.relation === "ASSIGNED_OWNER" &&
        relation.objectKey === "person:ada"
    ),
    true
  );
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "project:wallace" &&
        relation.relation === "HAS_FALLBACK_REVIEWER" &&
        relation.objectKey === "person:ben"
    ),
    true
  );
  assert.equal(
    changeSet.retirements.some(
      (retirement) =>
        retirement.subjectKey === "project:wallace" &&
        retirement.relation === "ASSIGNED_OWNER" &&
        retirement.objectKey === "person:ben"
    ),
    true
  );
});

test("deduplicates entities while preserving multiple evidence-backed relations", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      creatorName: "Ada",
      creatorEmail: "ada@doppel.example",
      attendees: [{ name: "Ada", email: "ada@doppel.example" }],
      decisions: [{ text: "Ada owns Wallace onboarding until next planning review." }],
      actionItems: [{ owner: "Ada", text: "Ship Wallace checklist." }],
    })
  );
  const adaEntities = changeSet.entities.filter((entity) => entity.stableKey === "person:ada-doppel-example");

  assert.equal(adaEntities.length, 1);
  assert.equal(
    changeSet.relations.filter((relation) => relation.objectKey === "person:ada-doppel-example").length >= 2,
    true
  );
  assert.equal(validateGraphChangeSet(changeSet).valid, true);
});

test("extracts operating ontology entities from routes and meeting text", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown:
        "Customer Acme. Repository doppel-labs/wallace-webapp should follow policy SOC2 Evidence Retention.",
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "repository" && entity.stableKey === "repository:doppel-labs-wallace-webapp"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "customer" && entity.stableKey === "customer:acme"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "policy" && entity.stableKey === "policy:soc2-evidence-retention"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "channel" && entity.stableKey === "channel:discord:wallace-channel"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "data_source" && entity.stableKey === "data_source:notion:wallace-data-source"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "MENTIONS_REPOSITORY"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "ROUTED_TO_CHANNEL"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "WRITES_TO_DATA_SOURCE"), true);
});
test("extracts richer company-state ontology from operating language", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown:
        "Goal: reduce search p95 below 20 ms. Metric: p95 search latency 15 ms. " +
        "Risk: Graphiti bridge outage during sync. Blocker: missing Notion permissions. " +
        "Open question: should typed tools answer by default? Capability: typed company brain queries. " +
        "Feature: adaptive search retries. Artifact: reports/db/gemma-5000-fast.sqlite. " +
        "Benchmark report: Gemma 5000 Query Gauntlet.",
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "goal" && entity.stableKey === "goal:reduce-search-p95-below-20-ms"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "metric" && entity.stableKey === "metric:p95-search-latency-15-ms"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "risk" && entity.stableKey === "risk:graphiti-bridge-outage-during-sync"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "blocker" && entity.stableKey === "blocker:missing-notion-permissions"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "open_question" && entity.stableKey === "open-question:should-typed-tools-answer-by-default"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "capability" && entity.stableKey === "capability:typed-company-brain-queries"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "feature" && entity.stableKey === "feature:adaptive-search-retries"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "artifact" && entity.stableKey === "artifact:reports-db-gemma-5000-fast-sqlite"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "benchmark_report" && entity.stableKey === "benchmark-report:gemma-5000-query-gauntlet"), true);
  assert.equal(changeSet.relations.some((relation) => relation.subjectKey === "project:wallace" && relation.relation === "SUPPORTS_GOAL"), true);
  assert.equal(changeSet.relations.some((relation) => relation.subjectKey === "project:wallace" && relation.relation === "BLOCKED_BY"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "VALIDATED_BY"), true);
});
test("avoids turning generic lowercase operating phrases into graph entities", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown:
        "The customer support process reviewed repository hygiene and policy cleanup as generic team vocabulary.",
      decisions: [],
      actionItems: [],
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "customer:support"), false);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "repository:hygiene"), false);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "policy:cleanup"), false);
});
test("Graphiti meeting episodes carry graph operations and validation metadata", () => {
  const previousPrivate = process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  const previousTranscript = process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
  delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;

  try {
    const episode = buildGraphitiMeetingEpisode(sampleInput(), "doppel-test");
    const body = JSON.parse(episode.body) as {
      graphChangeSet?: { entities: unknown[]; relations: unknown[]; evidence: unknown[] };
      graphValidation?: { valid: boolean; errors: string[] };
      privateNotes?: string;
      transcript?: string;
    };

    assert.equal(body.graphValidation?.valid, true);
    assert.equal(body.graphValidation?.errors.length, 0);
    assert.equal(Array.isArray(body.graphChangeSet?.entities), true);
    assert.equal(Array.isArray(body.graphChangeSet?.relations), true);
    assert.equal(Array.isArray(body.graphChangeSet?.evidence), true);
    assert.equal(body.privateNotes, undefined);
    assert.equal(body.transcript, undefined);
  } finally {
    if (previousPrivate === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
    else process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = previousPrivate;
    if (previousTranscript === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
    else process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = previousTranscript;
  }
});

function sampleInput(overrides: Partial<GraphMemorySyncInput["note"] & GraphMemorySyncInput["knowledge"]> = {}): GraphMemorySyncInput {
  const noteOverrides = overrides as Partial<GraphMemorySyncInput["note"]>;
  const knowledgeOverrides = overrides as Partial<GraphMemorySyncInput["knowledge"]>;
  return {
    note: {
      source: "granola",
      sourceId: "graph-object-1",
      title: "Wallace Graph Object Review",
      creatorName: noteOverrides.creatorName ?? "Ada",
      creatorEmail: noteOverrides.creatorEmail ?? "ada@doppel.example",
      attendees: noteOverrides.attendees ?? [
        { name: "Ben", email: "ben@doppel.example" },
        { name: "Ada", email: "ada@doppel.example" },
      ],
      calendarTitle: "Wallace planning",
      folderName: "Wallace",
      startedAt: "2026-05-23T15:00:00.000Z",
      summaryMarkdown:
        "Decisions:\n- Ada now owns Wallace onboarding; Ben is the fallback reviewer.\n\nAction items:\n- Ada: Ship Wallace checklist.",
      privateNotes: "Operator-only private context",
      transcript: "Full transcript should stay outside graph ops.",
      sourceUrl: "https://granola.example/graph-object-1",
      ...noteOverrides,
    },
    record: {
      id: "granola:graph-object-1",
      source: "granola",
      sourceId: "graph-object-1",
      title: "Wallace Graph Object Review",
      createdAt: "2026-05-23T15:00:00.000Z",
      updatedAt: "2026-05-23T15:01:00.000Z",
      notionUrl: "https://notion.example/wallace-graph-object-review",
      discordMessageUrl: "https://discord.example/channels/1/2/3",
      status: "processed",
    },
    knowledge: {
      decisions: knowledgeOverrides.decisions ?? [
        { text: "Ada now owns Wallace onboarding; Ben is the fallback reviewer." },
      ],
      actionItems: knowledgeOverrides.actionItems ?? [{ owner: "Ada", text: "Ship Wallace checklist." }],
    },
    route: {
      project: "Wallace",
      publishMode: "approval",
      reason: "Matched Wallace routing",
      discordChannelId: "wallace-channel",
      notionDataSourceId: "wallace-data-source",
    },
  };
}



