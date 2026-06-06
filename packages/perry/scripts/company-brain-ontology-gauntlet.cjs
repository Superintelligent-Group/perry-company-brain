const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const { closeBrainStore, countMeetingRecords, listGraphChangeSets } = require("../dist/store/index.js");
const {
  getOntologyIndex,
  queryBlockers,
  queryCapabilities,
  queryEvidenceFor,
  queryGoals,
  queryOpenQuestions,
  queryRisks,
  summarizeOntology,
} = require("../dist/brain/ontology-queries.js");

const args = parseArgs(process.argv.slice(2));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const project = args.project || "Wallace";

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = "true";
process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = "true";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs-ontology-gauntlet";

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  const result = await processGranolaZapierPayload(payload(project), { force: true });
  const changeSets = listGraphChangeSets({ limit: 50 });
  const index = getOntologyIndex(50);
  const goals = queryGoals({ project }, index);
  const risks = queryRisks({ project }, index);
  const blockers = queryBlockers({ project }, index);
  const questions = queryOpenQuestions({ project }, index);
  const capabilities = queryCapabilities({ project }, index);
  const evidence = goals.entities[0] ? queryEvidenceFor(goals.entities[0].stableKey, index) : undefined;
  const checks = [
    check("processed_meeting", result.record.status === "processed", result.record.id),
    check("persisted_change_set", changeSets.length > 0, String(changeSets.length)),
    check("goal_query", goals.count > 0, goals.entities[0]?.stableKey),
    check("risk_query", risks.count > 0, risks.entities[0]?.stableKey),
    check("blocker_query", blockers.count > 0, blockers.entities[0]?.stableKey),
    check("open_question_query", questions.count > 0, questions.entities[0]?.stableKey),
    check("capability_query", capabilities.count > 0, capabilities.entities[0]?.stableKey),
    check("evidence_query", Boolean(evidence?.evidence.length), evidence?.evidence[0]?.evidenceId),
  ];
  const output = {
    ok: checks.every((item) => item.passed),
    elapsedMs: round(performance.now() - started),
    project,
    dbPath: process.env.PERRY_DB_PATH,
    processedMeetings: countMeetingRecords("processed"),
    graphChangeSets: changeSets.length,
    summary: summarizeOntology(index),
    queries: {
      goals: summarizeResult(goals),
      risks: summarizeResult(risks),
      blockers: summarizeResult(blockers),
      openQuestions: summarizeResult(questions),
      capabilities: summarizeResult(capabilities),
      evidence: evidence && { stableKey: evidence.stableKey, evidenceCount: evidence.evidence.length, relationCount: evidence.relations.length },
    },
    checks,
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (!output.ok) process.exitCode = 2;
}

function payload(project) {
  return {
    note_id: `ontology-gauntlet-${project.toLowerCase()}`,
    title: `${project} Ontology Gauntlet`,
    created_at: "2026-05-25T16:30:00.000Z",
    creator: { name: "Ada", email: "ada@doppel.example" },
    attendees: [{ name: "Ben", email: "ben@doppel.example" }],
    calendar_event: { title: `${project} Planning`, start_time: "2026-05-25T16:30:00.000Z" },
    folder: project,
    summary:
      "Decisions:\n" +
      `- Ada owns ${project} ontology until next review.\n\n` +
      "Action items:\n" +
      `- Ada: Review ${project} ontology query coverage.\n\n` +
      "Goal: reduce search p95 below 20 ms. Metric: p95 search latency 15 ms. " +
      "Risk: Graphiti bridge outage during sync. Blocker: missing Notion permissions. " +
      "Open question: should typed tools answer by default? Capability: typed company brain queries. " +
      "Feature: adaptive search retries. Artifact: reports/db/gemma-5000-fast.sqlite. " +
      "Benchmark report: Gemma 5000 Query Gauntlet.",
    link: "https://granola.example/ontology-gauntlet",
  };
}

function summarizeResult(result) {
  return {
    count: result.count,
    stableKeys: result.entities.map((entity) => entity.stableKey),
    names: result.entities.map((entity) => entity.name),
  };
}

function check(name, passed, detail) {
  return { name, passed, detail };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Company Brain Ontology Gauntlet",
    "",
    `- OK: ${output.ok}`,
    `- Project: ${output.project}`,
    `- Elapsed: ${output.elapsedMs} ms`,
    `- Graph change sets: ${output.graphChangeSets}`,
    "",
    "## Checks",
    "",
    ...output.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.name}: ${item.detail ?? ""}`),
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}