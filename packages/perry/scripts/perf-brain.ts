import { performance } from "node:perf_hooks";
import {
  createApproval,
  listActionItems,
  listApprovalSummaries,
  listApprovals,
  listDecisions,
  listMeetingRecords,
  meetingRecordFromNote,
  replaceMeetingKnowledge,
  searchBrain,
  upsertMeetingRecord,
} from "@store";
import { extractKnowledge } from "@extraction";
import type { MeetingNote } from "@meetings";

interface Step {
  name: string;
  ms: number;
  ops?: number;
}

const count = Number(process.env.PERRY_PERF_COUNT ?? process.argv[2] ?? 1000);
process.env.PERRY_DB_PATH ??= ":memory:";

const steps: Step[] = [];

function timed<T>(name: string, fn: () => T, ops?: number): T {
  const start = performance.now();
  const result = fn();
  steps.push({ name, ms: performance.now() - start, ops });
  return result;
}

function note(index: number): MeetingNote {
  const project = index % 3 === 0 ? "Wallace" : index % 3 === 1 ? "Platypi" : "Perry";
  return {
    source: "granola",
    sourceId: `synthetic-${index}`,
    title: `${project} product review ${index}`,
    creatorName: "Synthetic Runner",
    attendees: [
      { name: "Ada", email: "ada@doppel.example" },
      { name: "Grace", email: "grace@doppel.example" },
    ],
    startedAt: "2026-05-23T15:00:00.000Z",
    sourceUrl: `https://notes.granola.ai/synthetic-${index}`,
    summaryMarkdown: `Decisions:
- Use ${project} route ${index}.
- Keep source citations for project ${project}.

Action items:
- Ada: Review ${project} follow-up ${index} by tomorrow
- Grace: Update Notion docs for ${project} ${index}`,
  };
}

timed(
  "ingest meetings + extracted knowledge",
  () => {
    for (let index = 0; index < count; index += 1) {
      const meetingNote = note(index);
      const record = upsertMeetingRecord({
        ...meetingRecordFromNote(meetingNote, "processed"),
        notionUrl: meetingNote.sourceUrl,
        discordMessageUrl: `https://discord.com/channels/synthetic/${index}`,
      });
      replaceMeetingKnowledge(record.id, extractKnowledge(meetingNote));
    }
  },
  count
);

timed(
  "create approvals",
  () => {
    for (let index = 0; index < count; index += 1) {
      const meetingNote = note(index);
      createApproval({
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
  },
  count
);

timed("list meetings", () => listMeetingRecords(), count);
timed("list decisions", () => listDecisions(100), 100);
timed("list action items", () => listActionItems(100), 100);
timed("list pending approval summaries", () => listApprovalSummaries("pending"), count);
timed("list pending approvals full", () => listApprovals("pending"), count);

for (const query of ["wallace", "platypi", "source citations", "notion docs", "missing-term"]) {
  timed(`search '${query}'`, () => searchBrain(query, 25));
}

const totalMs = steps.reduce((sum, step) => sum + step.ms, 0);
console.log(`Perry brain synthetic benchmark`);
console.log(`DB: ${process.env.PERRY_DB_PATH}`);
console.log(`Records: ${count}`);
console.log("");
for (const step of steps) {
  const opsText = step.ops ? ` | ${(step.ops / (step.ms / 1000)).toFixed(1)} ops/sec` : "";
  console.log(`${step.name.padEnd(36)} ${step.ms.toFixed(1).padStart(10)} ms${opsText}`);
}
console.log("");
console.log(`measured total`.padEnd(36), `${totalMs.toFixed(1).padStart(10)} ms`);
