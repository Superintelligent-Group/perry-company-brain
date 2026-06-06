const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { performance } = require("node:perf_hooks");

const args = parseArgs(process.argv.slice(2));
const count = Number(args.count ?? process.env.PERRY_ONTOLOGY_PERF_COUNT ?? 1000);
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const budgets = readBudgets(args);

process.env.PERRY_DB_PATH = args.db || process.env.PERRY_DB_PATH || ":memory:";
process.env.PERRY_GRAPHITI_ENABLED = "true";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:1";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-ontology-perf";
process.env.PERRY_AUDIT_MODE ||= "off";

const { enqueueMeetingGraphSync } = require("../dist/graph/queue.js");
const {
  closeBrainStore,
  listGraphChangeSets,
  listOntologyEntities,
  listOntologyRelations,
  withAuditSuppressed,
} = require("../dist/store/index.js");
const {
  buildOntologyIndex,
  getOntologyIndex,
  queryBlockers,
  queryEvidenceFor,
  queryGoals,
  queryRisks,
  summarizeOntology,
} = require("../dist/brain/ontology-queries.js");

const steps = [];
let materializedIndex;
let legacyIndex;
let materializedGoals;
let legacyGoals;

timed("enqueue change sets + materialize ontology", () => {
  withAuditSuppressed(() => {
    for (let index = 0; index < count; index += 1) enqueueMeetingGraphSync(sampleInput(index));
  });
}, count);

timed("materialized list entities", () => listOntologyEntities({ limit: 1000 }), 1000);
timed("materialized list relations", () => listOntologyRelations({ limit: 5000 }), 5000);
timed("materialized build index", () => {
  materializedIndex = getOntologyIndex(count);
}, count);
timed("materialized summarize", () => summarizeOntology(materializedIndex), count);
timed("materialized project goals", () => {
  materializedGoals = queryGoals({ project: "Wallace", limit: 25 }, materializedIndex);
}, 25);
timed("materialized project risks", () => queryRisks({ project: "Wallace", limit: 25 }, materializedIndex), 25);
timed("materialized project blockers", () => queryBlockers({ project: "Wallace", limit: 25 }, materializedIndex), 25);
timed("materialized evidence lookup", () => {
  const stableKey = materializedGoals?.entities?.[0]?.stableKey;
  if (stableKey) queryEvidenceFor(stableKey, materializedIndex);
}, 1);

timed("legacy load + parse change-set JSON", () => {
  const changeSets = listGraphChangeSets({ limit: count }).map((record) => JSON.parse(record.changeSetJson));
  legacyIndex = buildOntologyIndex(changeSets);
}, count);
timed("legacy summarize", () => summarizeOntology(legacyIndex), count);
timed("legacy project goals", () => {
  legacyGoals = queryGoals({ project: "Wallace", limit: 25 }, legacyIndex);
}, 25);
timed("legacy evidence lookup", () => {
  const stableKey = legacyGoals?.entities?.[0]?.stableKey;
  if (stableKey) queryEvidenceFor(stableKey, legacyIndex);
}, 1);

const budgetFailures = evaluateBudgets(steps, budgets);
const output = {
  ok: budgetFailures.length === 0,
  dbPath: process.env.PERRY_DB_PATH,
  records: count,
  summary: summarizeOntology(materializedIndex),
  budgets,
  budgetFailures,
  steps: steps.map((step) => ({
    ...step,
    ms: round(step.ms),
    budgetMs: budgets[step.name],
    opsPerSec: step.ops ? round(step.ops / (step.ms / 1000)) : undefined,
  })),
};

console.log(JSON.stringify(output, null, 2));
if (reportPath) writeJson(reportPath, output);
if (markdownPath) writeMarkdown(markdownPath, output);
closeBrainStore(process.env.PERRY_DB_PATH);
if (budgetFailures.length > 0) process.exitCode = 1;

function timed(name, fn, ops) {
  const start = performance.now();
  const result = fn();
  steps.push({ name, ms: performance.now() - start, ops });
  return result;
}

