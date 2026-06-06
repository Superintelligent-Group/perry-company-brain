import assert from "node:assert/strict";
import test from "node:test";

const { createSyntheticCompanyArcCorpus } = require("../scripts/synthetic-company-arcs.cjs") as {
  createSyntheticCompanyArcCorpus: (options: { projects: number; meetingsPerProject: number; seed?: number }) => {
    count: number;
    items: Array<{
      id: string;
      project: string;
      subject: string;
      step: number;
      payload: {
        note_id: string;
        summary: string;
        my_notes: string;
        transcript: string;
      };
      expected: {
        decisions: string[];
        actions: Array<{ owner: string; text: string }>;
        search: Array<{ query: string; mustContain: string }>;
      };
    }>;
    expected: {
      finalOwnership: Array<{ project: string; subject: string; owner: string; previousOwner?: string }>;
      ownershipChangeCount: number;
      ownerActionMinimums: Record<string, number>;
      search: Array<{ query: string; mustContain: string }>;
      arcSummaries: Array<{ project: string; subject: string; finalOwner: string; previousOwner?: string }>;
    };
  };
};

test("synthetic company arcs model temporal ownership and workload state", () => {
  const corpus = createSyntheticCompanyArcCorpus({ projects: 4, meetingsPerProject: 5, seed: 11 });

  assert.equal(corpus.count, 20);
  assert.equal(corpus.items.length, 20);
  assert.equal(corpus.expected.finalOwnership.length, 4);
  assert(corpus.expected.ownershipChangeCount >= 4);
  assert(corpus.expected.search.length >= 8);
  assert(Object.keys(corpus.expected.ownerActionMinimums).length > 1);

  const handoff = corpus.items.find((item) => item.expected.decisions.some((decision) => decision.includes("now owns")));
  assert(handoff);
  assert(handoff.payload.summary.includes("Action items:"));
  assert(handoff.payload.my_notes.includes("PRIVATE_SYNTHETIC_MARKER"));
  assert(handoff.payload.transcript.includes("TRANSCRIPT_SYNTHETIC_MARKER"));

  const finalWithPrevious = corpus.expected.finalOwnership.find((item) => item.previousOwner);
  assert(finalWithPrevious);
  assert.notEqual(finalWithPrevious.owner, finalWithPrevious.previousOwner);
});