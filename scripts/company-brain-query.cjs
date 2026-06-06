const { closeBrainStore } = require("../dist/store/index.js");
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
const query = args.query || args._[0] || "help";
const context = query === "help" ? undefined : getQueryContext(Number(args.limit || 100000));
let output;

switch (query) {
  case "project-state":
    requireArg(args.project, "--project");
    output = queryProjectState({ project: args.project, searchLimit: Number(args["search-limit"] || 25) }, context);
    break;
  case "owner-load":
    requireArg(args.owner, "--owner");
    output = queryOwnerLoad(args.owner, context, {
      now: args.now,
      staleActionDays: args["stale-action-days"] ? Number(args["stale-action-days"]) : undefined,
    });
    break;
  case "decision-history":
    requireArg(args.subject, "--subject");
    output = queryDecisionHistory(args.subject, context);
    break;
  case "stale-actions":
    output = queryStaleActions(context, {
      now: args.now,
      staleActionDays: args["stale-action-days"] ? Number(args["stale-action-days"]) : undefined,
      owner: args.owner,
      project: args.project,
    });
    break;
  case "conflicts":
    output = queryConflicts(context, {
      duplicateThemeThreshold: args["duplicate-theme-threshold"] ? Number(args["duplicate-theme-threshold"]) : undefined,
    });
    break;
  case "changed-since":
    requireArg(args.since, "--since");
    output = queryChangedSince(args.since, context, { project: args.project });
    break;
  case "help":
    output = {
      queries: [
        "project-state --project Perry",
        "owner-load --owner Ada",
        "decision-history --subject 'Atlas retrieval'",
        "stale-actions --stale-action-days 14 [--owner Ada] [--project Atlas]",
        "conflicts --duplicate-theme-threshold 10",
        "changed-since --since 2026-05-01T00:00:00.000Z [--project Atlas]",
      ],
    };
    break;
  default:
    throw new Error(`Unknown query '${query}'`);
}

console.log(JSON.stringify(output, null, 2));
closeBrainStore(process.env.PERRY_DB_PATH);

function requireArg(value, name) {
  if (!value) throw new Error(`Missing required ${name}`);
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
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