export const sampleGranolaZapierPayload = {
  note_id: "sample-granola-note",
  title: "Weekly Product Review",
  creator: {
    name: "Doppel Teammate",
    email: "teammate@doppel.example",
  },
  attendees: [
    { name: "Product", email: "product@doppel.example" },
    { name: "Engineering", email: "engineering@doppel.example" },
  ],
  calendar_event: {
    title: "Weekly Product Review",
    start_time: "2026-05-22T15:00:00.000Z",
  },
  my_notes: "Follow up on the Discord announcement format and Notion schema.",
  summary:
    "Decisions:\n- Use Notion as the durable wiki source.\n- Use Discord for team notification and discussion.\n\nAction items:\n- Add idempotency before broad backfills.\n- Create a meeting notes data source for clean ingestion.",
  transcript: "This is a shortened sample transcript for local preview and smoke checks.",
  link: "https://notes.granola.ai/sample",
};
