import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyBrainInsights, getCompanyBrainInsights } from "@brain";
import { closeBrainStore } from "@store";
import { processGranolaZapierPayload } from "@ingestion";
import type { ActionItemRecord, DecisionRecord } from "@store";

test("company brain insights tracks current ownership and ownership changes", () => {
  const decisions: DecisionRecord[] = [
    decision("d1", "m1", "Ada owns Wallace onboarding until the next planning review.", "2026-05-01T10:00:00.000Z"),
    decision("d2", "m2", "Ben now owns Wallace onboarding; Ada is the fallback reviewer.", "2026-05-08T10:00:00.000Z"),
    decision("d3", "m3", "Mira owns Notion Wiki publishing until the next planning review.", "2026-05-09T10:00:00.000Z"),
  ];
  const actions: ActionItemRecord[] = [
    action("a1", "m1", "Prepare onboarding checklist.", "Ada", "2026-05-30"),
    action("a2", "m2", "Verify routing rule.", "Ben"),
    action("a3", "m3", "Document wiki schema.", "Mira"),
    action("a4", "m3", "Unowned follow-up."),
  ];

  const insights = buildCompanyBrainInsights({ decisions, actions });

  assert.equal(insights.counts.ownershipSubjects, 2);
  assert.equal(insights.counts.ownershipChanges, 1);
  const wallace = insights.ownership.find((item) => item.subject === "Wallace onboarding");
  assert(wallace);
  assert.equal(wallace.owner, "Ben");
  assert.equal(wallace.previousOwner, "Ada");
  assert.equal(wallace.fallbackReviewer, "Ada");
  assert.equal(insights.openActionsByOwner[0].count, 1);
  assert.equal(insights.unownedOpenActions.length, 1);
});

function decision(id: string, meetingId: string, text: string, createdAt: string): DecisionRecord {
  return {
    id,
    meetingId,
    text,
    status: "accepted",
    createdAt,
  };
}

function action(id: string, meetingId: string, text: string, owner?: string, dueDate?: string): ActionItemRecord {
  return {
    id,
    meetingId,
    text,
    owner,
    dueDate,
    status: "open",
    createdAt: "2026-05-01T10:00:00.000Z",
  };
}
test("company brain insights use meeting time when imports arrive out of order", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-insights-order-"));
  const env = preserveEnv([
    "PERRY_DB_PATH",
    "PERRY_CONFIG_PATH",
    "PERRY_DEFAULT_PUBLISH_MODE",
    "PERRY_DISCORD_DRY_RUN",
    "PERRY_NOTION_DRY_RUN",
    "PERRY_GRAPHITI_ENABLED",
  ]);

  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  process.env.PERRY_DEFAULT_PUBLISH_MODE = "auto";
  process.env.PERRY_DISCORD_DRY_RUN = "true";
  process.env.PERRY_NOTION_DRY_RUN = "true";
  process.env.PERRY_GRAPHITI_ENABLED = "false";

  try {
    await processGranolaZapierPayload({
      note_id: "ownership-newer",
      title: "Wallace Ownership Handoff",
      summary:
        "Decisions:\n" +
        "- Ben now owns Wallace onboarding; Ada is the fallback reviewer.\n\n" +
        "Action items:\n" +
        "- Ben: Publish handoff notes.",
      calendar_event: { title: "Wallace Ownership Handoff", start_time: "2026-05-08T10:00:00.000Z" },
      attendees: [{ name: "Ben", email: "ben@doppel.example" }],
    });

    await processGranolaZapierPayload({
      note_id: "ownership-older",
      title: "Wallace Kickoff",
      summary:
        "Decisions:\n" +
        "- Ada owns Wallace onboarding until the next planning review.\n\n" +
        "Action items:\n" +
        "- Ada: Draft kickoff notes.",
      calendar_event: { title: "Wallace Kickoff", start_time: "2026-05-01T10:00:00.000Z" },
      attendees: [{ name: "Ada", email: "ada@doppel.example" }],
    });

    const insights = getCompanyBrainInsights();
    const wallace = insights.ownership.find((item) => item.subject === "Wallace onboarding");

    assert(wallace);
    assert.equal(wallace.owner, "Ben");
    assert.equal(wallace.previousOwner, "Ada");
    assert.equal(insights.counts.ownershipChanges, 1);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

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