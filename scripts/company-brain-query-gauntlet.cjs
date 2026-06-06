const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const {
  closeBrainStore,
  countMeetingRecords,
  flushFtsQueue,
  listActionItems,
  listDecisions,
} = require("../dist/store/meeting-store.js");
const { parseOwnershipDecision } = require("../dist/brain/insights.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");
const {
  getQueryContext,
  queryChangedSince,
  queryConflicts,
  queryDecisionHistory,
  queryOwnerLoad,
  queryProjectState,
  queryStaleActions,
} = require("../dist/brain/queries.js");

const args = parseArgs(process.argv.slice(2));
const corpusPath = args.corpus || join("tests", "fixtures", "generated-company-scenarios.json");
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const querySearchLimit = Math.min(Math.max(Math.trunc(Number(args["search-limit"] || 25)), 1), 100);
const duplicateThemeThreshold = Math.max(2, Math.trunc(Number(args["duplicate-theme-threshold"] || 10)));
const staleActionDays = Math.max(1, Math.trunc(Number(args["stale-action-days"] || 14)));
const now = args.now || "2026-07-01T00:00:00.000Z";
const since = args.since || "2026-05-01T00:00:00.000Z";
const skipIngest = args["skip-ingest"] === "true" || args["reuse-db"] === "true";

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_SQLITE_JOURNAL_MODE ||= "MEMORY";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = "false";

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const ingestTimings = [];
  const ingestFailures = [];

  if (!skipIngest) {
    for (const item of corpus) {
      const ingestStarted = performance.now();
      const result = await processGranolaZapierPayload(item.payload, { force: true });
      ingestTimings.push(performance.now() - ingestStarted);
      if (result.record.status !== "processed") ingestFailures.push({ id: item.id, status: result.record.status });
    }
  }

  const flushedFtsRows = flushFtsQueue(1_000_000);
  const context = getQueryContext(1_000_000);
  const cases = buildCases(context);
  const evaluated = cases.map((item) => evaluateCase(item, context));
  const failures = evaluated.filter((item) => !item.passed);
  const output = {
    ok: ingestFailures.length === 0 && failures.length === 0,
    elapsedMs: round(performance.now() - started),
    corpusPath,
    config: {
      querySearchLimit,
      duplicateThemeThreshold,
      staleActionDays,
      now,
      since,
      dbPath: process.env.PERRY_DB_PATH,
      skipIngest,
    },
    ingest: {
      count: corpus.length,
      skipped: skipIngest,
      processedMeetings: countMeetingRecords("processed"),
      flushedFtsRows,
      latencyMs: summarizeTimings(ingestTimings),
      failures: ingestFailures.slice(0, 25),
    },
    stored: {
      meetings: context.meetings.length,
      decisions: context.decisions.length,
      actions: context.actions.length,
    },
    queryGauntlet: {
      caseCount: evaluated.length,
      passRate: passRate(evaluated),
      cases: evaluated,
      failureSummary: summarizeFailures(failures),
      sampleFailures: failures.slice(0, 25),
    },
  };

  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  closeBrainStore(process.env.PERRY_DB_PATH);
  if (!output.ok) process.exitCode = 2;
}

function buildCases(context) {
  const cases = [];
  for (const project of topProjects(context).slice(0, 6)) {
    cases.push({ type: "project-state", label: `project-state:${project}`, input: { project } });
  }
  for (const owner of topOwners(context).slice(0, 6)) {
    cases.push({ type: "owner-load", label: `owner-load:${owner}`, input: { owner } });
  }
  for (const subject of ownershipSubjects(context).slice(0, 6)) {
    cases.push({ type: "decision-history", label: `decision-history:${subject}`, input: { subject } });
  }
  cases.push({ type: "stale-actions", label: "stale-actions", input: {} });
  cases.push({ type: "conflicts", label: "conflicts", input: {} });
  cases.push({ type: "changed-since", label: "changed-since", input: { since } });
  return cases;
}