function sampleInput(index) {
  const projects = ["Wallace", "Perry", "Atlas", "Graph Memory"];
  const project = projects[index % projects.length];
  const sourceId = `ontology-perf-${index}`;
  const startedAt = new Date(Date.UTC(2026, 4, 25, 12, index % 60, 0)).toISOString();
  return {
    note: {
      source: "granola",
      sourceId,
      title: `${project} Ontology Perf ${index}`,
      creatorName: "Ada",
      creatorEmail: "ada@doppel.example",
      attendees: [{ name: "Ben", email: "ben@doppel.example" }],
      calendarTitle: `${project} planning`,
      folderName: project,
      startedAt,
      summaryMarkdown:
        `Goal: reduce ${project} ontology p95 below ${10 + (index % 50)} ms. ` +
        `Metric: p95 ${project} ontology latency ${8 + (index % 45)} ms. ` +
        `Risk: ${project} stale ontology row ${index}. ` +
        `Blocker: ${project} synthetic dependency ${index % 25}. ` +
        `Open question: should ${project} refresh window ${index % 10} be smaller? ` +
        `Capability: ${project} typed company brain reads. ` +
        `Feature: ${project} changed-since ontology panel. ` +
        `Artifact: reports/performance/ontology-${index}.json. ` +
        `Benchmark report: ${project} ontology perf report ${index}.`,
      sourceUrl: `https://granola.example/${sourceId}`,
    },
    record: {
      id: `granola:${sourceId}`,
      source: "granola",
      sourceId,
      title: `${project} Ontology Perf ${index}`,
      createdAt: startedAt,
      updatedAt: startedAt,
      status: "processed",
    },
    knowledge: {
      decisions: [{ text: `Ada owns ${project} ontology performance until review ${index}.` }],
      actionItems: [{ owner: "Ada", text: `Review ${project} ontology benchmark ${index}.` }],
    },
    route: {
      project,
      publishMode: "auto",
      reason: `Matched ${project}`,
      discordChannelId: `${project.toLowerCase().replace(/\s+/g, "-")}-brain`,
      notionDataSourceId: `${project.toLowerCase().replace(/\s+/g, "-")}-wiki`,
    },
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    parsed[key] = inline ?? values[index + 1] ?? "true";
    if (inline === undefined && values[index + 1] && !values[index + 1].startsWith("--")) index += 1;
  }
  return parsed;
}

function readBudgets(parsedArgs) {
  const mapping = {
    "budget-materialized-build-ms": "materialized build index",
    "budget-materialized-summarize-ms": "materialized summarize",
    "budget-materialized-project-goals-ms": "materialized project goals",
    "budget-materialized-project-risks-ms": "materialized project risks",
    "budget-materialized-project-blockers-ms": "materialized project blockers",
    "budget-materialized-evidence-ms": "materialized evidence lookup",
    "budget-legacy-build-ms": "legacy load + parse change-set JSON",
  };
  const output = {};
  for (const [argName, stepName] of Object.entries(mapping)) {
    const value = Number(parsedArgs[argName]);
    if (Number.isFinite(value) && value > 0) output[stepName] = value;
  }
  return output;
}

function evaluateBudgets(measuredSteps, budgetMap) {
  return measuredSteps
    .filter((step) => typeof budgetMap[step.name] === "number" && step.ms > budgetMap[step.name])
    .map((step) => ({ name: step.name, ms: round(step.ms), budgetMs: budgetMap[step.name] }));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Ontology Performance",
    "",
    `- Records: ${value.records}`,
    `- DB path: ${value.dbPath}`,
    "",
    "## Steps",
    "",
    "| Step | ms | budget ms | ops/sec |",
    "| --- | ---: | ---: | ---: |",
    ...value.steps.map((step) => `| ${step.name} | ${step.ms} | ${step.budgetMs ?? ""} | ${step.opsPerSec ?? ""} |`),
    "",
    "## Budget Failures",
    "",
    ...(value.budgetFailures.length
      ? value.budgetFailures.map((failure) => `- ${failure.name}: ${failure.ms} ms over ${failure.budgetMs} ms`)
      : ["- none"]),
    "",
    "## Counts",
    "",
    ...Object.entries(value.summary.counts).map(([type, count]) => `- ${type}: ${count}`),
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function round(value) {
  return Math.round(value * 100) / 100;
}
