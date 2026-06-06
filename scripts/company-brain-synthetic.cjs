const {
  closeBrainStore,
  countMeetingRecords,
  flushFtsQueue,
  listActionItems,
  listDecisions,
  searchBrain,
} = require("../dist/store/meeting-store.js");
const {
  drainGraphSyncJobs,
  getFullGraphSyncQueueSnapshot,
} = require("../dist/graph/queue.js");
const { searchGraphMemory } = require("../dist/graph/memory.js");
const { getCompanyBrainInsights } = require("../dist/brain/insights.js");
const { projectMultiplayerState } = require("../dist/graph/multiplayer-projection.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const { createSyntheticCompanyCorpus } = require("./synthetic-company-data.cjs");

const args = parseArgs(process.argv.slice(2));
const count = Number(args.count || 250);
const seed = Number(args.seed || 42);
const graphEnabled = args.graph === "true";
const graphSample = Math.max(0, Number(args["graph-sample"] || 5));
const searchSample = Math.max(1, Number(args["search-sample"] || 100));

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = graphEnabled ? "true" : "false";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs-synthetic";
process.env.PERRY_GRAPHITI_TIMEOUT_MS ||= "120000";
process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES ||= "false";
process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT ||= "false";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const startedAt = performance.now();
  const corpus = createSyntheticCompanyCorpus({ count, seed, edgeCases: args["edge-cases"] !== "false" });
  const failures = [];
  const privacyFailures = [];
  const duplicateChecks = [];
  let processed = 0;

  for (const item of corpus.items) {
    const result = await processGranolaZapierPayload(item.payload, { force: true });
    processed += 1;
    if (result.record.status !== "processed") failures.push(`${item.id}: status ${result.record.status}`);
    const announcement = result.announcement || "";
    if (announcement.includes("PRIVATE_SYNTHETIC_MARKER")) privacyFailures.push(`${item.id}: private notes leaked to announcement`);
    if (announcement.includes("TRANSCRIPT_SYNTHETIC_MARKER")) privacyFailures.push(`${item.id}: transcript leaked to announcement`);
  }

  for (const payload of corpus.duplicatePayloads) {
    const duplicate = await processGranolaZapierPayload(payload);
    duplicateChecks.push({
      id: payload.note_id,
      duplicate: duplicate.duplicate,
      status: duplicate.record.status,
    });
    if (!duplicate.duplicate) failures.push(`${payload.note_id}: duplicate was not detected`);
  }

  const flushedFtsRows = flushFtsQueue(1_000_000);
  const decisions = listDecisions(1_000_000).map((item) => item.text);
  const actions = listActionItems(1_000_000).map((item) => ({ owner: item.owner, text: item.text }));
  const evaluated = corpus.items.slice(0, Math.min(searchSample, corpus.items.length));
  const decisionChecks = [];
  const actionChecks = [];
  const searchChecks = [];

  for (const item of evaluated) {
    for (const expected of item.expected.decisions) {
      const passed = decisions.includes(expected);
      decisionChecks.push({ id: item.id, passed });
      if (!passed) failures.push(`${item.id}: missing decision '${expected}'`);
    }
    for (const expected of item.expected.actions) {
      const passed = actions.some((action) => action.owner === expected.owner && action.text === expected.text);
      actionChecks.push({ id: item.id, passed });
      if (!passed) failures.push(`${item.id}: missing action '${expected.owner || "unowned"}: ${expected.text}'`);
    }
    for (const expected of item.expected.search) {
      const results = searchBrain(expected.query, 10);
      const haystack = results.map((result) => `${result.title}\n${result.snippet}`).join("\n");
      const passed = haystack.includes(expected.mustContain);
      searchChecks.push({
        id: item.id,
        query: expected.query,
        mustContain: expected.mustContain,
        passed,
        resultCount: results.length,
      });
      if (!passed) failures.push(`${item.id}: search '${expected.query}' missing '${expected.mustContain}'`);
    }
  }

  let graph = { enabled: graphEnabled };
  if (graphEnabled && graphSample > 0) {
    const beforeDrain = getFullGraphSyncQueueSnapshot({ limit: 5 });
    const drained = await drainGraphSyncJobs(graphSample);
    const afterDrain = getFullGraphSyncQueueSnapshot({ limit: 5 });
    const graphSearchChecks = [];
    for (const item of corpus.items.slice(0, Math.min(graphSample, corpus.items.length))) {
      const expected = item.expected.search[0];
      const response = await searchGraphMemory(expected.query, 5);
      const haystack = response.results.map((result) => `${result.name || ""}\n${result.fact || ""}`).join("\n");
      graphSearchChecks.push({
        id: item.id,
        query: expected.query,
        passed: haystack.toLowerCase().includes(expected.mustContain.toLowerCase()),
        resultCount: response.results.length,
        error: response.error,
      });
    }
    graph = {
      enabled: true,
      sample: graphSample,
      beforeDrain: beforeDrain.stats,
      drained,
      afterDrain: afterDrain.stats,
      graphSearchChecks,
    };
    if (drained.failed > 0) failures.push(`graph drain failed ${drained.failed} job(s)`);
  }

  failures.push(...privacyFailures);
  const elapsedMs = performance.now() - startedAt;
  const multiplayer = projectMultiplayerState(1_000_000);
  const output = {
    ok: failures.length === 0,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    throughputMeetingsPerSecond: Math.round((processed / Math.max(elapsedMs / 1000, 0.001)) * 100) / 100,
    config: {
      count,
      seed,
      searchSample: evaluated.length,
      graphEnabled,
      graphSample,
      dbPath: process.env.PERRY_DB_PATH,
      includePrivateNotesInGraph: process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES === "true",
      includeTranscriptInGraph: process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT === "true",
    },
    corpus: {
      edgeCaseCounts: corpus.edgeCaseCounts,
      duplicateCheckCount: duplicateChecks.length,
      duplicateChecks: duplicateChecks.slice(0, 20),
    },
    brain: {
      processedMeetings: countMeetingRecords("processed"),
      flushedFtsRows,
      decisions: decisions.length,
      actionItems: actions.length,
      decisionPassRate: passRate(decisionChecks),
      actionPassRate: passRate(actionChecks),
      searchPassRate: passRate(searchChecks),
      searchChecks: searchChecks.slice(0, 20),
    },
    insights: summarizeInsights(getCompanyBrainInsights(1_000_000)),
    multiplayer: summarizeMultiplayer(multiplayer),
    graph,
    failures: failures.slice(0, 50),
  };

  console.log(JSON.stringify(output, null, 2));
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (failures.length > 0) process.exitCode = 2;
}

function passRate(checks) {
  if (checks.length === 0) return 1;
  return Math.round((checks.filter((check) => check.passed).length / checks.length) * 10000) / 10000;
}

function summarizeInsights(insights) {
  return {
    counts: insights.counts,
    ownership: insights.ownership.slice(0, 20),
    openActionsByOwner: insights.openActionsByOwner.slice(0, 10).map((item) => ({
      owner: item.owner,
      count: item.count,
      overdueOrDatedCount: item.overdueOrDatedCount,
    })),
    unownedOpenActionCount: insights.unownedOpenActions.length,
  };
}

function summarizeMultiplayer(multiplayer) {
  return {
    createdOrUpdated: multiplayer.createdOrUpdated,
    users: multiplayer.users.length,
    issues: multiplayer.issues.length,
    pivots: multiplayer.pivots.length,
    openIssues: multiplayer.issues.filter((issue) => issue.status === "open").length,
    issuesByOwner: multiplayer.issues.reduce((acc, issue) => {
      const owner = issue.owner || "unowned";
      acc[owner] = (acc[owner] || 0) + 1;
      return acc;
    }, {}),
    recentPivots: multiplayer.pivots.slice(0, 10),
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
