const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { closeBrainStore } = require("../dist/store/index.js");
const { getCompanyBrainHealth } = require("../dist/brain/health.js");

const args = parseArgs(process.argv.slice(2));
const limit = Math.max(1, Math.trunc(Number(args.limit || 100000)));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";

const report = getCompanyBrainHealth(limit, {
  now: args.now,
  staleActionDays: args["stale-action-days"] ? Number(args["stale-action-days"]) : undefined,
  ownerLoadThreshold: args["owner-load-threshold"] ? Number(args["owner-load-threshold"]) : undefined,
  ownershipChurnThreshold: args["ownership-churn-threshold"] ? Number(args["ownership-churn-threshold"]) : undefined,
});

console.log(JSON.stringify(report, null, 2));
if (reportPath) writeJson(reportPath, report);
if (markdownPath) writeMarkdown(markdownPath, report);
closeBrainStore(process.env.PERRY_DB_PATH);
if (args["fail-on-critical"] === "true" && report.counts.critical > 0) process.exitCode = 2;

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Company Brain Health",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Decisions analyzed: ${report.counts.decisionsAnalyzed}`,
    `- Actions analyzed: ${report.counts.actionsAnalyzed}`,
    `- Issues: ${report.counts.issueCount}`,
    `- Critical: ${report.counts.critical}`,
    `- Warning: ${report.counts.warning}`,
    "",
    "## Counts",
    "",
    `- Unowned open actions: ${report.counts.unownedOpenActions}`,
    `- Overdue open actions: ${report.counts.overdueOpenActions}`,
    `- Stale open actions: ${report.counts.staleOpenActions}`,
    `- Owner load hotspots: ${report.counts.ownerLoadHotspots}`,
    `- Ownership churn subjects: ${report.counts.ownershipChurnSubjects}`,
    `- Ownership conflicts: ${report.counts.ownershipConflicts}`,
    "",
    "## Top Issues",
    "",
    ...(report.issues.length
      ? report.issues.slice(0, 50).map((issue) => `- ${issue.severity.toUpperCase()} ${issue.type}: ${issue.title} (${issue.sourceIds.join(", ")})`)
      : ["- none"]),
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