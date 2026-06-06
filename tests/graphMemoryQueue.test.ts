import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { drainGraphSyncJobs, enqueueMeetingGraphSync, getGraphSyncQueueSnapshot } from "@graph";
import {
  closeBrainStore,
  getGraphChangeSetByJobId,
  listGraphChangeSets,
} from "@store";

test("queues and drains Graphiti meeting sync jobs", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-graph-sync-"));
  const previousPath = process.env.PERRY_DB_PATH;
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  const previousGroup = process.env.PERRY_GRAPHITI_GROUP_ID;
  const previousDirect = process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  const received: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/episodes") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert(address && "port" in address);

  try {
    process.env.PERRY_GRAPHITI_ENABLED = "true";
    process.env.PERRY_GRAPHITI_BRIDGE_URL = `http://127.0.0.1:${address.port}`;
    process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-test";
    delete process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;

    const job = enqueueMeetingGraphSync({
      note: {
        source: "granola",
        sourceId: "graph-sync-note-1",
        title: "Graph Sync Review",
        attendees: [],
        summaryMarkdown: "Decision: queue graph sync.",
      },
      record: {
        id: "granola:graph-sync-note-1",
        source: "granola",
        sourceId: "graph-sync-note-1",
        title: "Graph Sync Review",
        createdAt: "2026-05-23T15:00:00.000Z",
        updatedAt: "2026-05-23T15:01:00.000Z",
        status: "processed",
      },
      knowledge: { decisions: [{ text: "queue graph sync" }], actionItems: [] },
    });

    assert(job);
    const changeSet = getGraphChangeSetByJobId(job.id);
    assert(changeSet);
    assert.equal(changeSet.meetingId, "granola:graph-sync-note-1");
    assert.equal(changeSet.validationStatus, "valid");
    assert.equal(changeSet.applyStatus, "queued");
    assert.equal(getGraphSyncQueueSnapshot({ limit: 1 }).recent[0].hasPayload, true);
    assert.equal("payloadJson" in getGraphSyncQueueSnapshot({ limit: 1 }).recent[0], false);

    const drained = await drainGraphSyncJobs(10);
    assert.deepEqual(drained, { processed: 1, failed: 0, skipped: 0 });
    assert.equal(received.length, 1);
    assert.equal(getGraphSyncQueueSnapshot({ limit: 0 }).stats.completed, 1);
    assert.equal(getGraphChangeSetByJobId(job.id)?.applyStatus, "applied");
    assert.equal(Boolean(getGraphChangeSetByJobId(job.id)?.appliedAt), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) delete process.env.PERRY_DB_PATH;
    else process.env.PERRY_DB_PATH = previousPath;
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
    if (previousGroup === undefined) delete process.env.PERRY_GRAPHITI_GROUP_ID;
    else process.env.PERRY_GRAPHITI_GROUP_ID = previousGroup;
    if (previousDirect === undefined) delete process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;
    else process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = previousDirect;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("can drain graph sync jobs through the direct change-set endpoint", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-graph-direct-"));
  const previousPath = process.env.PERRY_DB_PATH;
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  const previousGroup = process.env.PERRY_GRAPHITI_GROUP_ID;
  const previousDirect = process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  const received: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/change-sets") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert(address && "port" in address);

  try {
    process.env.PERRY_GRAPHITI_ENABLED = "true";
    process.env.PERRY_GRAPHITI_BRIDGE_URL = `http://127.0.0.1:${address.port}`;
    process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-test";
    process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = "true";

    const job = enqueueMeetingGraphSync({
      note: {
        source: "granola",
        sourceId: "graph-direct-note-1",
        title: "Wallace Direct Graph Sync",
        attendees: [{ name: "Ada", email: "ada@doppel.example" }],
        summaryMarkdown: "Decision: Ada owns Wallace graph sync until next review.",
      },
      record: {
        id: "granola:graph-direct-note-1",
        source: "granola",
        sourceId: "graph-direct-note-1",
        title: "Wallace Direct Graph Sync",
        createdAt: "2026-05-23T15:00:00.000Z",
        updatedAt: "2026-05-23T15:01:00.000Z",
        status: "processed",
      },
      knowledge: {
        decisions: [{ text: "Ada owns Wallace graph sync until next review." }],
        actionItems: [{ owner: "Ada", text: "Verify direct graph change-set sync." }],
      },
      route: {
        project: "Wallace",
        publishMode: "approval",
        reason: "Matched Wallace",
      },
    });

    assert(job);
    assert.equal(listGraphChangeSets({ limit: 10 }).length, 1);
    assert.equal(getGraphChangeSetByJobId(job.id)?.applyStatus, "queued");
    const drained = await drainGraphSyncJobs(1);
    assert.deepEqual(drained, { processed: 1, failed: 0, skipped: 0 });
    assert.equal(received.length, 1);
    const payload = received[0] as {
      groupId: string;
      changeSet: { entities: Array<{ stableKey: string }>; relations: Array<{ relation: string }> };
    };
    assert.equal(payload.groupId, "doppel-test");
    assert.equal(payload.changeSet.entities.some((entity) => entity.stableKey === "project:wallace"), true);
    assert.equal(payload.changeSet.relations.some((relation) => relation.relation === "ASSIGNED_OWNER"), true);
    assert.equal(getGraphChangeSetByJobId(job.id)?.applyStatus, "applied");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) delete process.env.PERRY_DB_PATH;
    else process.env.PERRY_DB_PATH = previousPath;
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
    if (previousGroup === undefined) delete process.env.PERRY_GRAPHITI_GROUP_ID;
    else process.env.PERRY_GRAPHITI_GROUP_ID = previousGroup;
    if (previousDirect === undefined) delete process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;
    else process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = previousDirect;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
