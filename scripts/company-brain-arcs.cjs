const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const {
  closeBrainStore,
  countMeetingRecords,
  flushFtsQueue,
  listActionItems,
  listDecisions,
  searchBrain,
} = require("../dist/store/index.js");
const { getCompanyBrainInsights } = require("../dist/brain/insights.js");
const { projectMultiplayerState } = require("../dist/graph/multiplayer-projection.js");
const { drainGraphSyncJobs } = require("../dist/graph/queue.js");
const { replayGraphChangeSet } = require("../dist/graph/change-set-replay.js");
const { searchGraphMemory } = require("../dist/graph/memory.js");
const { listGraphChangeSets } = require("../dist/store/index.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const { createSyntheticCompanyArcCorpus } = require("./synthetic-company-arcs.cjs");

const args = parseArgs(process.argv.slice(2));
const projects = Math.max(1, Number(args.projects || 6));
const meetingsPerProject = Math.max(3, Number(args["meetings-per-project"] || args.meetings || 5));
const seed = Number(args.seed || 101);
const graphEnabled = args.graph === "true";
const graphLimit = Math.max(0, Number(args["graph-limit"] || 6));
const processOrder = args.order || "chronological";
const duplicateReplay = Math.max(0, Number(args["duplicate-replay"] || 0));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = graphEnabled ? "true" : "false";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs-arcs";
process.env.PERRY_GRAPHITI_TIMEOUT_MS ||= "120000";
process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS ||= "true";
process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES ||= "false";
process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT ||= "false";

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  const corpus = createSyntheticCompanyArcCorpus({ projects, meetingsPerProject, seed });
  const failures = [];
  const privacyFailures = [];
  const ingestTimings = [];
  const searchTimings = [];
  const graphTimings = { drainMs: 0, replayMs: [], searchMs: [] };

  const ingestItems = orderItems(corpus.items, processOrder, seed);
  const duplicateChecks = [];

  for (const item of ingestItems) {
    const ingestStarted = performance.now();
    const result = await processGranolaZapierPayload(item.payload, { force: true });
    ingestTimings.push(performance.now() - ingestStarted);
    if (result.record.status !== "processed") failures.push(failure("ingest", item.id, `status ${result.record.status}`));
    const announcement = result.announcement || "";
    if (announcement.includes("PRIVATE_SYNTHETIC_MARKER")) privacyFailures.push(failure("privacy", item.id, "private note leaked"));
    if (announcement.includes("TRANSCRIPT_SYNTHETIC_MARKER")) privacyFailures.push(failure("privacy", item.id, "transcript leaked"));
  }

  for (const item of ingestItems.slice(0, duplicateReplay)) {
    const duplicate = await processGranolaZapierPayload(item.payload);
    const passed = duplicate.duplicate === true && duplicate.record.status === "processed";
    duplicateChecks.push({ id: item.id, duplicate: duplicate.duplicate, status: duplicate.record.status, passed });
    if (!passed) failures.push(failure("duplicate_replay", item.id, `expected duplicate processed record, got duplicate=${duplicate.duplicate} status=${duplicate.record.status}`));
  }

  const flushedFtsRows = flushFtsQueue(1_000_000);
  const decisions = listDecisions(1_000_000).map((item) => item.text);
  const actions = listActionItems(1_000_000).map((item) => ({ owner: item.owner, text: item.text }));
  const insights = getCompanyBrainInsights(1_000_000);
  const multiplayer = projectMultiplayerState(1_000_000);

  const decisionChecks = [];
  const actionChecks = [];
  const searchChecks = [];
  const ownershipChecks = [];
  const actionOwnerChecks = [];

  for (const item of corpus.items) {
    for (const expected of item.expected.decisions) {
      const passed = decisions.includes(expected);
      decisionChecks.push({ id: item.id, passed });
      if (!passed) failures.push(failure("decision", item.id, `missing decision '${expected}'`));
    }
    for (const expected of item.expected.actions) {
      const passed = actions.some((action) => action.owner === expected.owner && action.text === expected.text);
      actionChecks.push({ id: item.id, passed });
      if (!passed) failures.push(failure("action", item.id, `missing action '${expected.owner}: ${expected.text}'`));
    }
  }

  for (const expected of corpus.expected.finalOwnership) {
    const actual = insights.ownership.find((item) => item.subject === expected.subject);
    const historyHasExpectedHandoff = !expected.previousOwner || insights.ownershipHistory.some((item) => item.subject === expected.subject && item.owner === expected.owner && item.previousOwner === expected.previousOwner);
    const passed = actual?.owner === expected.owner && historyHasExpectedHandoff;
    ownershipChecks.push({ subject: expected.subject, expectedOwner: expected.owner, expectedPreviousOwner: expected.previousOwner, actualOwner: actual?.owner, actualPreviousOwner: actual?.previousOwner, passed });
    if (!passed) failures.push(failure("ownership", expected.subject, `expected current ${expected.owner} with handoff from ${expected.previousOwner || "any"}, got current ${actual?.owner || "missing"}`));
  }

  for (const [owner, minimum] of Object.entries(corpus.expected.ownerActionMinimums)) {
    const actual = insights.openActionsByOwner.find((item) => item.owner === owner)?.count || 0;
    const passed = actual >= minimum;
    actionOwnerChecks.push({ owner, minimum, actual, passed });
    if (!passed) failures.push(failure("action_owner", owner, `expected at least ${minimum}, got ${actual}`));
  }

  for (const expected of corpus.expected.search) {
    const searchStarted = performance.now();
    const results = searchBrain(expected.query, 10);
    searchTimings.push(performance.now() - searchStarted);
    const haystack = results.map((result) => `${result.title}\n${result.snippet}`).join("\n");
    const passed = containsNormalized(haystack, expected.mustContain);
    searchChecks.push({ query: expected.query, mustContain: expected.mustContain, passed, resultCount: results.length });
    if (!passed) failures.push(failure("search", expected.query, `missing '${expected.mustContain}'`));
  }

  if (insights.counts.ownershipChanges !== corpus.expected.ownershipChangeCount) {
    failures.push(failure("ownership_change_count", "insights", `expected exactly ${corpus.expected.ownershipChangeCount}, got ${insights.counts.ownershipChanges}`));
  }

  let graph = { enabled: graphEnabled };
  if (graphEnabled && graphLimit > 0) {
    const itemByMeetingId = new Map(corpus.items.map((item) => [`granola:${item.payload.note_id}`, item]));
    const drainStarted = performance.now();
    const drained = await drainGraphSyncJobs(graphLimit);
    graphTimings.drainMs = performance.now() - drainStarted;
    const newChangeSets = listGraphChangeSets({ status: "applied", limit: Math.max(1000, graphLimit * 5) }).slice(0, graphLimit);
    const replayChecks = [];
    const graphSearchChecks = [];
    if (newChangeSets.length < drained.processed) {
      failures.push(failure("graph_replay", "graph", `expected ${drained.processed} new change set(s), found ${newChangeSets.length}`));
    }
    for (const changeSet of newChangeSets) {
      const item = itemByMeetingId.get(changeSet.meetingId);
      const id = item?.id || changeSet.meetingId;
      const replayStarted = performance.now();
      const replay = await replayGraphChangeSet(changeSet.id);
      graphTimings.replayMs.push(performance.now() - replayStarted);
      replayChecks.push({ id, changeSetId: changeSet.id, passed: replay.diff.passed, expected: replay.diff.expected, missing: replay.diff.missing, errors: replay.diff.errors });
      if (!replay.diff.passed) failures.push(failure("graph_replay", id, "replay diff failed"));
      const expected = item?.expected.search[0];
      if (!expected) continue;
      const graphSearchStarted = performance.now();
      const response = await searchGraphMemory(expected.query, 5);
      graphTimings.searchMs.push(performance.now() - graphSearchStarted);
      const graphHaystack = response.results.map((result) => `${result.name || ""}\n${result.fact || ""}`).join("\n");
      const passed = containsNormalized(graphHaystack, expected.mustContain);
      graphSearchChecks.push({ id, query: expected.query, passed, resultCount: response.results.length, error: response.error });
      if (!passed) failures.push(failure("graph_search", id, `graph search '${expected.query}' missing '${expected.mustContain}'`));
    }
    graph = { enabled: true, drained, replayChecks, graphSearchChecks };
    if (drained.failed > 0) failures.push(failure("graph_drain", "graph", `graph drain failed ${drained.failed} job(s)`));
  }

  failures.push(...privacyFailures);
  const output = {
    ok: failures.length === 0,
    elapsedMs: round(performance.now() - started),
    config: { projects, meetingsPerProject, seed, count: corpus.count, graphEnabled, graphLimit, processOrder, duplicateReplay, dbPath: process.env.PERRY_DB_PATH },
    corpus: { arcSummaries: corpus.expected.arcSummaries, expectedOwnershipChanges: corpus.expected.ownershipChangeCount },
    brain: {
      processedMeetings: countMeetingRecords("processed"),
      flushedFtsRows,
      decisions: decisions.length,
      actions: actions.length,
      decisionPassRate: passRate(decisionChecks),
      actionPassRate: passRate(actionChecks),
      searchPassRate: passRate(searchChecks),
      ownershipPassRate: passRate(ownershipChecks),
      actionOwnerPassRate: passRate(actionOwnerChecks),
      duplicateReplayPassRate: passRate(duplicateChecks),
      ownershipChanges: insights.counts.ownershipChanges,
    },
    multiplayer: {
      users: multiplayer.users.length,
      issues: multiplayer.issues.length,
      pivots: multiplayer.pivots.length,
      openIssues: multiplayer.issues.filter((issue) => issue.status === "open").length,
    },
    latency: {
      ingestMs: summarizeTimings(ingestTimings),
      searchMs: summarizeTimings(searchTimings),
      graphDrainMs: graph.enabled ? round(graphTimings.drainMs) : undefined,
      graphReplayMs: summarizeTimings(graphTimings.replayMs),
      graphSearchMs: summarizeTimings(graphTimings.searchMs),
    },
    robustness: {
      processOrder,
      duplicateReplayChecks: duplicateChecks,
    },
    graph,
    failureSummary: summarizeFailures(failures),
    sampleFailures: failures.slice(0, 50),
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (failures.length > 0) process.exitCode = 2;
}

function orderItems(items, order, seed) {
  if (order === "reverse") return [...items].reverse();
  if (order === "shuffle") return deterministicShuffle(items, seed);
  return [...items];
}

function deterministicShuffle(items, seed) {
  const output = [...items];
  let state = seed >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}
function failure(type, id, message) {
  return { type, id, message };
}

function containsNormalized(haystack, needle) {
  return normalizeComparable(haystack).includes(normalizeComparable(needle));
}

function normalizeComparable(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function summarizeFailures(failures) {
  return failures.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function passRate(checks) {
  if (!checks.length) return 1;
  return roundRatio(checks.filter((check) => check.passed).length / checks.length);
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000;
}

function summarizeTimings(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, min: round(sorted[0]), p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), max: round(sorted[sorted.length - 1]), avg: round(values.reduce((sum, value) => sum + value, 0) / values.length) };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function writeJson(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Company Brain Arc Evaluation",
    "",
    `- OK: ${output.ok}`,
    `- Meetings: ${output.config.count}`,
    `- Projects: ${output.config.projects}`,
    `- Meetings per project: ${output.config.meetingsPerProject}`,
    `- Elapsed: ${output.elapsedMs} ms`,
    "",
    "## Brain",
    "",
    ...Object.entries(output.brain).map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`),
    "",
    "## Latency",
    "",
    ...Object.entries(output.latency).filter(([, value]) => value !== undefined).map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`),
    "",
    "## Failure Summary",
    "",
    ...(Object.keys(output.failureSummary).length ? Object.entries(output.failureSummary).map(([key, value]) => `- ${key}: ${value}`) : ["- none"]),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
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