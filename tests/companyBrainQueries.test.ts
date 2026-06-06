import assert from "node:assert/strict";
import test from "node:test";
import {
  queryChangedSince,
  queryConflicts,
  queryDecisionHistory,
  queryOwnerLoad,
  queryProjectState,
  queryStaleActions,
  type QueryContext,
} from "@brain";
import type { ActionItemRecord, DecisionRecord, MeetingRecord } from "@store";

test("company brain query suite exposes object-level operational reads", () => {
  const context: QueryContext = {
    meetings: [
      meeting("m1", "Atlas Planning", "2026-05-01T10:00:00.000Z"),
      meeting("m2", "Atlas Handoff", "2026-05-08T10:00:00.000Z"),
      meeting("m3", "Wallace Escalation", "2026-05-20T10:00:00.000Z"),
    ],
    decisions: [
      decision("d1", "m1", "Ada owns Atlas retrieval until the next planning review.", "2026-05-01T10:00:00.000Z"),
      decision("d2", "m2", "Ben now owns Atlas retrieval; Ada is the fallback reviewer.", "2026-05-08T10:00:00.000Z"),
      decision("d3", "m3", "Mira now owns Wallace escalation; Kai is the fallback reviewer.", "2026-05-20T10:00:00.000Z"),
      decision("d4", "m4", "Iris now owns Wallace escalation; Kai is the fallback reviewer.", "2026-05-20T10:00:00.000Z"),
      decision("d5", "m5", "De-scope Atlas v2 to core workflows.", "2026-05-09T10:00:00.000Z"),
      decision("d6", "m6", "De-scope Atlas v2 to core workflows.", "2026-05-10T10:00:00.000Z"),
    ],
    actions: [
      action("a1", "m1", "Review Atlas retrieval plan.", "Ada", undefined, "2026-04-01T10:00:00.000Z"),
      action("a2", "m2", "Ship Atlas retrieval migration.", "Ben", "2026-05-05", "2026-05-08T10:00:00.000Z"),
      action("a3", "m3", "Write Wallace customer update.", "Mira", undefined, "2026-05-20T10:00:00.000Z"),
    ],
  };

  const atlas = queryProjectState({ project: "Atlas" }, context);
  assert.equal(atlas.counts.meetings, 2);
  assert.equal(atlas.counts.decisions, 4);
  assert.equal(atlas.counts.openActions, 2);

  const ownerLoad = queryOwnerLoad("Ben", context, { now: "2026-05-25T00:00:00.000Z" });
  assert.equal(ownerLoad.openActions, 1);
  assert.equal(ownerLoad.overdueActions, 1);
  assert.equal(ownerLoad.projects[0].project, "Atlas");

  const history = queryDecisionHistory("Atlas retrieval", context);
  assert.equal(history.decisions.length, 2);
  assert.equal(history.currentOwner, "Ben");

  const stale = queryStaleActions(context, { now: "2026-05-25T00:00:00.000Z", staleActionDays: 14 });
  assert.equal(stale.actions.length, 2);
  assert(stale.actions.some((item) => item.id === "a1" && !item.overdue));
  assert(stale.actions.some((item) => item.id === "a2" && item.overdue));

  const conflicts = queryConflicts(context, { duplicateThemeThreshold: 2 });
  assert(conflicts.some((item) => item.type === "ownership_conflict" && item.subject === "Wallace escalation"));
  assert(conflicts.some((item) => item.type === "duplicate_decision_theme" && item.subject === "de scope atlas v2 core workflows"));

  const changed = queryChangedSince("2026-05-08T00:00:00.000Z", context, { project: "Atlas" });
  assert.equal(changed.meetings.length, 1);
  assert.equal(changed.decisions.length, 3);
  assert.equal(changed.actions.length, 1);
});

function meeting(id: string, title: string, createdAt: string): MeetingRecord {
  return {
    id,
    source: "granola",
    sourceId: id,
    title,
    createdAt,
    updatedAt: createdAt,
    status: "processed",
  };
}

function decision(id: string, meetingId: string, text: string, createdAt: string): DecisionRecord {
  return {
    id,
    meetingId,
    text,
    status: "accepted",
    createdAt,
  };
}

function action(id: string, meetingId: string, text: string, owner: string, dueDate: string | undefined, createdAt: string): ActionItemRecord {
  return {
    id,
    meetingId,
    text,
    owner,
    dueDate,
    status: "open",
    createdAt,
  };
}