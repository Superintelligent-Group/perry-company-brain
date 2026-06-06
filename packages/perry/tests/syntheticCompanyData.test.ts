import assert from "node:assert/strict";
import test from "node:test";

const { createSyntheticCompanyCorpus } = require("../scripts/synthetic-company-data.cjs") as {
  createSyntheticCompanyCorpus: (options: { count: number; seed?: number }) => {
    items: Array<{
      id: string;
      payload: {
        note_id: string;
        summary?: string;
        my_notes?: string;
        transcript?: string;
      };
      expected: {
        decisions: string[];
        actions: Array<{ owner?: string; text: string }>;
        search: Array<{ query: string; mustContain: string }>;
      };
    }>;
    duplicatePayloads: Array<{ note_id: string }>;
    edgeCaseCounts: Record<string, number>;
  };
};

test("synthetic company corpus includes realistic edge cases and expected answers", () => {
  const corpus = createSyntheticCompanyCorpus({ count: 60, seed: 7 });

  assert.equal(corpus.items.length, 60);
  assert(corpus.duplicatePayloads.length > 0);
  assert(corpus.edgeCaseCounts.ownerChanges > 0);
  assert(corpus.edgeCaseCounts.longTranscripts > 0);
  assert(corpus.edgeCaseCounts.privateNotes > 0);
  assert(corpus.edgeCaseCounts.missingSummaries > 0);
  assert(corpus.edgeCaseCounts.sparseAttendees > 0);

  const regular = corpus.items.find((item) => item.expected.decisions.length > 0);
  assert(regular);
  assert.equal(regular.expected.decisions.length, 2);
  assert.equal(regular.expected.actions.length, 2);
  assert(regular.expected.search.length > 0);

  const privateCase = corpus.items.find((item) => item.payload.my_notes?.includes("PRIVATE_SYNTHETIC_MARKER"));
  assert(privateCase);
  const transcriptCase = corpus.items.find((item) => item.payload.transcript?.includes("TRANSCRIPT_SYNTHETIC_MARKER"));
  assert(transcriptCase);
});
