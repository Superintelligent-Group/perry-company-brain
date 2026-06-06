const { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } = require("node:fs");
const { basename, dirname, join, relative, resolve } = require("node:path");

const args = parseArgs(process.argv.slice(2));
const corpusPath = args.corpus || join("tests", "fixtures", "generated-company-scenarios.json");
const dbPath = args.db || args["db-path"] || join("reports", "db", `${basename(corpusPath).replace(/\.json$/i, "")}.sqlite`);
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const reset = args.reset === "true";
const workflow = args.workflow === "true";

if (dbPath === ":memory:") throw new Error("Use a filesystem --db path for a reusable corpus DB.");
const resolvedDbPath = resolve(dbPath);

if (reset) resetDbFiles(resolvedDbPath);
if (!reset && existsSync(resolvedDbPath)) throw new Error(`DB already exists; use --reset true to replace it: ${resolvedDbPath}`);
mkdirSync(dirname(resolvedDbPath), { recursive: true });

process.env.PERRY_DB_PATH = resolvedDbPath;
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = "false";

const {
  closeBrainStore,
  countMeetingRecords,
  flushFtsQueue,
  insertBackfillMeetingBatch,
  listActionItems,
  listDecisions,
  meetingRecordFromNote,
} = require("../dist/store/index.js");
const { extractKnowledge } = require("../dist/extraction/knowledge.js");
const { normalizeGranolaZapierPayload } = require("../dist/meetings/note.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const ingestTimings = [];
  const failures = [];
  let inserted = 0;

  if (workflow) {
    for (const item of corpus) {
      const ingestStarted = performance.now();
      const result = await processGranolaZapierPayload(item.payload, { force: true });
      ingestTimings.push(performance.now() - ingestStarted);
      if (result.record.status !== "processed") failures.push({ id: item.id, status: result.record.status, error: result.record.error });
    }
    inserted = countMeetingRecords("processed");
  } else {
    const prepareStarted = performance.now();
    const items = corpus.map((item) => {
      const note = normalizeGranolaZapierPayload(item.payload);
      return {
        record: meetingRecordFromNote(note, "processed"),
        knowledge: extractKnowledge(note),
      };
    });
    ingestTimings.push(performance.now() - prepareStarted);
    const batchStarted = performance.now();
    inserted = insertBackfillMeetingBatch(items);
    ingestTimings.push(performance.now() - batchStarted);
  }

  const flushStarted = performance.now();
  const flushedFtsRows = flushFtsQueue(1_000_000);
  const flushMs = performance.now() - flushStarted;
  const processedMeetings = countMeetingRecords("processed");
  const decisions = listDecisions(1_000_000).length;
  const actions = listActionItems(1_000_000).length;
  closeBrainStore(resolvedDbPath);

  const output = {
    ok: failures.length === 0,
    elapsedMs: round(performance.now() - started),
    corpusPath,
    dbPath: resolvedDbPath,
    reset,
    workflow,
    corpusCount: corpus.length,
    inserted,
    processedMeetings,
    decisions,
    actions,
    flushedFtsRows,
    flushMs: round(flushMs),
    dbBytes: existsSync(resolvedDbPath) ? statSync(resolvedDbPath).size : 0,
    ingestMs: summarizeTimings(ingestTimings),
    failures: failures.slice(0, 25),
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  if (!output.ok) process.exitCode = 2;
}

function resetDbFiles(path) {
  assertWorkspacePath(path);
  for (const candidate of [path, `${path}-shm`, `${path}-wal`, `${path}-journal`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

function assertWorkspacePath(path) {
  const rel = relative(process.cwd(), path);
  if (rel.startsWith("..") || rel === "" || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`Refusing to reset DB outside the workspace: ${path}`);
  }
  if (!/\.(sqlite|sqlite3|db)$/i.test(path)) {
    throw new Error(`Refusing to reset non-SQLite file: ${path}`);
  }
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
    "# Company Brain Corpus DB",
    "",
    `- OK: ${output.ok}`,
    `- Corpus: ${output.corpusPath}`,
    `- DB: ${output.dbPath}`,
    `- Workflow mode: ${output.workflow}`,
    `- Corpus count: ${output.corpusCount}`,
    `- Inserted: ${output.inserted}`,
    `- Meetings: ${output.processedMeetings}`,
    `- Decisions: ${output.decisions}`,
    `- Actions: ${output.actions}`,
    `- FTS rows: ${output.flushedFtsRows}`,
    `- FTS flush: ${output.flushMs} ms`,
    `- DB bytes: ${output.dbBytes}`,
    `- Elapsed: ${output.elapsedMs} ms`,
    `- Ingest p50: ${output.ingestMs?.p50 ?? "n/a"} ms`,
    `- Ingest p95: ${output.ingestMs?.p95 ?? "n/a"} ms`,
    "",
    "## Failures",
    "",
    ...(output.failures.length ? output.failures.map((item) => `- ${item.id}: ${item.status} ${item.error || ""}`) : ["- none"]),
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