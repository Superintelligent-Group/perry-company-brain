import assert from "node:assert/strict";
import test from "node:test";
import { extractKnowledge } from "@extraction";

test("extracts decisions and action items from structured meeting text", () => {
  const knowledge = extractKnowledge({
    source: "granola",
    sourceId: "note-1",
    title: "Brain Review",
    attendees: [],
    summaryMarkdown:
      "Decisions:\n- Use Notion as the durable source.\n\nAction items:\n- Ada: Create the Discord route by tomorrow\n- Review schema next week",
  });

  assert.deepEqual(knowledge.decisions, [{ text: "Use Notion as the durable source." }]);
  assert.equal(knowledge.actionItems.length, 2);
  assert.equal(knowledge.actionItems[0].owner, "Ada");
  assert.equal(knowledge.actionItems[0].dueDate, "tomorrow");
});
