const {
  drainGraphSyncJobs,
  getFullGraphSyncQueueSnapshot,
} = require("../dist/graph/queue.js");
const { searchGraphMemory } = require("../dist/graph/memory.js");
const { replayGraphChangeSet } = require("../dist/graph/change-set-replay.js");
const {
  countMeetingRecords,
  listActionItems,
  listDecisions,
  listGraphChangeSets,
  listMeetingRecords,
} = require("../dist/store/meeting-store.js");
const { processGranolaZapierPayload } = require("../dist/ingestion/workflow.js");

const args = parseArgs(process.argv.slice(2));
const noteId = args["note-id"] || `company-brain-gauntlet-${Date.now()}`;
const graphEnabled = args.graph !== "false";

process.env.PERRY_DB_PATH ||= ":memory:";
process.env.PERRY_DEFAULT_PUBLISH_MODE ||= "auto";
process.env.PERRY_DISCORD_DRY_RUN ||= "true";
process.env.PERRY_NOTION_DRY_RUN ||= "true";
process.env.PERRY_GRAPHITI_ENABLED ||= graphEnabled ? "true" : "false";
process.env.PERRY_GRAPHITI_BRIDGE_URL ||= "http://127.0.0.1:8791";
process.env.PERRY_GRAPHITI_GROUP_ID ||= "doppel-labs";
process.env.PERRY_GRAPHITI_TIMEOUT_MS ||= "120000";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const startedAt = performance.now();
  const result = await processGranolaZapierPayload(payload(noteId), {
    force: args.force === "true",
  });

  const beforeDrain = getFullGraphSyncQueueSnapshot({ limit: 5 });
  const drained = graphEnabled ? await drainGraphSyncJobs(Number(args.drain || 1)) : undefined;
  const afterDrain = getFullGraphSyncQueueSnapshot({ limit: 5 });
  const replay = graphEnabled && args.replay !== "false" ? await replayLatestChangeSet(result.record.id) : undefined;
  const graphSearch =
    graphEnabled && args.search !== "false"
      ? await searchGraphMemory("Graphiti temporal memory Doppel Labs", 5)
      : undefined;

  const output = {
    ok: true,
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    meeting: {
      id: result.record.id,
      title: result.record.title,
      duplicate: result.duplicate,
      status: result.record.status,
      notionUrl: result.notionUrl,
      discordMessageUrl: result.discordMessageUrl,
    },
    counts: {
      processedMeetings: countMeetingRecords("processed"),
      recentMeetings: listMeetingRecords({ limit: 3 }).map((record) => ({
        id: record.id,
        title: record.title,
        status: record.status,
      })),
      recentDecisions: listDecisions(5).map((decision) => decision.text),
      recentActionItems: listActionItems(5).map((item) => ({
        owner: item.owner,
        text: item.text,
      })),
    },
    graph: {
      enabled: graphEnabled,
      beforeDrain: beforeDrain.stats,
      drained,
      afterDrain: afterDrain.stats,
      recentJobs: afterDrain.recent.map((job) => ({
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
      })),
      replay,
      search: graphSearch,
    },
  };

  console.log(JSON.stringify(output, null, 2));

  if (graphEnabled && drained && drained.failed > 0) {
    process.exitCode = 2;
  }
  if (graphEnabled && replay && replay.diff && replay.diff.passed !== true) {
    process.exitCode = 3;
  }
}

async function replayLatestChangeSet(meetingId) {
  const changeSet = listGraphChangeSets({ limit: 20 }).find((record) => record.meetingId === meetingId);
  if (!changeSet) throw new Error(`No graph change set found for ${meetingId}`);
  const replay = await replayGraphChangeSet(changeSet.id);
  return {
    changeSetId: replay.changeSetId,
    meetingId: replay.meetingId,
    groupId: replay.groupId,
    appliedAt: replay.appliedAt,
    validation: replay.validation,
    diff: replay.diff,
  };
}

function payload(id) {
  return {
    note_id: id,
    title: "Perry Company Brain Live Gauntlet",
    summary:
      "Decisions:\n" +
      "- Graphiti is the temporal memory layer for Doppel Labs.\n" +
      "- SQLite remains the operational queue and approval store.\n\n" +
      "Action items:\n" +
      "- Ada: Verify graph search quality against real Granola notes.\n" +
      "- Perry: Retry graph sync without blocking Discord or Notion.",
    private_notes: "Operator-only note: keep production posting disabled during the gauntlet.",
    transcript: "Ada said Graphiti should remember ownership changes and decision drift over time.",
    calendar_event: {
      title: "Perry Company Brain Live Gauntlet",
      start_time: new Date().toISOString(),
      attendees: [{ name: "Ada", email: "ada@doppel.example" }],
    },
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
