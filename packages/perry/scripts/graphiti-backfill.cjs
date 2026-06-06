const { enqueueGraphBackfillPage } = require("../dist/graph/backfill.js");
const { drainGraphSyncJobs, getGraphSyncQueueSnapshot } = require("../dist/graph/queue.js");

const args = parseArgs(process.argv.slice(2));
const batchSize = Number(args.batch ?? process.env.PERRY_GRAPH_BACKFILL_BATCH ?? 500);
const drain = args.drain === "true";
const drainLimit = Number(args.drainLimit ?? process.env.PERRY_GRAPH_BACKFILL_DRAIN_LIMIT ?? batchSize);

let offset = Number(args.offset ?? 0);
let scanned = 0;
let queued = 0;
let skipped = 0;
let drainedProcessed = 0;
let drainedFailed = 0;
const startedAt = performance.now();

for (;;) {
  const result = enqueueGraphBackfillPage({ limit: batchSize, offset });
  scanned += result.scanned;
  queued += result.queued;
  skipped += result.skipped;
  offset += result.scanned;
  if (result.scanned === 0) break;
}

async function main() {
  if (drain) {
    for (;;) {
      const result = await drainGraphSyncJobs(drainLimit);
      drainedProcessed += result.processed;
      drainedFailed += result.failed;
      if (result.processed + result.failed === 0) break;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  console.log("Perry Graphiti backfill");
  console.log(`Batch size: ${batchSize}`);
  console.log(`Scanned meetings: ${scanned}`);
  console.log(`Queued graph sync jobs: ${queued}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Drain enabled: ${drain}`);
  if (drain) {
    console.log(`Drained processed: ${drainedProcessed}`);
    console.log(`Drained failed: ${drainedFailed}`);
  }
  console.log(`Queue stats: ${JSON.stringify(getGraphSyncQueueSnapshot({ limit: 0 }).stats)}`);
  console.log(`Elapsed: ${elapsedMs.toFixed(1)}ms`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      output[key] = "true";
    } else {
      output[key] = next;
      index += 1;
    }
  }
  return output;
}
