import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyBrainHealth } from "@brain";
import type { ActionItemRecord, DecisionRecord } from "@store";

test("company brain health flags unowned stale overdue load churn and conflicts", () => {
  const decisions: DecisionRecord[] = [
    decision("d1", "m1", "Ada owns Wallace onboarding until the next planning review.", "2026-05-01T10:00:00.000Z"),
    decision("d2", "m2", "Ben now owns Wallace onboarding; Ada is the fallback reviewer.", "2026-05-08T10:00:00.000Z"),
    decision("d3", "m3", "Mira now owns Wallace onboarding; Ben is the fallback reviewer.", "2026-05-15T10:00:00.000Z"),
    decision("d4", "m4", "Kai now owns Atlas retrieval; Iris is the fallback reviewer.", "2026-05-10T10:00:00.000Z"),
    decision("d5", "m5", "Iris now owns Atlas retrieval; Kai is the fallback reviewer.", "2026-05-10T10:00:00.000Z"),
  ];
  const actions: ActionItemRecord[] = [
    action("a1", "m1", "Find owner for release checklist.", undefined, undefined, "2026-05-01T10:00:00.000Z"),
    action("a2", "m2", "Ship overdue migration.", "Ada", "2026-05-05", "2026-05-01T10:00:00.000Z"),
    action("a3", "m3", "Refresh stale onboarding notes.", "Ben", undefined, "2026-04-01T10:00:00.000Z"),
    action("a4", "m4", "Review hotspot one.", "Mira", undefined, "2026-05-20T10:00:00.000Z"),
    action("a5", "m4", "Review hotspot two.", "Mira", undefined, "2026-05-20T10:00:00.000Z"),
  ];

  const report = buildCompanyBrainHealth(
    { decisions, actions },
    {
      now: "2026-05-25T12:00:00.000Z",
      staleActionDays: 14,
      ownerLoadThreshold: 2,
      ownershipChurnThreshold: 2,
    }
  );

  assert.equal(report.counts.issueCount, 6);
  assert.equal(report.counts.critical, 3);
  assert.equal(report.counts.warning, 3);
  assert.equal(report.counts.unownedOpenActions, 1);
  assert.equal(report.counts.overdueOpenActions, 1);
  assert.equal(report.counts.staleOpenActions, 1);
  assert.equal(report.counts.ownerLoadHotspots, 1);
  assert.equal(report.counts.ownershipChurnSubjects, 1);
  assert.equal(report.counts.ownershipConflicts, 1);
  assert(report.issues.some((issue) => issue.type === "ownership_churn" && issue.subject === "Wallace onboarding"));
  assert(report.issues.some((issue) => issue.type === "ownership_conflict" && issue.subject === "Atlas retrieval"));
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

function action(
  id: string,
  meetingId: string,
  text: string,
  owner: string | undefined,
  dueDate: string | undefined,
  createdAt: string
): ActionItemRecord {
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