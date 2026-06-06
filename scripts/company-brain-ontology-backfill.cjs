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
const { summarizeOntology } = require("../dist/brain/ontology-queries.js");

process.env.PERRY_DB_PATH ||= getMeetingStorePath();

try {
  const result = rebuildOntologyMaterializedIndex({
    limit: Number(args.limit ?? 100_000),
    reset: parseReset(args),
    changedSince: args["changed-since"] || args.changedSince,
    dryRun: args["dry-run"] === "true" || args.dryRun === "true",
  });
  const output = {
    ok: true,
    elapsedMs: round(performance.now() - started),
    dbPath: process.env.PERRY_DB_PATH,
    backfill: result,
    summary: summarizeOntology(),
  };
  console.log(JSON.stringify(output, null, 2));
  if (args.report) writeJson(args.report, output);
  if (args.markdown) writeMarkdown(args.markdown, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  closeBrainStore(process.env.PERRY_DB_PATH);
  process.exit(1);
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

function parseReset(args) {
  if (args.incremental === "true" || args["changed-since"] || args.changedSince) return false;
  if (args.reset === undefined) return true;
  return args.reset !== "false";
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Company Brain Ontology Backfill",
    "",
    `- OK: ${value.ok}`,
    `- Elapsed ms: ${value.elapsedMs}`,
    `- DB path: ${value.dbPath}`,
    `- Change sets: ${value.backfill.changeSets}`,
    `- Entities: ${value.backfill.entities}`,
    `- Relations: ${value.backfill.relations}`,
    `- Evidence: ${value.backfill.evidence}`,
    `- Dry run: ${Boolean(value.backfill.dryRun)}`,
    `- Reset: ${Boolean(value.backfill.reset)}`,
    value.backfill.changedSince ? `- Changed since: ${value.backfill.changedSince}` : undefined,
    "",
    "## Counts",
    "",
    ...Object.entries(value.summary.counts).map(([type, count]) => `- ${type}: ${count}`),
    "",
  ];
  writeFileSync(path, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
}

function round(value) {
  return Math.round(value * 100) / 100;
}
