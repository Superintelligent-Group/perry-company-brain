const { readFileSync } = require("node:fs");
const { basename } = require("node:path");
const {
  insertBackfillApprovalBatch,
  insertBackfillMeetingBatch,
  meetingRecordFromNote,
  withAuditSuppressed,
} = require("../dist/store/index.js");
const { extractKnowledge } = require("../dist/extraction/knowledge.js");
const { formatMeetingAnnouncement, normalizeGranolaZapierPayload } = require("../dist/meetings/note.js");

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input ?? args._[0];
const batchSize = Number(args.batch ?? process.env.PERRY_BACKFILL_BATCH ?? 1000);
const createApprovals = args.approvals !== "false";
const status = args.status === "dry-run" ? "dry-run" : "processed";
const suppressAudit = args.audit !== "on";

if (!inputPath) {
  console.error("Usage: pnpm backfill:meetings -- --input granola-export.jsonl [--batch 1000] [--approvals false]");
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const payloads = parsePayloads(raw);
const startedAt = performance.now();

let meetings = 0;
let approvals = 0;

const run = () => {
  for (let offset = 0; offset < payloads.length; offset += batchSize) {
    const chunk = payloads.slice(offset, offset + batchSize);
    const meetingBatch = [];
    const approvalBatch = [];

    for (const payload of chunk) {
      const note = normalizeGranolaZapierPayload(payload);
      const knowledge = extractKnowledge(note);
      const record = {
        ...meetingRecordFromNote(note, status),
        notionUrl: note.sourceUrl,
      };
      meetingBatch.push({ record, knowledge });

      if (createApprovals) {
        const routeReason = `backfill:${basename(inputPath)}`;
        approvalBatch.push({
          id: `approval:${record.id}`,
          meetingId: record.id,
          title: record.title,
          payloadJson: JSON.stringify(payload),
          announcement: formatMeetingAnnouncement(note, note.sourceUrl),
          knowledgeJson: JSON.stringify(knowledge),
          routeJson: JSON.stringify({ publishMode: "approval", reason: routeReason }),
          routeReason,
          publishMode: "approval",
          decisionCount: knowledge.decisions.length,
          actionItemCount: knowledge.actionItems.length,
          status: "pending",
        });
      }
    }

    meetings += insertBackfillMeetingBatch(meetingBatch);
    if (approvalBatch.length > 0) {
      approvals += insertBackfillApprovalBatch(approvalBatch);
    }
  }
};

suppressAudit ? withAuditSuppressed(run) : run();

const elapsedMs = performance.now() - startedAt;
console.log("Perry meeting backfill");
console.log(`Input: ${inputPath}`);
console.log(`Payloads: ${payloads.length}`);
console.log(`Batch size: ${batchSize}`);
console.log(`Meetings inserted: ${meetings}`);
console.log(`Approvals inserted: ${approvals}`);
console.log(`Elapsed: ${elapsedMs.toFixed(1)}ms`);
console.log(`Meeting throughput: ${(meetings / (elapsedMs / 1000)).toFixed(1)} meetings/sec`);

function parsePayloads(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("JSON input must be an array");
    return parsed;
  }
  return trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseArgs(values) {
  const output = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      output._.push(value);
      continue;
    }
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
