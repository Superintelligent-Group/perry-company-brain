import { parseOwnershipDecision } from "@brain";
import {
  listActionItems,
  listDecisions,
  listIssues,
  listPivots,
  listUsers,
  upsertIssue,
  upsertPivot,
  upsertUser,
  type ActionItemRecord,
  type DecisionRecord,
  type IssueRecord,
  type PivotRecord,
  type UserRecord,
} from "@store";

export interface MultiplayerProjectionResult {
  users: UserRecord[];
  issues: IssueRecord[];
  pivots: PivotRecord[];
  createdOrUpdated: {
    users: number;
    issues: number;
    pivots: number;
  };
}

export function projectMultiplayerState(limit = 10_000): MultiplayerProjectionResult {
  return projectMultiplayerStateFromRecords({
    decisions: listDecisions(limit),
    actions: listActionItems(limit),
  });
}

export function projectMultiplayerStateFromRecords(input: {
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}): MultiplayerProjectionResult {
  const users = new Map<string, UserRecord>();
  let issueCount = 0;
  let pivotCount = 0;

  for (const action of input.actions) {
    if (action.owner) {
      const user = upsertUser({ displayName: action.owner });
      users.set(user.id, user);
    }
    const issue = upsertIssue({
      id: `issue:${action.id}`,
      project: inferProject(action.text),
      title: action.text,
      status: action.status === "done" ? "done" : action.status === "wont-do" ? "canceled" : "open",
      priority: inferPriority(action.text),
      owner: action.owner,
      sourceMeetingId: action.meetingId,
      sourceActionId: action.id,
      dueDate: action.dueDate,
      preserveMutableFields: true,
    });
    issueCount += 1;
    if (issue.owner) {
      const user = upsertUser({ displayName: issue.owner });
      users.set(user.id, user);
    }
  }

  for (const decision of [...input.decisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const ownership = parseOwnershipDecision(decision);
    if (!ownership) continue;
    const owner = upsertUser({ displayName: ownership.owner });
    users.set(owner.id, owner);
    if (ownership.fallbackReviewer) {
      const fallback = upsertUser({ displayName: ownership.fallbackReviewer });
      users.set(fallback.id, fallback);
    }
    const relatedIssues = listIssues({ project: inferProject(ownership.subject), status: "open", limit: 20 }).map(
      (issue) => issue.id
    );
    upsertPivot({
      id: `pivot:${decision.id}`,
      project: inferProject(ownership.subject),
      subject: ownership.subject,
      previousOwner: ownership.previousOwner,
      newOwner: ownership.owner,
      fallbackReviewer: ownership.fallbackReviewer,
      reason: decision.text,
      sourceDecisionId: decision.id,
      sourceMeetingId: decision.meetingId,
      affectedIssueIds: relatedIssues,
      createdAt: decision.createdAt,
    });
    pivotCount += 1;
  }

  return {
    users: listUsers({ limit: 10_000 }),
    issues: listIssues({ limit: 10_000 }),
    pivots: listPivots({ limit: 10_000 }),
    createdOrUpdated: {
      users: users.size,
      issues: issueCount,
      pivots: pivotCount,
    },
  };
}

function inferPriority(text: string): IssueRecord["priority"] {
  if (/\burgent|asap|blocker|blocked\b/iu.test(text)) return "urgent";
  if (/\bhigh priority|customer|launch\b/iu.test(text)) return "high";
  return "normal";
}

function inferProject(text: string): string | undefined {
  const projects = ["Wallace", "Perry", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory"];
  return projects.find((project) => text.toLowerCase().includes(project.toLowerCase()));
}
