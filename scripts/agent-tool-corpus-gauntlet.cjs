const { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { basename, dirname, join, relative, resolve } = require("node:path");
const { performance } = require("node:perf_hooks");

const args = parseArgs(process.argv.slice(2));
const corpusPath = args.corpus || join("tests", "fixtures", "generated-company-scenarios.json");
const dbPath = resolve(args.db || join("reports", "db", "agent-tool-corpus.sqlite"));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const ingestLimit = Math.max(1, Math.trunc(Number(args.limit ?? 250)));
const reset = args.reset === "true";
const ingest = args.ingest === "true" || reset || !existsSync(dbPath);
const seedProbe = args.probe !== "false";
const maxBytes = Number(args["max-bytes"] ?? 16000);
const maxElapsedMs = Number(args["max-elapsed-ms"] ?? 100);
const since = args.since || "2000-01-01T00:00:00.000Z";
const projects = (args.projects || "Perry,Wallace,Atlas,Graph Memory,Context Engine")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (dbPath === ":memory:") throw new Error("Use a filesystem --db path for the persistent corpus gauntlet.");
if (reset) resetDbFiles(dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

process.env.PERRY_DB_PATH = dbPath;
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = "true";
process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = "true";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs-agent-tool-corpus";
process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = "false";
process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = "false";

const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const { closeBrainStore, countMeetingRecords, listGraphChangeSets, rebuildOntologyMaterializedIndex } = require("../dist/store/index.js");
const { getBrainToolChangedSince, getBrainToolEvidence, getBrainToolProjectState } = require("../dist/brain/tools.js");
const { getOntologyHealthReport } = require("../dist/brain/ontology-health.js");

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  const ingestTimings = [];
  const ingestFailures = [];
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const selected = corpus.slice(0, ingestLimit);

  if (ingest) {
    for (const item of selected) {
      const ingestStarted = performance.now();
      const result = await processGranolaZapierPayload(item.payload, { force: true });
      ingestTimings.push(performance.now() - ingestStarted);
      if (result.record.status !== "processed") ingestFailures.push({ id: item.id, status: result.record.status, error: result.record.error });
    }
  }

  const backfill = rebuildOntologyMaterializedIndex({ reset: true, limit: 1_000_000 });
  const calls = [];
  const projectStates = projects.map((project) =>
    timedCall(calls, `project_state:${project}`, () =>
      getBrainToolProjectState({ project, types: ["goal", "risk", "blocker", "open_question", "capability"], limit: 10 })
    )
  );
  const changedSince = timedCall(calls, "changed_since", () => getBrainToolChangedSince({ since, limit: 100 }));
  const firstEntity = projectStates.flatMap((state) => state.sections.flatMap((section) => section.entities))[0] || changedSince.entities[0];
  const evidence = timedCall(calls, "evidence", () => getBrainToolEvidence({ stableKey: firstEntity?.stableKey || "goal:missing" }));
  const health = timedCall(calls, "ontology_health", () => getOntologyHealthReport({ changeSetLimit: 200 }));

  const checks = [
    check("ingest_ok", ingestFailures.length === 0, `${ingestFailures.length} failures`),
    check("processed_meetings_present", countMeetingRecords("processed") > 0, `${countMeetingRecords("processed")} processed meetings`),
    check("graph_change_sets_present", listGraphChangeSets({ limit: 1 }).length > 0, `${backfill.changeSets} backfilled change sets`),
    check("ontology_health_has_no_critical_failures", health.ok, health.checks.filter((item) => !item.passed && item.severity === "critical").map((item) => item.id).join(", ")),
    check("project_state_has_entities", projectStates.some((state) => state.sections.some((section) => section.entities.length > 0)), "at least one configured project returns entities"),
    check("changed_since_has_entities", changedSince.entities.length > 0, `${changedSince.entities.length} changed entities`),
    check("evidence_has_proof", evidence.evidence.length > 0 && evidence.relations.length > 0, `${evidence.evidence.length} evidence, ${evidence.relations.length} relations`),
    check("payloads_are_bounded", calls.every((call) => call.bytes <= maxBytes), calls.map((call) => `${call.name}:${call.bytes}`).join(", ")),
    check("calls_are_fast", calls.every((call) => call.elapsedMs <= maxElapsedMs), calls.map((call) => `${call.name}:${call.elapsedMs}ms`).join(", ")),
  ];

  const output = {
    ok: checks.every((item) => item.passed),
    elapsedMs: round(performance.now() - started),
    corpusPath,
    dbPath,
    ingest,
    reset,
    ingestLimit,
    corpusCount: corpus.length,
    processedMeetings: countMeetingRecords("processed"),
    graphChangeSets: backfill.changeSets,
    backfill,
    ingestLatencyMs: summarizeTimings(ingestTimings),
    calls,
    health: { ok: health.ok, counts: health.counts, failingChecks: health.checks.filter((item) => !item.passed) },
    sample: {
      firstEntity: firstEntity?.stableKey,
      projects: projectStates.map((state) => ({
        project: state.input.project,
        returned: state.sections.reduce((sum, section) => sum + section.entities.length, 0),
        counts: Object.fromEntries(state.sections.map((section) => [section.type, section.count])),
      })),
      changedCount: changedSince.count,
      evidenceCount: evidence.evidence.length,
      relationCount: evidence.relations.length,
    },
    checks,
    ingestFailures: ingestFailures.slice(0, 25),
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  closeBrainStore(dbPath);
  if (!output.ok) process.exitCode = 2;
}

function agentToolProbePayload(projectName) {
  return {
    note_id: `agent-tool-corpus-probe-${projectName.toLowerCase().replace(/\\s+/g, "-")}`,
    title: `${projectName} Agent Tool Corpus Probe`,
    created_at: "2026-05-25T19:00:00.000Z",
    creator: { name: "Ada", email: "ada@doppel.example" },
    attendees: [{ name: "Ben", email: "ben@doppel.example" }],
    calendar_event: { title: `${projectName} Planning`, start_time: "2026-05-25T19:00:00.000Z" },
    folder: projectName,
    summary:
      "Decisions:\\n" +
      `- Ada owns ${projectName} corpus agent tools until scale review.\\n\\n` +
      "Action items:\\n" +
      `- Ben: Validate ${projectName} ontology repair report.\\n\\n` +
      `Goal: make ${projectName} persistent corpus tools answer under 100 ms. ` +
      `Risk: ${projectName} persistent corpus ontology drift hides stale blockers. ` +
      `Blocker: ${projectName} repair workflow needs dry-run evidence. ` +
      `Open question: should ${projectName} corpus gauntlet run nightly? ` +
      `Capability: ${projectName} persistent corpus agent tool validation.`, 
    link: "https://granola.example/agent-tool-corpus-probe",
  };
}

function timedCall(calls, name, fn) {
  const started = performance.now();
  const value = fn();
  const serialized = JSON.stringify(value);
  calls.push({ name, elapsedMs: round(performance.now() - started), bytes: Buffer.byteLength(serialized, "utf8") });
  return value;
}

function resetDbFiles(path) {
  assertWorkspacePath(path);
  for (const candidate of [path, `${path}-shm`, `${path}-wal`, `${path}-journal`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

function assertWorkspacePath(path) {
  const rel = relative(process.cwd(), path);
  if (rel.startsWith("..") || rel === "" || /^[A-Za-z]:/u.test(rel)) throw new Error(`Refusing to reset DB outside the workspace: ${path}`);
  if (!/\.(sqlite|sqlite3|db)$/iu.test(path)) throw new Error(`Refusing to reset non-SQLite file: ${path}`);
}

function check(name, passed, detail) {
  return { name, passed, detail };
}

function summarizeTimings(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
    avg: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Agent Tool Corpus Gauntlet",
    "",
    `- OK: ${output.ok}`,
    `- Corpus: ${output.corpusPath}`,
    `- DB: ${output.dbPath}`,
    `- Ingested this run: ${output.ingest}`,
    `- Ingest limit: ${output.ingestLimit}`,
    `- Processed meetings: ${output.processedMeetings}`,
    `- Graph change sets: ${output.graphChangeSets}`,
    `- Elapsed: ${output.elapsedMs} ms`,
    "",
    "## Calls",
    "",
    "| Tool | ms | bytes |",
    "| --- | ---: | ---: |",
    ...output.calls.map((call) => `| ${call.name} | ${call.elapsedMs} | ${call.bytes} |`),
    "",
    "## Checks",
    "",
    ...output.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.name}: ${item.detail ?? ""}`),
    "",
    "## Health",
    "",
    `- OK: ${output.health.ok}`,
    ...Object.entries(output.health.counts).map(([key, value]) => `- ${key}: ${value}`),
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

