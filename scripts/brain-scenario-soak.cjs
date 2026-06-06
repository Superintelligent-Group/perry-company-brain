const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");

const args = parseArgs(process.argv.slice(2));
const count = args.count || "50";
const batch = args.batch || "5";
const graphLimit = args["graph-limit"] || "10";
const model = args.model || process.env.PERRY_LMSTUDIO_EXTRACTION_MODEL || "gemma-4-e4b-claude-abliterated";
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const outDir = args.outDir || join("reports", "scenarios", stamp);
const corpus = args.corpus || join(outDir, "generated-company-scenarios.json");
const report = join(outDir, "evaluation.json");
const markdown = join(outDir, "evaluation.md");
const graph = args.graph ?? "true";

mkdirSync(outDir, { recursive: true });

run("generate scenarios", [
  "scripts/brain-generate-scenarios.cjs",
  "--count", count,
  "--batch", batch,
  "--out", corpus,
  "--model", model,
]);

run("evaluate scenarios", [
  "scripts/brain-evaluate-scenarios.cjs",
  "--corpus", corpus,
  "--report", report,
  "--markdown", markdown,
  "--graph", graph,
  "--graph-limit", graphLimit,
]);

console.log(JSON.stringify({ ok: true, outDir, corpus, report, markdown, count: Number(count), graph: graph === "true", graphLimit: Number(graphLimit) }, null, 2));

function run(name, commandArgs) {
  console.log(`RUN ${name}: node ${commandArgs.join(" ")}`);
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PERRY_SQLITE_JOURNAL_MODE: process.env.PERRY_SQLITE_JOURNAL_MODE || "MEMORY",
      PERRY_GRAPHITI_BRIDGE_URL: process.env.PERRY_GRAPHITI_BRIDGE_URL || "http://127.0.0.1:8791",
      PERRY_GRAPHITI_DIRECT_CHANGESETS: process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS || "true",
      PERRY_GRAPHITI_TIMEOUT_MS: process.env.PERRY_GRAPHITI_TIMEOUT_MS || "120000",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
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
