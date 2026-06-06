const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { performance } = require("node:perf_hooks");

const args = parseArgs(process.argv.slice(2));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const project = args.project || "Wallace";
const maxBytes = Number(args["max-bytes"] ?? 12000);
const maxElapsedMs = Number(args["max-elapsed-ms"] ?? 75);
const since = args.since || "2000-01-01T00:00:00.000Z";
const forbiddenMarkers = ["PRIVATE_MARKER_DO_NOT_LEAK", "TRANSCRIPT_MARKER_DO_NOT_LEAK"];

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = "true";
process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = "true";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs-agent-tool-gauntlet";
process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = "false";
process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = "false";

const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const { closeBrainStore } = require("../dist/store/index.js");
const { getBrainToolChangedSince, getBrainToolEvidence, getBrainToolProjectState } = require("../dist/brain/tools.js");
const { getOntologyHealthReport } = require("../dist/brain/ontology-health.js");

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  await processGranolaZapierPayload(payload(project), { force: true });
  const calls = [];
  const projectState = timedCall(calls, "project_state", () =>
    getBrainToolProjectState({ project, types: ["goal", "risk", "blocker", "open_question", "capability"], limit: 8 })
  );
  const changedSince = timedCall(calls, "changed_since", () => getBrainToolChangedSince({ since, project, limit: 25 }));
  const firstEntity = projectState.sections.flatMap((section) => section.entities)[0] || changedSince.entities[0];
  const evidence = timedCall(calls, "evidence", () => getBrainToolEvidence({ stableKey: firstEntity?.stableKey || "goal:missing" }));
  const health = timedCall(calls, "ontology_health", () => getOntologyHealthReport({ changeSetLimit: 50 }));

  const checks = [
    check("project_state_shape", projectState.tool === "company_brain.project_state" && projectState.sections.length >= 3, `${projectState.sections.length} sections`),
    check("project_state_has_entities", projectState.sections.some((section) => section.entities.length > 0), "entity-bearing section exists"),
    check("changed_since_shape", changedSince.tool === "company_brain.changed_since", changedSince.tool),
    check("changed_since_has_entities", changedSince.entities.length > 0, `${changedSince.entities.length} changed entities`),
    check("evidence_shape", evidence.tool === "company_brain.evidence" && evidence.evidence.length > 0, `${evidence.evidence.length} evidence rows`),
    check("evidence_relations_present", evidence.relations.length > 0, `${evidence.relations.length} relations`),
    check("health_no_critical_failures", health.ok, health.checks.filter((item) => !item.passed && item.severity === "critical").map((item) => item.id).join(", ")),
    check("payloads_are_bounded", calls.every((call) => call.bytes <= maxBytes), calls.map((call) => `${call.name}:${call.bytes}`).join(", ")),
    check("calls_are_fast", calls.every((call) => call.elapsedMs <= maxElapsedMs), calls.map((call) => `${call.name}:${call.elapsedMs}ms`).join(", ")),
    check("evidence_excerpts_are_capped", evidence.evidence.every((item) => !item.excerpt || item.excerpt.length <= 600), "600 char cap"),
    check("no_private_or_transcript_leakage", !forbiddenMarkers.some((marker) => JSON.stringify({ projectState, changedSince, evidence }).includes(marker)), forbiddenMarkers.join(", ")),
  ];
  const output = {
    ok: checks.every((item) => item.passed),
    project,
    dbPath: process.env.PERRY_DB_PATH,
    maxBytes,
    maxElapsedMs,
    calls,
    health: {
      ok: health.ok,
      counts: health.counts,
      failingChecks: health.checks.filter((item) => !item.passed),
    },
    sample: {
      firstEntity: firstEntity?.stableKey,
      projectSections: projectState.sections.map((section) => ({ type: section.type, count: section.count, returned: section.entities.length })),
      changedCount: changedSince.count,
      evidenceCount: evidence.evidence.length,
      relationCount: evidence.relations.length,
    },
    checks,
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (!output.ok) process.exitCode = 2;
}

function timedCall(calls, name, fn) {
  const started = performance.now();
  const value = fn();
  const serialized = JSON.stringify(value);
  calls.push({ name, elapsedMs: round(performance.now() - started), bytes: Buffer.byteLength(serialized, "utf8") });
  return value;
}

function payload(projectName) {
  return {
    note_id: `agent-tool-gauntlet-${projectName.toLowerCase()}`,
    title: `${projectName} Agent Tool Contract Review`,
    created_at: "2026-05-25T18:15:00.000Z",
    creator: { name: "Ada", email: "ada@doppel.example" },
    attendees: [{ name: "Ben", email: "ben@doppel.example" }],
    calendar_event: { title: `${projectName} Planning`, start_time: "2026-05-25T18:15:00.000Z" },
    folder: projectName,
    summary:
      "Decisions:\n" +
      `- Ada owns ${projectName} agent tool contracts until release.\n\n` +
      "Action items:\n" +
      `- Ben: Verify ${projectName} changed-since output in Discord.\n\n` +
      `Goal: make ${projectName} brain tools useful under 75 ms. ` +
      `Risk: ${projectName} tool payloads become too large for fast local models. ` +
      `Blocker: ${projectName} health checks are not visible in admin. ` +
      `Open question: should ${projectName} agents request evidence before answering? ` +
      `Capability: ${projectName} bounded agent tool contracts.`,
    my_notes: "PRIVATE_MARKER_DO_NOT_LEAK: local-only raw thought that should not enter tool payloads.",
    transcript: "TRANSCRIPT_MARKER_DO_NOT_LEAK: full transcript line that should stay out of graph evidence.",
    link: "https://granola.example/agent-tool-gauntlet",
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
    "# Agent Tool Contract Gauntlet",
    "",
    `- OK: ${output.ok}`,
    `- Project: ${output.project}`,
    `- DB path: ${output.dbPath}`,
    `- Max bytes: ${output.maxBytes}`,
    `- Max elapsed ms: ${output.maxElapsedMs}`,
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
