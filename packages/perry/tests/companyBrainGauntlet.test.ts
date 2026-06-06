import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { drainGraphSyncJobs, getFullGraphSyncQueueSnapshot } from "@graph";
import {
  closeBrainStore,
  countMeetingRecords,
  listActionItems,
  listDecisions,
  listMeetingRecords,
} from "@store";
import { processGranolaZapierPayload } from "@ingestion";

test("company brain gauntlet posts a Granola note through dry-run sinks and queues graph memory", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-company-brain-"));
  const bridge = await startEpisodeBridge(202);
  const env = preserveEnv([
    "PERRY_DB_PATH",
    "PERRY_CONFIG_PATH",
    "PERRY_DEFAULT_PUBLISH_MODE",
    "PERRY_DISCORD_DRY_RUN",
    "PERRY_NOTION_DRY_RUN",
    "PERRY_GRAPHITI_ENABLED",
    "PERRY_GRAPHITI_BRIDGE_URL",
    "PERRY_GRAPHITI_GROUP_ID",
    "PERRY_GRAPHITI_TIMEOUT_MS",
    "PERRY_GRAPHITI_DIRECT_CHANGESETS",
  ]);

  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  process.env.PERRY_DEFAULT_PUBLISH_MODE = "auto";
  process.env.PERRY_DISCORD_DRY_RUN = "true";
  process.env.PERRY_NOTION_DRY_RUN = "true";
  process.env.PERRY_GRAPHITI_ENABLED = "true";
  process.env.PERRY_GRAPHITI_BRIDGE_URL = bridge.url;
  process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-gauntlet";
  process.env.PERRY_GRAPHITI_TIMEOUT_MS = "5000";
  delete process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;

  try {
    const result = await processGranolaZapierPayload(companyBrainPayload());

    assert.equal(result.duplicate, false);
    assert.equal(result.dryRun, false);
    assert.equal(result.record.status, "processed");
    assert.match(result.notionUrl ?? "", /^https:\/\/notion\.example\/perry-dry-run\//u);
    assert.match(result.discordMessageUrl ?? "", /^https:\/\/discord\.example\/perry-dry-run\//u);
    assert.equal(countMeetingRecords("processed"), 1);
    assert.equal(listMeetingRecords({ limit: 5 })[0].title, "Perry Company Brain Review");
    assert.equal(listDecisions(10).some((item) => item.text.includes("Graphiti is the temporal memory layer")), true);
    assert.equal(listActionItems(10).some((item) => item.owner === "Ada"), true);

    assert.equal(getFullGraphSyncQueueSnapshot({ limit: 5 }).stats.queued, 1);
    const drained = await drainGraphSyncJobs(1);
    assert.deepEqual(drained, { processed: 1, failed: 0, skipped: 0 });
    assert.equal(bridge.episodes.length, 1);

    const episode = bridge.episodes[0] as { body: string; groupId: string; name: string };
    const body = JSON.parse(episode.body) as {
      title: string;
      notionUrl?: string;
      discordMessageUrl?: string;
      decisions: Array<{ text: string }>;
      actionItems: Array<{ owner?: string; text: string }>;
    };
    assert.equal(episode.groupId, "doppel-gauntlet");
    assert.equal(episode.name, "perry-meeting-granola:company-brain-gauntlet-1");
    assert.equal(body.title, "Perry Company Brain Review");
    assert.match(body.notionUrl ?? "", /notion\.example/u);
    assert.match(body.discordMessageUrl ?? "", /discord\.example/u);
    assert.equal(body.decisions.some((item) => item.text.includes("temporal memory")), true);
    assert.equal(body.actionItems.some((item) => item.owner === "Ada"), true);

    const duplicate = await processGranolaZapierPayload(companyBrainPayload());
    assert.equal(duplicate.duplicate, true);
    assert.equal(bridge.episodes.length, 1);
  } finally {
    await bridge.close();
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("graph sync failures stay durable and retry later instead of blocking meeting posting", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-company-brain-failure-"));
  const bridge = await startEpisodeBridge(503);
  const env = preserveEnv([
    "PERRY_DB_PATH",
    "PERRY_CONFIG_PATH",
    "PERRY_DEFAULT_PUBLISH_MODE",
    "PERRY_DISCORD_DRY_RUN",
    "PERRY_NOTION_DRY_RUN",
    "PERRY_GRAPHITI_ENABLED",
    "PERRY_GRAPHITI_BRIDGE_URL",
    "PERRY_GRAPHITI_GROUP_ID",
    "PERRY_GRAPHITI_TIMEOUT_MS",
    "PERRY_GRAPHITI_DIRECT_CHANGESETS",
  ]);

  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  process.env.PERRY_DEFAULT_PUBLISH_MODE = "auto";
  process.env.PERRY_DISCORD_DRY_RUN = "true";
  process.env.PERRY_NOTION_DRY_RUN = "true";
  process.env.PERRY_GRAPHITI_ENABLED = "true";
  process.env.PERRY_GRAPHITI_BRIDGE_URL = bridge.url;
  process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-gauntlet";
  process.env.PERRY_GRAPHITI_TIMEOUT_MS = "5000";
  delete process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS;

  try {
    const result = await processGranolaZapierPayload({
      ...companyBrainPayload(),
      note_id: "company-brain-gauntlet-failure",
    });
    assert.equal(result.record.status, "processed");

    const drained = await drainGraphSyncJobs(1);
    assert.deepEqual(drained, { processed: 0, failed: 1, skipped: 0 });
    const snapshot = getFullGraphSyncQueueSnapshot({ limit: 1 });
    assert.equal(snapshot.stats.queued, 1);
    assert.equal(snapshot.stats.failed, 0);
    assert.equal(snapshot.recent[0].attempts, 1);
    assert.match(snapshot.recent[0].lastError ?? "", /503/u);

    const immediateRetry = await drainGraphSyncJobs(1);
    assert.deepEqual(immediateRetry, { processed: 0, failed: 0, skipped: 0 });
    assert.equal(bridge.episodes.length, 1);
  } finally {
    await bridge.close();
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function companyBrainPayload(): Record<string, unknown> {
  return {
    note_id: "company-brain-gauntlet-1",
    title: "Perry Company Brain Review",
    summary:
      "Decisions:\n" +
      "- Graphiti is the temporal memory layer for Doppel Labs.\n" +
      "- SQLite remains the operational queue and approval store.\n\n" +
      "Action items:\n" +
      "- Ada: Verify graph search quality against real Granola notes.\n" +
      "- Perry: Retry graph sync without blocking Discord or Notion.",
    private_notes: "Do not post this private operator note to Discord.",
    transcript: "Ada said Graphiti should remember ownership changes over time.",
    calendar_event: {
      title: "Perry Company Brain Review",
      start_time: "2026-05-23T15:00:00.000Z",
      attendees: [{ name: "Ada", email: "ada@doppel.example" }],
    },
  };
}

async function startEpisodeBridge(status: number): Promise<{
  url: string;
  episodes: unknown[];
  close: () => Promise<void>;
}> {
  const episodes: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/episodes") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      episodes.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ ok: status < 400 }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert(address && "port" in address);
  return {
    url: `http://127.0.0.1:${address.port}`,
    episodes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function preserveEnv(keys: string[]): { restore: () => void } {
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  return {
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
