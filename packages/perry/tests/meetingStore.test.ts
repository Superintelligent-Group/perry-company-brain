import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  findMeetingRecord,
  listActionItems,
  listDecisions,
  listMeetingRecords,
  flushFtsQueue,
  meetingRecordFromNote,
  replaceMeetingKnowledge,
  searchBrain,
  upsertMeetingRecord,
  closeBrainStore,
  createApproval,
  listApprovalSummaries,
} from "@store";
import type { MeetingNote } from "@meetings";

test("stores and finds processed meeting records by source id", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const note: MeetingNote = {
      source: "granola",
      sourceId: "note-1",
      title: "Design Review",
      attendees: [],
      summaryMarkdown: "Decision: proceed.",
    };

    const record = upsertMeetingRecord({
      ...meetingRecordFromNote(note, "processed"),
      notionUrl: "https://notion.so/page",
      discordMessageUrl: "https://discord.com/channels/1/2/3",
    });

    assert.equal(findMeetingRecord(note)?.id, record.id);
    assert.equal(listMeetingRecords().length, 1);
    replaceMeetingKnowledge(record.id, {
      decisions: [{ text: "Use Notion as the source of truth." }],
      actionItems: [{ text: "Create the Discord route.", owner: "Ada" }],
    });
    flushFtsQueue(10);
    assert.equal(listDecisions().length, 1);
    assert.equal(listActionItems().length, 1);
    assert.equal(searchBrain("notion").length, 1);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("search handles dotted versions, possessives, and relevance at scale", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-search-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    for (let index = 0; index < 30; index += 1) {
      const note: MeetingNote = {
        source: "granola",
        sourceId: `noise-${index}`,
        title: `Perry Planning Noise ${index}`,
        attendees: [],
        summaryMarkdown: "Decision: keep generic planning notes searchable.",
      };
      const record = upsertMeetingRecord(meetingRecordFromNote(note, "processed"));
      replaceMeetingKnowledge(record.id, {
        decisions: [{ text: "Keep generic planning notes searchable." }],
        actionItems: [],
      });
    }

    const note: MeetingNote = {
      source: "granola",
      sourceId: "versioned-note",
      title: "Perry-Discord Bot v2.1 Planning Session",
      attendees: [],
      summaryMarkdown: "Decision: Deprecate Perry's v1.5 endpoint and scope Atlas v2.1 to core workflows.",
    };
    const record = upsertMeetingRecord(meetingRecordFromNote(note, "processed"));
    replaceMeetingKnowledge(record.id, {
      decisions: [{ text: "Deprecate Perry's v1.5 endpoint and scope Atlas v2.1 to core workflows." }],
      actionItems: [],
    });

    flushFtsQueue(1000);

    assert.equal(searchBrain("Perry Discord Bot v2.1 Planning", 10)[0]?.id, record.id);
    assert.ok(searchBrain("Perry's v1.5 endpoint", 10).some((result) => result.meetingId === record.id));
    assert.ok(searchBrain("Atlas v2.1 core workflows", 10).some((result) => result.meetingId === record.id));
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("lists approval summaries without requiring full JSON payload parsing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-approval-summary-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    createApproval({
      id: "approval:note-1",
      meetingId: "granola:note-1",
      title: "Product Review",
      payloadJson: JSON.stringify({ note_id: "note-1" }),
      announcement: "Meeting notes: Product Review",
      knowledgeJson: JSON.stringify({
        decisions: [{ text: "Keep approvals lightweight." }],
        actionItems: [{ text: "Ship summary rows." }, { text: "Benchmark payloads." }],
      }),
      routeJson: JSON.stringify({ project: "Perry", reason: "Matched project route", publishMode: "approval" }),
      status: "pending",
    });

    const [summary] = listApprovalSummaries("pending");
    assert.equal(summary.title, "Product Review");
    assert.equal(summary.routeProject, "Perry");
    assert.equal(summary.routeReason, "Matched project route");
    assert.equal(summary.publishMode, "approval");
    assert.equal(summary.decisionCount, 1);
    assert.equal(summary.actionItemCount, 2);
    assert.equal("payloadJson" in summary, false);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
