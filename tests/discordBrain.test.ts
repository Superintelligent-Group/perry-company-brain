import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hasBrainCommandAccess, slashCommandData } from "@discord";
import { formatOntologyChangedSince, formatOntologyEvidence, formatOntologyState } from "@brain";
import { enqueueMeetingGraphSync } from "@graph";
import { closeBrainStore } from "@store";
import type { GraphMemorySyncInput } from "@graph";

test("registers bounded Perry brain slash commands", () => {
  const brain = slashCommandData.find((command) => command.name === "brain") as { options?: Array<{ name: string }> } | undefined;

  assert.ok(brain);
  assert.deepEqual(
    (brain.options ?? []).map((option) => option.name).sort(),
    ["changed", "evidence", "my-actions", "owner", "project", "recent-pivots", "state", "why"]
  );
});

test("allows brain commands only for configured admin roles", () => {
  assert.equal(hasBrainCommandAccess({ roleIds: [], adminRoleIds: [] }), true);
  assert.equal(hasBrainCommandAccess({ roleIds: ["engineering"], adminRoleIds: ["brain-admin"] }), false);
  assert.equal(hasBrainCommandAccess({ roleIds: ["brain-admin", "engineering"], adminRoleIds: ["brain-admin"] }), true);
});


test("formats indexed ontology state for Discord brain commands", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-discord-ontology-"));
  const env = preserveEnv(["PERRY_DB_PATH", "PERRY_GRAPHITI_ENABLED", "PERRY_GRAPHITI_BRIDGE_URL", "PERRY_GRAPHITI_GROUP_ID"]);
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_GRAPHITI_ENABLED = "true";
  process.env.PERRY_GRAPHITI_BRIDGE_URL = "http://127.0.0.1:1";
  process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-discord-ontology";

  try {
    const job = enqueueMeetingGraphSync(sampleInput());
    assert(job);

    const state = formatOntologyState({ type: "risk", project: "Wallace", limit: 3 });
    assert.match(state, /Wallace risk/u);
    assert.match(state, /Graphiti bridge outage during sync/u);
    assert.match(state, /indexed total/u);

    const evidence = formatOntologyEvidence("risk:graphiti-bridge-outage-during-sync");
    assert.match(evidence, /Graphiti bridge outage during sync/u);
    assert.match(evidence, /evidence records/u);

    const changed = formatOntologyChangedSince({ since: "2000-01-01T00:00:00.000Z", project: "Wallace", limit: 5 });
    assert.match(changed, /ontology objects changed since/u);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function sampleInput(): GraphMemorySyncInput {
  return {
    note: {
      source: "granola",
      sourceId: "discord-ontology-1",
      title: "Wallace Discord Ontology Review",
      creatorName: "Ada",
      creatorEmail: "ada@doppel.example",
      attendees: [{ name: "Ben", email: "ben@doppel.example" }],
      calendarTitle: "Wallace planning",
      folderName: "Wallace",
      startedAt: "2026-05-25T10:00:00.000Z",
      summaryMarkdown:
        "Goal: reduce Discord ontology query p95 below 10 ms. Risk: Graphiti bridge outage during sync. " +
        "Blocker: missing Notion permissions. Capability: typed company brain commands.",
      sourceUrl: "https://granola.example/discord-ontology-1",
    },
    record: {
      id: "granola:discord-ontology-1",
      source: "granola",
      sourceId: "discord-ontology-1",
      title: "Wallace Discord Ontology Review",
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:01:00.000Z",
      status: "processed",
    },
    knowledge: {
      decisions: [{ text: "Ada owns Wallace ontology commands until next review." }],
      actionItems: [{ owner: "Ada", text: "Review Wallace ontology command coverage." }],
    },
    route: {
      project: "Wallace",
      publishMode: "auto",
      reason: "Matched Wallace",
      discordChannelId: "wallace-channel",
      notionDataSourceId: "wallace-data-source",
    },
  };
}

function preserveEnv(keys: string[]): { restore(): void } {
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
