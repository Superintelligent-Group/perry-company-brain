import assert from "node:assert/strict";
import test from "node:test";
import { formatMeetingAnnouncement, normalizeGranolaZapierPayload } from "@meetings";

test("normalizes a Granola Zapier payload", () => {
  const note = normalizeGranolaZapierPayload({
    note_id: "note_123",
    title: "Product Review",
    creator: { name: "Ada", email: "ada@doppel.example" },
    attendees: [{ name: "Grace" }, { email: "linus@doppel.example" }],
    calendar_event: { title: "Product Review", start_time: "2026-05-22T15:00:00.000Z" },
    summary: "Decision: ship the clean version.",
    transcript: "Full transcript",
    link: "https://notes.granola.ai/example",
  });

  assert.equal(note.source, "granola");
  assert.equal(note.sourceId, "note_123");
  assert.equal(note.title, "Product Review");
  assert.equal(note.attendees.length, 2);
  assert.equal(note.summaryMarkdown, "Decision: ship the clean version.");
  assert.equal(note.sourceUrl, "https://notes.granola.ai/example");
});

test("formats a compact Discord announcement", () => {
  const note = normalizeGranolaZapierPayload({
    title: "Architecture Review",
    summary: "Action: document the handoff.",
    attendees: [{ name: "Ada" }],
  });

  const message = formatMeetingAnnouncement(note, "https://notion.so/example");

  assert.match(message, /Meeting notes: Architecture Review/);
  assert.match(message, /Notion: https:\/\/notion.so\/example/);
  assert.match(message, /Action: document the handoff/);
});

test("Discord announcement excludes private notes and transcript", () => {
  const note = normalizeGranolaZapierPayload({
    title: "Privacy Review",
    summary: "Decision: share only the public summary.",
    my_notes: "PRIVATE_OPERATOR_DETAIL",
    transcript: "TRANSCRIPT_ONLY_DETAIL",
  });

  const message = formatMeetingAnnouncement(note, "https://notion.so/privacy-review");

  assert.match(message, /Decision: share only the public summary/);
  assert.doesNotMatch(message, /PRIVATE_OPERATOR_DETAIL/);
  assert.doesNotMatch(message, /TRANSCRIPT_ONLY_DETAIL/);
});

test("accepts internal sourceId payloads for backfill tooling", () => {
  const note = normalizeGranolaZapierPayload({
    sourceId: "synthetic-42",
    title: "Synthetic Backfill",
    summary: "Decision: keep stable IDs.",
  });

  assert.equal(note.sourceId, "synthetic-42");
});
