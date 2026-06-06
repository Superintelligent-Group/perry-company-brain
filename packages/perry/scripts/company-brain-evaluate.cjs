const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  closeBrainStore,
  flushFtsQueue,
  listActionItems,
  listDecisions,
  searchBrain,
} = require("../dist/store/index.js");
const {
  drainGraphSyncJobs,
  getFullGraphSyncQueueSnapshot,
} = require("../dist/graph/queue.js");
const { searchGraphMemory } = require("../dist/graph/memory.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");

const args = parseArgs(process.argv.slice(2));
const corpusPath = args.corpus || join("tests", "fixtures", "company-brain-corpus.json");
const graphEnabled = args.graph === "true";

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED = graphEnabled ? "true" : "false";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs";
process.env.PERRY_GRAPHITI_TIMEOUT_MS ||= "120000";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const startedAt = performance.now();
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const failures = [];

  for (const item of corpus) {
    const result = await processGranolaZapierPayload(item.payload, { force: true });
    if (result.record.status !== "processed") {
      failures.push(`${item.id}: expected processed meeting, got ${result.record.status}`);
    }
    if (!String(result.discordMessageUrl || "").includes("discord.example/perry-dry-run")) {
      failures.push(`${item.id}: expected dry-run Discord URL`);
    }
  }

  const flushed = flushFtsQueue(100_000);
  const decisions = listDecisions(10_000).map((item) => item.text);
  const actions = listActionItems(10_000).map((item) => ({ owner: item.owner, text: item.text }));
  const searchChecks = [];

  for (const item of corpus) {
    for (const expected of item.expected.decisions) {
      if (!decisions.includes(expected)) failures.push(`${item.id}: missing decision '${expected}'`);
    }
    for (const expected of item.expected.actions) {
      if (!actions.some((action) => action.owner === expected.owner && action.text === expected.text)) {
        failures.push(`${item.id}: missing action '${expected.owner || "unowned"}: ${expected.text}'`);
      }
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
  if (graphEnabled) {
    const beforeDrain = getFullGraphSyncQueueSnapshot({ limit: 5 });
    const drained = await drainGraphSyncJobs(Number(args.drain || corpus.length));
    const afterDrain = getFullGraphSyncQueueSnapshot({ limit: 5 });
    const graphSearchChecks = [];
    for (const item of corpus) {
      for (const expected of item.expected.search.slice(0, 1)) {
        const response = await searchGraphMemory(expected.query, 5);
        const haystack = response.results.map((result) => `${result.name || ""}\n${result.fact || ""}`).join("\n");
        graphSearchChecks.push({
          id: item.id,
          query: expected.query,
          mustContain: expected.mustContain,
          passed: haystack.toLowerCase().includes(expected.mustContain.toLowerCase()),
          resultCount: response.results.length,
          error: response.error,
        });
      }
    }
    graph = {
      enabled: true,
      beforeDrain: beforeDrain.stats,
      drained,
      afterDrain: afterDrain.stats,
      graphSearchChecks,
    };
    if (drained.failed > 0) failures.push(`graph drain failed ${drained.failed} job(s)`);
  }

  const output = {
    ok: failures.length === 0,
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    corpusPath,
    noteCount: corpus.length,
    flushedFtsRows: flushed,
    decisionCount: decisions.length,
    actionItemCount: actions.length,
    searchChecks,
    graph,
    failures,
  };
  console.log(JSON.stringify(output, null, 2));

  closeBrainStore(process.env.PERRY_DB_PATH);
  if (failures.length > 0) process.exitCode = 2;
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
