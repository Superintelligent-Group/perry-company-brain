const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const args = parseArgs(process.argv.slice(2));
const started = performance.now();
if (args.db) process.env.PERRY_DB_PATH = args.db;

const {
  closeBrainStore,
  getMeetingStorePath,
  rebuildOntologyMaterializedIndex,
} = require("../dist/store/index.js");
const { getOntologyHealthReport } = require("../dist/brain/ontology-health.js");

process.env.PERRY_DB_PATH ||= getMeetingStorePath();

try {
  const before = getOntologyHealthReport({ changeSetLimit: Number(args["change-set-limit"] ?? 200) });
  const backfill = rebuildOntologyMaterializedIndex({
    limit: Number(args.limit ?? 100_000),
    reset: args.apply === "true",
    changedSince: args["changed-since"] || args.changedSince,
    dryRun: args.apply !== "true",
  });
  const after = args.apply === "true" ? getOntologyHealthReport({ changeSetLimit: Number(args["change-set-limit"] ?? 200) }) : undefined;
  const plan = buildRepairPlan(before);
  const output = {
    ok: before.ok || args.apply === "true" ? Boolean(after?.ok ?? before.ok) : true,
    elapsedMs: round(performance.now() - started),
    dbPath: process.env.PERRY_DB_PATH,
    mode: args.apply === "true" ? "apply" : "dry-run",
    before,
    backfill,
    after,
    plan,
  };
  console.log(JSON.stringify(output, null, 2));
  if (args.report) writeJson(args.report, output);
  if (args.markdown) writeMarkdown(args.markdown, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (args.apply === "true" && !output.ok) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  closeBrainStore(process.env.PERRY_DB_PATH);
  process.exit(1);
}

function buildRepairPlan(health) {
  const actions = [];
  const failing = health.checks.filter((item) => !item.passed);
  if (failing.some((item) => item.id.includes("coverage") || item.id === "materialized_entities_present")) {
    actions.push({
      id: "rebuild_materialized_ontology",
      command: "pnpm ontology:repair -- --apply true",
      reason: "Materialized ontology rows do not match sampled graph change sets.",
      destructive: false,
    });
  }
  if (health.counts.relationsMissingEvidence > 0 || health.counts.orphanedEvidence > 0 || health.counts.entitiesMissingEvidence > 0) {
    actions.push({
      id: "replay_graph_change_sets",
      command: "pnpm company-brain:ontology-backfill -- --reset true",
      reason: "Evidence links are missing or orphaned; replaying graph change sets is the safest current repair.",
      destructive: false,
    });
  }
  if (health.counts.duplicateNameGroups > 0) {
    actions.push({
      id: "review_duplicate_entity_merges",
      command: "Inspect duplicateNameGroups in the JSON report.",
      reason: "Duplicate semantic names need human or model-assisted merge proposals before automatic writes.",
      destructive: false,
    });
  }
  if (health.counts.unprojectedEntities > 0) {
    actions.push({
      id: "review_project_link_coverage",
      command: "Inspect unprojectedEntityKeys in the JSON report.",
      reason: "Entities without project or meeting links may answer poorly in project-scoped tools.",
      destructive: false,
    });
  }
  if (actions.length === 0) {
    actions.push({
      id: "no_repair_needed",
      command: "none",
      reason: "Ontology health checks are clean for the sampled window.",
      destructive: false,
    });
  }
  return { actionCount: actions.length, actions };
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  const health = output.after ?? output.before;
  const lines = [
    "# Ontology Repair",
    "",
    `- OK: ${output.ok}`,
    `- Mode: ${output.mode}`,
    `- DB path: ${output.dbPath}`,
    `- Elapsed: ${output.elapsedMs} ms`,
    `- Health OK: ${health.ok}`,
    `- Backfill dry run: ${Boolean(output.backfill.dryRun)}`,
    `- Backfill reset: ${Boolean(output.backfill.reset)}`,
    `- Change sets: ${output.backfill.changeSets}`,
    `- Entities: ${output.backfill.entities}`,
    `- Relations: ${output.backfill.relations}`,
    `- Evidence: ${output.backfill.evidence}`,
    "",
    "## Repair Plan",
    "",
    ...output.plan.actions.map((item) => `- ${item.id}: ${item.reason} (${item.command})`),
    "",
    "## Health Checks",
    "",
    ...health.checks.map((item) => `- ${item.passed ? "PASS" : item.severity.toUpperCase()} ${item.id}: ${item.detail}`),
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function round(value) {
  return Math.round(value * 100) / 100;
}
