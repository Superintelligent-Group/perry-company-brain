import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildGraphChangeSet } from "@graph";
import type { GraphMemorySyncInput } from "@graph";
import { enqueueMeetingGraphSync } from "@graph";
import { closeBrainStore, listOntologyEntities, listOntologyRelations, rebuildOntologyMaterializedIndex } from "@store";
import {
  buildOntologyIndex,
  queryBlockers,
  queryCapabilities,
  queryEvidenceFor,
  queryGoals,
  queryOpenQuestions,
  queryRisks,
  summarizeOntology,
} from "@brain";

test("company brain ontology queries expose project-scoped state with evidence", () => {
  const wallace = buildGraphChangeSet(
    sampleInput({
      project: "Wallace",
      summaryMarkdown:
        "Goal: reduce search p95 below 20 ms. Metric: p95 search latency 15 ms. " +
        "Risk: Graphiti bridge outage during sync. Blocker: missing Notion permissions. " +
        "Open question: should typed tools answer by default? Capability: typed company brain queries. " +
        "Feature: adaptive search retries. Artifact: reports/db/gemma-5000-fast.sqlite. " +
        "Benchmark report: Gemma 5000 Query Gauntlet.",
    })
  );
  const atlas = buildGraphChangeSet(
    sampleInput({
      id: "granola:atlas-ontology-1",
      sourceId: "atlas-ontology-1",
      project: "Atlas",
      summaryMarkdown: "Goal: improve Atlas retrieval freshness. Risk: stale account context.",
    })
  );
  const index = buildOntologyIndex([wallace, atlas]);

  assert.equal(summarizeOntology(index).counts.goal, 2);

  const goals = queryGoals({ project: "Wallace" }, index);
  assert.equal(goals.count, 1);
  assert.equal(goals.entities[0].stableKey, "goal:reduce-search-p95-below-20-ms");

  const risks = queryRisks({ project: "Wallace" }, index);
  assert.equal(risks.count, 1);
  assert.equal(risks.entities[0].stableKey, "risk:graphiti-bridge-outage-during-sync");

  const blockers = queryBlockers({ project: "Wallace" }, index);
  assert.equal(blockers.count, 1);
  assert.equal(blockers.entities[0].stableKey, "blocker:missing-notion-permissions");

  const questions = queryOpenQuestions({ project: "Wallace" }, index);
  assert.equal(questions.count, 1);
  assert.equal(questions.entities[0].stableKey, "open-question:should-typed-tools-answer-by-default");

  const capabilities = queryCapabilities({ project: "Wallace" }, index);
  assert.equal(capabilities.count, 1);
  assert.equal(capabilities.entities[0].stableKey, "capability:typed-company-brain-queries");

  const evidence = queryEvidenceFor("goal:reduce-search-p95-below-20-ms", index);
  assert.equal(evidence.entity?.name, "reduce search p95 below 20 ms");
  assert(evidence.evidence.some((item) => item.kind === "meeting" && item.excerpt?.includes("Goal:")));
});

function sampleInput(options: { id?: string; sourceId?: string; project: string; summaryMarkdown: string }): GraphMemorySyncInput {
  const sourceId = options.sourceId ?? "wallace-ontology-1";
  const id = options.id ?? `granola:${sourceId}`;
  return {
    note: {
      source: "granola",
      sourceId,
      title: `${options.project} Ontology Review`,
      creatorName: "Ada",
      creatorEmail: "ada@doppel.example",
      attendees: [{ name: "Ben", email: "ben@doppel.example" }],
      calendarTitle: `${options.project} planning`,
      folderName: options.project,
      startedAt: "2026-05-25T10:00:00.000Z",
      summaryMarkdown: options.summaryMarkdown,
      sourceUrl: `https://granola.example/${sourceId}`,
    },
    record: {
      id,
      source: "granola",
      sourceId,
      title: `${options.project} Ontology Review`,
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:01:00.000Z",
      status: "processed",
    },
    knowledge: {
      decisions: [{ text: `Ada owns ${options.project} ontology until next review.` }],
      actionItems: [{ owner: "Ada", text: `Review ${options.project} ontology query coverage.` }],
    },
    route: {
      project: options.project,
      publishMode: "auto",
      reason: `Matched ${options.project}`,
      discordChannelId: `${options.project.toLowerCase()}-channel`,
      notionDataSourceId: `${options.project.toLowerCase()}-data-source`,
    },
  };
}
test("company brain ontology materializes graph change sets into indexed rows", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ontology-materialized-"));
  const previousPath = process.env.PERRY_DB_PATH;
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousGroup = process.env.PERRY_GRAPHITI_GROUP_ID;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_GRAPHITI_ENABLED = "true";
  process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-ontology-test";
  process.env.PERRY_GRAPHITI_BRIDGE_URL = "http://127.0.0.1:1";

  try {
    const job = enqueueMeetingGraphSync(
      sampleInput({
        project: "Wallace",
        summaryMarkdown: "Goal: reduce ontology query p95 below 5 ms. Risk: stale materialized ontology rows.",
      })
    );
    assert(job);
    assert.equal(listOntologyEntities({ type: "goal", limit: 10 }).length, 1);
    assert.equal(listOntologyRelations({ relation: "SUPPORTS_GOAL", limit: 10 }).length, 1);

    const goals = queryGoals({ project: "Wallace" });
    assert.equal(goals.count, 1);
    assert.equal(goals.entities[0].stableKey, "goal:reduce-ontology-query-p95-below-5-ms");

    const backfill = rebuildOntologyMaterializedIndex({ reset: true });
    assert.equal(backfill.changeSets, 1);
    assert(backfill.entities >= 2);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) delete process.env.PERRY_DB_PATH;
    else process.env.PERRY_DB_PATH = previousPath;
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousGroup === undefined) delete process.env.PERRY_GRAPHITI_GROUP_ID;
    else process.env.PERRY_GRAPHITI_GROUP_ID = previousGroup;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