function evaluateCase(testCase, context) {
  const started = performance.now();
  try {
    if (testCase.type === "project-state") {
      const result = queryProjectState({ project: testCase.input.project, searchLimit: querySearchLimit }, context);
      const evidenceIds = [
        ...result.recentMeetings.map((item) => item.id),
        ...result.recentDecisions.map((item) => item.id),
        ...result.openActions.map((item) => item.id),
        ...result.searchResults.map((item) => item.id),
      ];
      return finish(testCase, started, result, result.counts.meetings + result.counts.decisions + result.counts.actions > 0 && evidenceIds.length > 0, evidenceIds);
    }

    if (testCase.type === "owner-load") {
      const result = queryOwnerLoad(testCase.input.owner, context, { now, staleActionDays });
      const evidenceIds = result.actions.map((item) => item.id);
      return finish(testCase, started, result, result.openActions > 0 && evidenceIds.length > 0, evidenceIds);
    }

    if (testCase.type === "decision-history") {
      const result = queryDecisionHistory(testCase.input.subject, context);
      const evidenceIds = result.decisions.map((item) => item.decision.id);
      return finish(testCase, started, result, result.decisions.length > 0 && Boolean(result.currentOwner) && evidenceIds.length > 0, evidenceIds);
    }

    if (testCase.type === "stale-actions") {
      const result = queryStaleActions(context, { now, staleActionDays });
      const evidenceIds = result.actions.map((item) => item.id);
      const expectedStale = context.actions.some((action) => action.status === "open" && action.createdAt < now);
      return finish(testCase, started, result, !expectedStale || evidenceIds.length > 0, evidenceIds);
    }

    if (testCase.type === "conflicts") {
      const result = queryConflicts(context, { duplicateThemeThreshold });
      const evidenceIds = result.flatMap((item) => item.decisionIds);
      const expectedDuplicate = hasDuplicateDecisionTheme(context, duplicateThemeThreshold);
      return finish(testCase, started, result, !expectedDuplicate || evidenceIds.length > 0, evidenceIds);
    }

    if (testCase.type === "changed-since") {
      const result = queryChangedSince(testCase.input.since, context);
      const evidenceIds = [
        ...result.meetings.map((item) => item.id),
        ...result.decisions.map((item) => item.id),
        ...result.actions.map((item) => item.id),
      ];
      return finish(testCase, started, result, evidenceIds.length > 0, evidenceIds);
    }

    return finish(testCase, started, undefined, false, [], `Unknown case type ${testCase.type}`);
  } catch (error) {
    return finish(testCase, started, undefined, false, [], error instanceof Error ? error.message : String(error));
  }
}

function finish(testCase, started, result, passed, evidenceIds, error) {
  return {
    type: testCase.type,
    label: testCase.label,
    passed,
    elapsedMs: round(performance.now() - started),
    evidenceCount: evidenceIds.length,
    evidenceIds: unique(evidenceIds).slice(0, 25),
    resultSummary: summarizeResult(testCase.type, result),
    error,
  };
}

function summarizeResult(type, result) {
  if (!result) return undefined;
  if (type === "project-state") return { counts: result.counts, topOwners: result.owners.slice(0, 5), searchResults: result.searchResults.length };
  if (type === "owner-load") return { openActions: result.openActions, overdueActions: result.overdueActions, staleActions: result.staleActions, projects: result.projects.slice(0, 5) };
  if (type === "decision-history") return { decisions: result.decisions.length, currentOwner: result.currentOwner };
  if (type === "stale-actions") return { staleActionDays: result.staleActionDays, actions: result.actions.length };
  if (type === "conflicts") return { conflicts: result.length, types: countBy(result.map((item) => item.type)) };
  if (type === "changed-since") return { meetings: result.meetings.length, decisions: result.decisions.length, actions: result.actions.length };
  return result;
}

function topProjects(context) {
  const known = ["Perry", "Wallace", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory", "Context Engine", "Customer Brain"];
  return known
    .map((project) => ({ project, count: context.meetings.filter((meeting) => containsNormalized(meeting.title, project)).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project))
    .map((item) => item.project);
}

function topOwners(context) {
  const counts = new Map();
  for (const action of context.actions) {
    if (!action.owner || action.status !== "open") continue;
    counts.set(action.owner, (counts.get(action.owner) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([owner]) => owner);
}

function ownershipSubjects(context) {
  const counts = new Map();
  for (const decision of context.decisions) {
    const parsed = parseOwnershipDecision(decision);
    if (!parsed) continue;
    counts.set(parsed.subject, (counts.get(parsed.subject) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([subject]) => subject);
}

function hasDuplicateDecisionTheme(context, threshold) {
  const counts = new Map();
  for (const decision of context.decisions) {
    const key = analyticsKey(decision.text);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].some((count) => count >= threshold);
}

function analyticsKey(value) {
  const stop = new Set(["a", "an", "and", "by", "for", "from", "in", "is", "of", "on", "the", "to", "with"]);
  return normalizeComparable(value)
    .split(/\s+/u)
    .filter((part) => part.length > 1 && !stop.has(part) && !/^\d+$/u.test(part))
    .slice(0, 8)
    .join(" ");
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

function passRate(items) {
  if (!items.length) return 1;
  return Math.round((items.filter((item) => item.passed).length / items.length) * 10000) / 10000;
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, output) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Company Brain Query Gauntlet",
    "",
    `- OK: ${output.ok}`,
    `- Corpus: ${output.corpusPath}`,
    `- Skip ingest: ${output.config.skipIngest}`,
    `- Meetings: ${output.stored.meetings}`,
    `- Decisions: ${output.stored.decisions}`,
    `- Actions: ${output.stored.actions}`,
    `- Query cases: ${output.queryGauntlet.caseCount}`,
    `- Pass rate: ${output.queryGauntlet.passRate}`,
    "",
    "## Cases",
    "",
    ...output.queryGauntlet.cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.label}: evidence=${item.evidenceCount}, ${item.elapsedMs} ms`),
    "",
    "## Failures",
    "",
    ...(output.queryGauntlet.sampleFailures.length ? output.queryGauntlet.sampleFailures.map((item) => `- ${item.label}: ${item.error || JSON.stringify(item.resultSummary)}`) : ["- none"]),
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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