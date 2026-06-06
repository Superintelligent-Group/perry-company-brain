import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { enqueueGraphBackfillPage } from "@graph";
import { getFullGraphSyncQueueSnapshot, getGraphSyncQueueSnapshot } from "@graph";
import { closeBrainStore, insertBackfillMeeting, meetingRecordFromNote } from "@store";
import { normalizeGranolaZapierPayload } from "@meetings";

test("queues processed meeting history for Graphiti backfill", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-graph-backfill-"));
  const previousPath = process.env.PERRY_DB_PATH;
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  const previousGroup = process.env.PERRY_GRAPHITI_GROUP_ID;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    process.env.PERRY_GRAPHITI_ENABLED = "true";
    process.env.PERRY_GRAPHITI_BRIDGE_URL = "http://127.0.0.1:8791";
    process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-test";

    const note = normalizeGranolaZapierPayload({
      note_id: "historic-graph-1",
      title: "Historic Graph Review",
      summary: "Decisions:\n- Backfill graph memory.\n\nAction items:\n- Ada: Verify graph search",
    });
    insertBackfillMeeting(
      {
        ...meetingRecordFromNote(note, "processed"),
        notionUrl: "https://notion.example/historic-graph-1",
        discordMessageUrl: "https://discord.example/historic-graph-1",
      },
      {
        decisions: [{ text: "Backfill graph memory" }],
        actionItems: [{ text: "Verify graph search", owner: "Ada" }],
      }
    );

    const result = enqueueGraphBackfillPage({ limit: 10 });
    assert.equal(result.scanned, 1);
    assert.equal(result.queued, 1);
    assert.equal(result.skipped, 0);
    assert.equal(getGraphSyncQueueSnapshot({ limit: 0 }).stats.queued, 1);

    const job = getFullGraphSyncQueueSnapshot({ limit: 1 }).recent[0];
    const episode = JSON.parse(job.payloadJson) as { groupId: string; body: string };
    const body = JSON.parse(episode.body) as { title: string; decisions: unknown[]; actionItems: unknown[] };
    assert.equal(episode.groupId, "doppel-test");
    assert.equal(body.title, "Historic Graph Review");
    assert.equal(body.decisions.length, 1);
    assert.equal(body.actionItems.length, 1);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) delete process.env.PERRY_DB_PATH;
    else process.env.PERRY_DB_PATH = previousPath;
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
    if (previousGroup === undefined) delete process.env.PERRY_GRAPHITI_GROUP_ID;
    else process.env.PERRY_GRAPHITI_GROUP_ID = previousGroup;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
