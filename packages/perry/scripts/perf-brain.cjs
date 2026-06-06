const { performance } = require("node:perf_hooks");
const { syntheticMeetingNote: note } = require("./perf-data.cjs");
const {
  createApproval,
  flushFtsQueue,
  insertBackfillApproval,
  insertBackfillApprovalBatch,
  insertBackfillMeeting,
  insertBackfillMeetingBatch,
  listActionItems,
  listApprovalSummaries,
  listApprovals,
  listDecisions,
  listMeetingRecords,
  meetingRecordFromNote,
  replaceMeetingKnowledge,
  searchBrain,
  upsertMeetingRecord,
  withAuditSuppressed,
  withBrainTransaction,
} = require("../dist/store/index.js");
const { extractKnowledge } = require("../dist/extraction/knowledge.js");

const count = Number(process.env.PERRY_PERF_COUNT ?? process.argv[2] ?? 1000);
process.env.PERRY_DB_PATH ||= ":memory:";
const auditMode = process.env.PERRY_PERF_AUDIT ?? "bulk-off";
const suppressAudit = auditMode === "bulk-off";
const backfillFastPath = process.env.PERRY_PERF_BACKFILL_FAST !== "false";
const backfillBatchSize = Number(process.env.PERRY_PERF_BATCH ?? 1000);

const steps = [];

function timed(name, fn, ops) {
  const start = performance.now();
  const result = fn();
  steps.push({ name, ms: performance.now() - start, ops });
  return result;
}

timed(
  "ingest meetings + extracted knowledge",
  () => {
    const run = () =>
      withBrainTransaction(() => {
      for (let index = 0; index < count; index += 1) {
        if (backfillFastPath) {
          const batch = [];
          for (let batchIndex = 0; batchIndex < backfillBatchSize && index < count; batchIndex += 1, index += 1) {
            const meetingNote = note(index);
            batch.push({
              record: {
                ...meetingRecordFromNote(meetingNote, "processed"),
                notionUrl: meetingNote.sourceUrl,
                discordMessageUrl: `https://discord.com/channels/synthetic/${index}`,
              },
              knowledge: extractKnowledge(meetingNote),
            });
          }
          index -= 1;
          insertBackfillMeetingBatch(batch);
        } else {
          const meetingNote = note(index);
          const record = {
            ...meetingRecordFromNote(meetingNote, "processed"),
            notionUrl: meetingNote.sourceUrl,
            discordMessageUrl: `https://discord.com/channels/synthetic/${index}`,
          };
          const knowledge = extractKnowledge(meetingNote);
          const saved = upsertMeetingRecord(record);
          replaceMeetingKnowledge(saved.id, knowledge);
        }
      }
      });
    suppressAudit ? withAuditSuppressed(run) : run();
  },
  count
);

timed(
  "create approvals",
  () => {
    const run = () =>
      withBrainTransaction(() => {
      for (let index = 0; index < count; index += 1) {
        if (backfillFastPath) {
          const batch = [];
          for (let batchIndex = 0; batchIndex < backfillBatchSize && index < count; batchIndex += 1, index += 1) {
            const meetingNote = note(index);
            batch.push({
              id: `approval:synthetic-${index}`,
              meetingId: `granola:synthetic-${index}`,
              title: meetingNote.title,
              payloadJson: JSON.stringify(meetingNote),
              announcement: meetingNote.summaryMarkdown,
              knowledgeJson: JSON.stringify(extractKnowledge(meetingNote)),
              routeJson: JSON.stringify({ publishMode: "approval", reason: "synthetic" }),
              routeReason: "synthetic",
              publishMode: "approval",
              decisionCount: 2,
              actionItemCount: 2,
              status: "pending",
            });
          }
          index -= 1;
          insertBackfillApprovalBatch(batch);
        } else {
          const meetingNote = note(index);
          const record = {
            id: `approval:synthetic-${index}`,
            meetingId: `granola:synthetic-${index}`,
            title: meetingNote.title,
            payloadJson: JSON.stringify(meetingNote),
            announcement: meetingNote.summaryMarkdown,
            knowledgeJson: JSON.stringify(extractKnowledge(meetingNote)),
            routeJson: JSON.stringify({ publishMode: "approval", reason: "synthetic" }),
            routeReason: "synthetic",
            publishMode: "approval",
            decisionCount: 2,
            actionItemCount: 2,
            status: "pending",
          };
          createApproval(record);
        }
      }
      });
    suppressAudit ? withAuditSuppressed(run) : run();
  },
  count
);

timed("list meetings page", () => listMeetingRecords({ limit: 100, offset: 0 }), 100);
timed("list decisions", () => listDecisions(100), 100);
timed("list action items", () => listActionItems(100), 100);
timed("list pending approval summaries", () => listApprovalSummaries("pending", { limit: 100, offset: 0 }), 100);
timed("list pending approvals full", () => listApprovals("pending", { limit: 100, offset: 0 }), 100);

timed(
  "flush FTS queue",
  () => {
    let flushed = 0;
    let batch = 0;
    const batchSize = Number(process.env.PERRY_PERF_FTS_BATCH ?? 100000);
    do {
      batch = flushFtsQueue(batchSize);
      flushed += batch;
    } while (batch > 0);
    return flushed;
  },
  count * 3
);

for (const query of ["wallace", "platypi", "source citations", "notion docs", "missing-term"]) {
  timed(`search '${query}'`, () => searchBrain(query, 25));
}

for (const query of ["wallace", "notion docs"]) {
  timed(`search decisions '${query}'`, () => searchBrain(query, 25, { types: ["decision"] }));
  timed(`search actions '${query}'`, () => searchBrain(query, 25, { types: ["action"] }));
}

const totalMs = steps.reduce((sum, step) => sum + step.ms, 0);
console.log(`Perry brain synthetic benchmark`);
console.log(`DB: ${process.env.PERRY_DB_PATH}`);
console.log(`Records: ${count}`);
console.log(`Audit: ${suppressAudit ? "suppressed" : "normal"}`);
console.log(`Backfill fast path: ${backfillFastPath ? "on" : "off"}`);
if (backfillFastPath) console.log(`Backfill batch size: ${backfillBatchSize}`);
console.log("");
for (const step of steps) {
  const opsText = step.ops ? ` | ${(step.ops / (step.ms / 1000)).toFixed(1)} ops/sec` : "";
  console.log(`${step.name.padEnd(36)} ${step.ms.toFixed(1).padStart(10)} ms${opsText}`);
}
console.log("");
console.log(`measured total`.padEnd(36), `${totalMs.toFixed(1).padStart(10)} ms`);
