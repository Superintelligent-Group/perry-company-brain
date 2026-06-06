const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { closeBrainStore, searchBrain } = require("../dist/store/index.js");
const { getCompanyBrainAnalytics } = require("../dist/brain/analytics.js");

const args = parseArgs(process.argv.slice(2));
const limit = Math.max(1, Math.trunc(Number(args.limit || 100000)));
const searchLimit = Math.min(Math.max(Math.trunc(Number(args["search-limit"] || 25)), 1), 100);
const reportPath = args.report || "";
const markdownPath = args.markdown || "";

const report = getCompanyBrainAnalytics(limit);
const searchProbeQueries = probeQueries(report, Math.max(0, Math.trunc(Number(args["search-probes"] || 12))));
const searchProbes = searchProbeQueries.map((query) => {
  const started = performance.now();
  const results = searchBrain(query, searchLimit);
  return {
    query,
    resultCount: results.length,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    topTypes: countBy(results.map((result) => result.type)),
    topTitles: results.slice(0, 5).map((result) => result.title),
  };
});
const output = { ...report, search: { limit: searchLimit, probes: searchProbes } };

console.log(JSON.stringify(output, null, 2));
if (reportPath) writeJson(reportPath, output);
if (markdownPath) writeMarkdown(markdownPath, output);
closeBrainStore(process.env.PERRY_DB_PATH);

function probeQueries(report, limit) {
  return [
    ...report.decisionThemes.map((bucket) => bucket.key),
    ...report.actionThemes.map((bucket) => bucket.key),
    ...report.meetingTitleClusters.map((bucket) => bucket.key),
  ].filter(Boolean).slice(0, limit);
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

function writeMarkdown(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Company Brain Analytics",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Meetings: ${report.counts.meetings}`,
    `- Decisions: ${report.counts.decisions}`,
    `- Actions: ${report.counts.actions}`,
    `- Open actions: ${report.counts.openActions}`,
    `- Owners: ${report.counts.owners}`,
    `- Unowned actions: ${report.counts.unownedActions}`,
    "",
    "## Quality Signals",
    "",
    `- Open action rate: ${report.qualitySignals.openActionRate}`,
    `- Unowned action rate: ${report.qualitySignals.unownedActionRate}`,
    `- Top owner action share: ${report.qualitySignals.topOwnerActionShare}`,
    `- Repeated decision theme rate: ${report.qualitySignals.repeatedDecisionThemeRate}`,
    `- Repeated action theme rate: ${report.qualitySignals.repeatedActionThemeRate}`,
    "",
    "## Owner Workload",
    "",
    ...(report.ownerWorkload.length ? report.ownerWorkload.slice(0, 20).map((item) => `- ${item.owner}: ${item.openActions} open actions, share=${item.actionShare}`) : ["- none"]),
    "",
    "## Decision Themes",
    "",
    ...(report.decisionThemes.length ? report.decisionThemes.slice(0, 20).map((item) => `- ${item.key}: ${item.count}`) : ["- none"]),
    "",
    "## Action Themes",
    "",
    ...(report.actionThemes.length ? report.actionThemes.slice(0, 20).map((item) => `- ${item.key}: ${item.count}`) : ["- none"]),
    "",
    "## Search Probes",
    "",
    ...(report.search.probes.length ? report.search.probes.map((item) => `- ${item.query}: ${item.resultCount} result(s), ${item.elapsedMs} ms`) : ["- none"]),
    "",
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