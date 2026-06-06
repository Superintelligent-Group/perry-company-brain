import assert from "node:assert/strict";
import test from "node:test";
import { syncActionItemRecordToNotion, syncDecisionRecordToNotion, syncProjectRecordToNotion } from "@notion";

test("notion wiki sync exposes dry-run records for decisions actions and projects", async () => {
  const previous = process.env.PERRY_NOTION_DRY_RUN;
  process.env.PERRY_NOTION_DRY_RUN = "true";
  try {
    const decision = await syncDecisionRecordToNotion({
      id: "decision:1",
      meetingId: "meeting:1",
      text: "Use graph replay diff as trust proof.",
      status: "accepted",
      createdAt: "2026-05-23T10:00:00.000Z",
    });
    const action = await syncActionItemRecordToNotion({
      id: "action:1",
      meetingId: "meeting:1",
      text: "Wire Notion wiki sync.",
      owner: "Ada",
      status: "open",
      createdAt: "2026-05-23T10:00:00.000Z",
    });
    const project = await syncProjectRecordToNotion({ project: "Wallace", owner: "Ada", status: "open" });

    assert.equal(decision?.kind, "decision");
    assert.equal(action?.kind, "action_item");
    assert.equal(project?.id, "dry-run-project-wallace");
  } finally {
    if (previous === undefined) delete process.env.PERRY_NOTION_DRY_RUN;
    else process.env.PERRY_NOTION_DRY_RUN = previous;
  }
});
