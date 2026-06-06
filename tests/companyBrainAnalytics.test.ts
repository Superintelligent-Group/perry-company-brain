import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyBrainAnalytics } from "@brain";
import type { ActionItemRecord, DecisionRecord, MeetingRecord } from "@store";

test("company brain analytics summarizes workload themes and quality signals", () => {
  const meetings: MeetingRecord[] = [
    meeting("m1", "Atlas v2 Planning", "2026-05-01T10:00:00.000Z"),
    meeting("m2", "Atlas v2 Planning", "2026-05-01T11:00:00.000Z"),
    meeting("m3", "Wallace Customer Escalation", "2026-05-02T10:00:00.000Z"),
  ];
  const decisions: DecisionRecord[] = [
    decision("d1", "m1", "De-scope Atlas v2 to core workflows.", "2026-05-01T10:00:00.000Z"),
    decision("d2", "m2", "De-scope Atlas v2 to core workflows.", "2026-05-01T11:00:00.000Z"),
    decision("d3", "m3", "Ada owns Wallace escalation until the next planning review.", "2026-05-02T10:00:00.000Z"),
  ];
  const actions: ActionItemRecord[] = [
    action("a1", "m1", "Draft Atlas migration note.", "Ada"),
    action("a2", "m2", "Draft Atlas migration note.", "Ada"),
    action("a3", "m3", "Route Wallace customer update.", "Ben"),
    action("a4", "m3", "Unowned customer follow-up."),
  ];

  const report = buildCompanyBrainAnalytics({ meetings, decisions, actions });

  assert.equal(report.counts.meetings, 3);
  assert.equal(report.counts.decisions, 3);
  assert.equal(report.counts.actions, 4);
  assert.equal(report.counts.openActions, 4);
  assert.equal(report.counts.owners, 2);
  assert.equal(report.counts.unownedActions, 1);
  assert.equal(report.ownerWorkload[0].owner, "Ada");
  assert.equal(report.ownerWorkload[0].openActions, 2);
  assert.equal(report.meetingTitleClusters[0].count, 2);
  assert.equal(report.decisionThemes[0].count, 2);
  assert.equal(report.actionThemes[0].count, 2);
  assert.equal(report.dailyVolume[0].key, "2026-05-01");
  assert.equal(report.dailyVolume[0].count, 2);
  assert.equal(report.qualitySignals.unownedActionRate, 0.25);
  assert.equal(report.health.counts.unownedOpenActions, 1);
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

function action(id: string, meetingId: string, text: string, owner?: string): ActionItemRecord {
  return {
    id,
    meetingId,
    text,
    owner,
    status: "open",
    createdAt: "2026-05-01T10:00:00.000Z",
  };
}