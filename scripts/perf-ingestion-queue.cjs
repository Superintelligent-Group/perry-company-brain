const { performance } = require("node:perf_hooks");
const { syntheticMeetingNote } = require("./perf-data.cjs");
const {
  drainGranolaIngestionJobs,
  enqueueGranolaIngestionJob,
  getIngestionQueueSnapshot,
} = require("../dist/ingestion/queue.js");
const { countApprovals, withAuditSuppressed } = require("../dist/store/index.js");

process.env.PERRY_DB_PATH ||= ":memory:";

const count = Number(process.env.PERRY_PERF_QUEUE_COUNT ?? process.argv[2] ?? 1000);
const suppressAudit = process.env.PERRY_PERF_AUDIT !== "on";
const steps = [];

function timed(name, fn, ops) {
  const start = performance.now();
  const result = fn();
  steps.push({ name, ms: performance.now() - start, ops });
  return result;
}

async function timedAsync(name, fn, ops) {
  const start = performance.now();
  const result = await fn();
  steps.push({ name, ms: performance.now() - start, ops });
  return result;
}

function runMaybeAuditSuppressed(fn) {
  return suppressAudit ? withAuditSuppressed(fn) : fn();
}

async function main() {
  console.log("Perry ingestion queue benchmark");
  console.log(`DB: ${process.env.PERRY_DB_PATH}`);
  console.log(`Jobs: ${count}`);
  console.log(`Audit: ${suppressAudit ? "suppressed" : "on"}`);
  console.log("");

  timed(
    "enqueue unique jobs",
    () =>
      runMaybeAuditSuppressed(() => {
        for (let index = 0; index < count; index += 1) {
          enqueueGranolaIngestionJob(syntheticMeetingNote(index));
        }
      }),
    count
  );

  timed(
    "dedupe existing jobs",
    () => {
      for (let index = 0; index < count; index += 1) {
        enqueueGranolaIngestionJob(syntheticMeetingNote(index));
      }
    },
    count
  );

  const beforeDrain = getIngestionQueueSnapshot({ limit: 0 }).stats;
  const drained = await timedAsync("drain to approval queue", () => drainGranolaIngestionJobs(count), count);
  const afterDrain = getIngestionQueueSnapshot({ limit: 0 }).stats;

  for (const step of steps) {
    const rate = step.ops / (step.ms / 1000);
    console.log(`${step.name.padEnd(26)} ${step.ms.toFixed(2).padStart(10)}ms ${Math.round(rate).toLocaleString()} ops/sec`);
  }

  console.log("");
  console.log(`Before drain: ${JSON.stringify(beforeDrain)}`);
  console.log(`Drain result: ${JSON.stringify(drained)}`);
  console.log(`After drain: ${JSON.stringify(afterDrain)}`);
  console.log(`Pending approvals: ${countApprovals("pending")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
