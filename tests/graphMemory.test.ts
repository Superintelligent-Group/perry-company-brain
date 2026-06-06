import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  buildGraphitiMeetingEpisode,
  getGraphEntityContext,
  getGraphEvidence,
  getGraphMemoryStatus,
  getGraphTimeline,
  listGraphEntities,
  listGraphFacts,
  searchGraphMemory,
} from "@graph";

test("builds a compact Graphiti meeting episode", () => {
  const previousPrivate = process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  const previousTranscript = process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
  delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;

  const episode = buildGraphitiMeetingEpisode(
    {
      note: {
        source: "granola",
        sourceId: "graph-note-1",
        title: "Graph Memory Review",
        attendees: [{ name: "Ada", email: "ada@doppel.example" }],
        startedAt: "2026-05-23T15:00:00.000Z",
        summaryMarkdown: "Decision: use Graphiti for temporal relations.",
        privateNotes: "Operator-only context.",
        transcript: "Full transcript should be opt-in.",
      },
      record: {
        id: "granola:graph-note-1",
        source: "granola",
        sourceId: "graph-note-1",
        title: "Graph Memory Review",
        createdAt: "2026-05-23T15:00:00.000Z",
        updatedAt: "2026-05-23T15:01:00.000Z",
        status: "processed",
      },
      knowledge: {
        decisions: [{ text: "use Graphiti for temporal relations" }],
        actionItems: [{ text: "wire graph sidecar", owner: "Ada" }],
      },
    },
    "doppel-test"
  );

  try {
    assert.equal(episode.source, "json");
    assert.equal(episode.groupId, "doppel-test");
    assert.equal(episode.referenceTime, "2026-05-23T15:00:00.000Z");
    const body = JSON.parse(episode.body) as {
      kind: string;
      decisions: unknown[];
      actionItems: unknown[];
      privateNotes?: string;
      transcript?: string;
    };
    assert.equal(body.kind, "meeting_note");
    assert.equal(body.decisions.length, 1);
    assert.equal(body.actionItems.length, 1);
    assert.equal(body.privateNotes, undefined);
    assert.equal(body.transcript, undefined);
  } finally {
    if (previousPrivate === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
    else process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = previousPrivate;
    if (previousTranscript === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
    else process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = previousTranscript;
  }
});

test("graph memory can opt into private notes and transcripts explicitly", () => {
  const previousPrivate = process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  const previousTranscript = process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
  process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = "true";
  process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = "true";

  try {
    const episode = buildGraphitiMeetingEpisode(
      {
        note: {
          source: "granola",
          sourceId: "private-graph-note",
          title: "Private Graph Memory Review",
          attendees: [],
          summaryMarkdown: "Decision: keep private graph sync explicit.",
          privateNotes: "Private operator context.",
          transcript: "Full transcript context.",
        },
        record: {
          id: "granola:private-graph-note",
          source: "granola",
          sourceId: "private-graph-note",
          title: "Private Graph Memory Review",
          createdAt: "2026-05-23T15:00:00.000Z",
          updatedAt: "2026-05-23T15:01:00.000Z",
          status: "processed",
        },
        knowledge: {
          decisions: [{ text: "keep private graph sync explicit" }],
          actionItems: [],
        },
      },
      "doppel-test"
    );
    const body = JSON.parse(episode.body) as { privateNotes?: string; transcript?: string };
    assert.equal(body.privateNotes, "Private operator context.");
    assert.equal(body.transcript, "Full transcript context.");
  } finally {
    if (previousPrivate === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
    else process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = previousPrivate;
    if (previousTranscript === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
    else process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = previousTranscript;
  }
});

test("graph memory search is inert when disabled", async () => {
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  delete process.env.PERRY_GRAPHITI_ENABLED;
  delete process.env.PERRY_GRAPHITI_BRIDGE_URL;

  try {
    assert.equal(getGraphMemoryStatus().enabled, false);
    const response = await searchGraphMemory("wallace");
    assert.equal(response.enabled, false);
    assert.deepEqual(response.results, []);
  } finally {
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
  }
});

test("graph memory exposes bounded typed graph read helpers", async () => {
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  const previousGroup = process.env.PERRY_GRAPHITI_GROUP_ID;

  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.startsWith("/entities")) {
      res.end(
        JSON.stringify({
          ok: true,
          entities: [{ stableKey: "project:wallace", type: "project", name: "Wallace", evidenceIds: ["e1"] }],
        })
      );
      return;
    }
    if (req.url?.startsWith("/facts")) {
      res.end(
        JSON.stringify({
          ok: true,
          facts: [
            {
              fact: { subjectKey: "project:wallace", relation: "ASSIGNED_OWNER", objectKey: "person:ada", active: true },
              evidence: { evidenceId: "e1", excerpt: "Ada owns Wallace." },
            },
          ],
        })
      );
      return;
    }
    if (req.url?.startsWith("/evidence")) {
      res.end(JSON.stringify({ ok: true, evidence: { evidenceId: "e1", excerpt: "Ada owns Wallace." } }));
      return;
    }
    if (req.url?.startsWith("/entity-context")) {
      res.end(
        JSON.stringify({
          ok: true,
          entity: { stableKey: "project:wallace", type: "project", name: "Wallace" },
          facts: [{ fact: { relation: "ASSIGNED_OWNER" } }],
          retirements: [],
        })
      );
      return;
    }
    if (req.url?.startsWith("/timeline")) {
      res.end(JSON.stringify({ ok: true, stableKey: "project:wallace", events: [{ type: "fact", at: "2026-05-23" }] }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert(address && "port" in address);

  try {
    process.env.PERRY_GRAPHITI_ENABLED = "true";
    process.env.PERRY_GRAPHITI_BRIDGE_URL = `http://127.0.0.1:${address.port}`;
    process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-test";

    const entities = await listGraphEntities({ query: "wallace", type: "project", limit: 5 });
    const facts = await listGraphFacts({ subject: "project:wallace", active: true, limit: 5 });
    const evidence = await getGraphEvidence("e1");
    const context = await getGraphEntityContext("project:wallace", 5);
    const timeline = await getGraphTimeline("project:wallace", 5);

    assert.equal(entities.entities[0].stableKey, "project:wallace");
    assert.equal(facts.facts[0].fact?.relation, "ASSIGNED_OWNER");
    assert.equal(evidence.evidence?.evidenceId, "e1");
    assert.equal(context.entity?.stableKey, "project:wallace");
    assert.equal(timeline.events[0].type, "fact");
    assert.equal(requests.some((request) => request.includes("groupId=doppel-test")), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
    if (previousGroup === undefined) delete process.env.PERRY_GRAPHITI_GROUP_ID;
    else process.env.PERRY_GRAPHITI_GROUP_ID = previousGroup;
  }
});
