const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const {
  closeBrainStore,
  countMeetingRecords,
  flushFtsQueue,
  listActionItems,
  listDecisions,
  listGraphChangeSets,
  searchBrain,
} = require("../dist/store/meeting-store.js");
const { drainGraphSyncJobs } = require("../dist/graph/queue.js");
const { replayGraphChangeSet } = require("../dist/graph/change-set-replay.js");
const { searchGraphMemory } = require("../dist/graph/memory.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const { getCompanyBrainHealth } = require("../dist/brain/health.js");
const { getCompanyBrainAnalytics } = require("../dist/brain/analytics.js");

const args = parseArgs(process.argv.slice(2));
const corpusPath = args.corpus || join("tests", "fixtures", "generated-company-scenarios.json");
const graphEnabled = args.graph === "true";
const replayEnabled = graphEnabled && args.replay !== "false";
const graphLimit = Math.max(0, Number(args["graph-limit"] || args.drain || 10));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const searchLimit = Math.min(Math.max(Math.trunc(Number(args["search-limit"] || 10)), 1), 100);
const retrySearchLimit = Math.min(
  Math.max(Math.trunc(Number(args["retry-search-limit"] || args["deep-search-limit"] || 100)), searchLimit),
  100
);
const skipIngest = args["skip-ingest"] === "true" || args["reuse-db"] === "true";

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = graphEnabled ? "true" : "false";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs-generated";
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
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const failures = [];
  const privacyFailures = [];
  const ingestTimings = [];
  const searchTimings = [];
  const searchRetryTimings = [];
  const graphTimings = { drainMs: 0, replayMs: [], searchMs: [] };

  if (!skipIngest) {
    for (const item of corpus) {
      const ingestStarted = performance.now();
      const result = await processGranolaZapierPayload(item.payload, { force: true });
      ingestTimings.push(performance.now() - ingestStarted);
      if (result.record.status !== "processed") failures.push(failure("ingest", item.id, `status ${result.record.status}`));
      const announcement = result.announcement || "";
      for (const marker of item.expected.expectedPrivacyMarkers || []) {
        if (announcement.includes(marker)) {
          const event = failure("privacy", item.id, `leaked ${marker} into Discord announcement`);
          privacyFailures.push(event);
        }
      }
    }
  }

  const flushedFtsRows = flushFtsQueue(1_000_000);
  const decisions = listDecisions(1_000_000).map((item) => item.text);
  const actions = listActionItems(1_000_000).map((item) => ({ owner: item.owner, text: item.text }));
  const decisionChecks = [];
  const actionChecks = [];
  const searchChecks = [];

  for (const item of corpus) {
    for (const expected of item.expected.decisions || []) {
      const passed = decisions.includes(expected);
      decisionChecks.push({ id: item.id, passed });
      if (!passed) failures.push(failure("decision", item.id, `missing decision '${expected}'`));
    }
    for (const expected of item.expected.actions || []) {
      const passed = actions.some((action) => action.owner === expected.owner && action.text === expected.text);
      actionChecks.push({ id: item.id, passed });
      if (!passed) failures.push(failure("action", item.id, `missing action '${expected.owner}: ${expected.text}'`));
    }
    for (const expected of item.expected.search || []) {
      const searchStarted = performance.now();
      const firstResults = searchBrain(expected.query, searchLimit);
      searchTimings.push(performance.now() - searchStarted);
      const firstHaystack = firstResults.map((result) => `${result.title}\n${result.snippet}`).join("\n");
      const firstPassed = containsNormalized(firstHaystack, expected.mustContain);
      let results = firstResults;
      let passed = firstPassed;
      let retried = false;
      if (!firstPassed && retrySearchLimit > searchLimit) {
        const retryStarted = performance.now();
        results = searchBrain(expected.query, retrySearchLimit);
        searchRetryTimings.push(performance.now() - retryStarted);
        retried = true;
        const retryHaystack = results.map((result) => `${result.title}\n${result.snippet}`).join("\n");
        passed = containsNormalized(retryHaystack, expected.mustContain);
      }
      searchChecks.push({
        id: item.id,
        query: expected.query,
        passed,
        firstPassed,
        retried,
        resultCount: results.length,
        firstResultCount: firstResults.length,
      });
      if (!passed) failures.push(failure("search", item.id, `search '${expected.query}' missing '${expected.mustContain}'`));
    }
  }

  let graph = { enabled: graphEnabled };
  if (graphEnabled) {
    const drainStarted = performance.now();
    const drained = await drainGraphSyncJobs(graphLimit || corpus.length);
    graphTimings.drainMs = performance.now() - drainStarted;
    const replayChecks = [];
    if (replayEnabled) {
      const changeSets = listGraphChangeSets({ limit: Math.max(corpus.length * 2, 50) });
      for (const item of corpus.slice(0, graphLimit || corpus.length)) {
        const meetingId = `granola:${item.payload.note_id}`;
        const changeSet = changeSets.find((record) => record.meetingId === meetingId);
        if (!changeSet) {
          replayChecks.push({ id: item.id, passed: false, error: "missing change set" });
          failures.push(failure("graph_replay", item.id, "missing graph change set"));
          continue;
        }
        try {
          const replayStarted = performance.now();
          const replay = await replayGraphChangeSet(changeSet.id);
          graphTimings.replayMs.push(performance.now() - replayStarted);
          replayChecks.push({ id: item.id, changeSetId: changeSet.id, passed: replay.diff.passed, expected: replay.diff.expected, missing: replay.diff.missing, errors: replay.diff.errors });
          if (!replay.diff.passed) failures.push(failure("graph_replay", item.id, "replay diff failed"));
        } catch (error) {
          replayChecks.push({ id: item.id, changeSetId: changeSet.id, passed: false, error: errorMessage(error) });
          failures.push(failure("graph_replay", item.id, `replay failed ${errorMessage(error)}`));
        }
      }
    }
    const graphSearchChecks = [];
    for (const item of corpus.slice(0, Math.min(graphLimit || corpus.length, corpus.length))) {
      const expected = item.expected.search?.[0];
      if (!expected) continue;
      const graphSearchStarted = performance.now();
      const response = await searchGraphMemory(expected.query, 5);
      graphTimings.searchMs.push(performance.now() - graphSearchStarted);
      const haystack = response.results.map((result) => `${result.name || ""}\n${result.fact || ""}`).join("\n");
      const passed = containsNormalized(haystack, expected.mustContain);
      graphSearchChecks.push({ id: item.id, query: expected.query, passed, resultCount: response.results.length, error: response.error });
      if (!passed) failures.push(failure("graph_search", item.id, `graph search '${expected.query}' missing '${expected.mustContain}'`));
    }
    graph = { enabled: true, drained, replayChecks, graphSearchChecks };
    if (drained.failed > 0) failures.push(failure("graph_drain", "graph", `graph drain failed ${drained.failed} job(s)`));
  }

  failures.push(...privacyFailures);
  const output = {
    ok: failures.length === 0,
    elapsedMs: round(performance.now() - started),
    corpusPath,
    count: corpus.length,
    dbPath: process.env.PERRY_DB_PATH,
    searchLimit,
    retrySearchLimit,
    skipIngest,
    flushedFtsRows,
    processedMeetings: countMeetingRecords("processed"),
    passRates: {
      decisions: passRate(decisionChecks),
      actions: passRate(actionChecks),
      search: passRate(searchChecks),
      searchFirstPass: passRate(searchChecks.map((check) => ({ passed: check.firstPassed }))),
      privacy: corpus.length ? roundRatio((corpus.length - privacyFailures.length) / corpus.length) : 1,
      graphReplay: graph.enabled && graph.replayChecks?.length ? passRate(graph.replayChecks) : undefined,
      graphSearch: graph.enabled && graph.graphSearchChecks?.length ? passRate(graph.graphSearchChecks) : undefined,
    },
    latency: {
      ingestMs: summarizeTimings(ingestTimings),
      searchMs: summarizeTimings(searchTimings),
      searchRetryMs: summarizeTimings(searchRetryTimings),
      graphDrainMs: graph.enabled ? round(graphTimings.drainMs) : undefined,
      graphReplayMs: summarizeTimings(graphTimings.replayMs),
      graphSearchMs: summarizeTimings(graphTimings.searchMs),
    },
    failureSummary: summarizeFailures(failures),
    health: summarizeHealth(getCompanyBrainHealth(1_000_000)),
    analytics: summarizeAnalytics(getCompanyBrainAnalytics(1_000_000)),
    graph,
    sampleFailures: failures.slice(0, 50),
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeReport(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (failures.length > 0) process.exitCode = 2;
}

function summarizeAnalytics(report) {
  return {
    counts: report.counts,
    qualitySignals: report.qualitySignals,
    ownerWorkload: report.ownerWorkload.slice(0, 10),
    decisionThemes: report.decisionThemes.slice(0, 10),
    actionThemes: report.actionThemes.slice(0, 10),
    meetingTitleClusters: report.meetingTitleClusters.slice(0, 10),
  };
}

function summarizeHealth(report) {
  return {
    counts: report.counts,
    topIssues: report.issues.slice(0, 25),
  };
}

function containsNormalized(haystack, needle) {
  const normalizedHaystack = normalizeComparable(haystack);
  const normalizedNeedle = normalizeComparable(needle);
  if (normalizedHaystack.includes(normalizedNeedle)) return true;
  return compactComparable(normalizedHaystack).includes(compactComparable(normalizedNeedle));
}

function normalizeComparable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactComparable(value) {
  return String(value || "").replace(/\s+/gu, "");
}
function failure(type, id, message) {
  return { type, id, message };
}

function summarizeFailures(failures) {
  return failures.reduce((acc, item) => {
    const type = item.type || "unknown";
    acc[type] = (acc[type] || 0) + 1;
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
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function writeReport(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Generated Scenario Evaluation",
    "",
    `- Corpus: ${output.corpusPath}`,
    `- Count: ${output.count}`,
    `- OK: ${output.ok}`,
    `- Elapsed: ${output.elapsedMs} ms`,
    `- Skip ingest: ${output.skipIngest}`,
    "",
    "## Pass Rates",
    "",
    ...Object.entries(output.passRates).filter(([, value]) => value !== undefined).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Latency",
    "",
    ...Object.entries(output.latency).filter(([, value]) => value !== undefined).map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`),
    "",
    "## Failure Summary",
    "",
    ...(Object.keys(output.failureSummary).length ? Object.entries(output.failureSummary).map(([key, value]) => `- ${key}: ${value}`) : ["- none"]),
    "",
    "## Brain Health",
    "",
    `- issues: ${output.health.counts.issueCount}`,
    `- critical: ${output.health.counts.critical}`,
    `- warning: ${output.health.counts.warning}`,
    `- unownedOpenActions: ${output.health.counts.unownedOpenActions}`,
    `- overdueOpenActions: ${output.health.counts.overdueOpenActions}`,
    `- staleOpenActions: ${output.health.counts.staleOpenActions}`,
    `- ownershipChurnSubjects: ${output.health.counts.ownershipChurnSubjects}`,
    `- ownershipConflicts: ${output.health.counts.ownershipConflicts}`,
    "",
    "## Analytics",
    "",
    `- owner count: ${output.analytics.counts.owners}`,
    `- open action rate: ${output.analytics.qualitySignals.openActionRate}`,
    `- unowned action rate: ${output.analytics.qualitySignals.unownedActionRate}`,
    `- top owner action share: ${output.analytics.qualitySignals.topOwnerActionShare}`,
    `- repeated decision theme rate: ${output.analytics.qualitySignals.repeatedDecisionThemeRate}`,
    `- repeated action theme rate: ${output.analytics.qualitySignals.repeatedActionThemeRate}`,
    "",
    "## Sample Failures",
    "",
    ...(output.sampleFailures.length ? output.sampleFailures.map((item) => `- ${item.type} ${item.id}: ${item.message}`) : ["- none"]),
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
