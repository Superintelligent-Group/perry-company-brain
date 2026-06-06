import {
  buildCompanyBrainInsights,
  parseOwnershipDecision,
  type OwnershipHistoryItem,
} from "./insights";
import {
  listActionItems,
  listDecisions,
  type ActionItemRecord,
  type DecisionRecord,
} from "@store";

export type BrainHealthSeverity = "info" | "warning" | "critical";
export type BrainHealthIssueType =
  | "unowned_action"
  | "overdue_action"
  | "stale_action"
  | "owner_load_hotspot"
  | "ownership_churn"
  | "ownership_conflict";

export interface BrainHealthIssue {
  type: BrainHealthIssueType;
  severity: BrainHealthSeverity;
  title: string;
  detail: string;
  subject?: string;
  owner?: string;
  sourceIds: string[];
}

export interface BrainHealthOptions {
  now?: string;
  staleActionDays?: number;
  ownerLoadThreshold?: number;
  ownershipChurnThreshold?: number;
}

export interface CompanyBrainHealthReport {
  generatedAt: string;
  options: Required<BrainHealthOptions>;
  counts: {
    decisionsAnalyzed: number;
    actionsAnalyzed: number;
    issueCount: number;
    critical: number;
    warning: number;
    info: number;
    unownedOpenActions: number;
    overdueOpenActions: number;
    staleOpenActions: number;
    ownerLoadHotspots: number;
    ownershipChurnSubjects: number;
    ownershipConflicts: number;
  };
  issues: BrainHealthIssue[];
}

export function getCompanyBrainHealth(limit = 10_000, options: BrainHealthOptions = {}): CompanyBrainHealthReport {
  return buildCompanyBrainHealth(
    {
      decisions: listDecisions(limit),
      actions: listActionItems(limit),
    },
    options
  );
}

export function buildCompanyBrainHealth(
  input: { decisions: DecisionRecord[]; actions: ActionItemRecord[] },
  options: BrainHealthOptions = {}
): CompanyBrainHealthReport {
  const resolved = resolveOptions(options);
  const now = new Date(resolved.now);
  const insights = buildCompanyBrainInsights(input);
  const issues: BrainHealthIssue[] = [];

  for (const action of insights.unownedOpenActions) {
    issues.push({
      type: "unowned_action",
      severity: "critical",
      title: "Open action has no owner",
      detail: action.text,
      sourceIds: [action.id, action.meetingId],
    });
  }

  for (const action of input.actions.filter((item) => item.status === "open" && item.owner)) {
    const dueAt = parseDate(action.dueDate);
    if (dueAt && dueAt < startOfDay(now)) {
      issues.push({
        type: "overdue_action",
        severity: "critical",
        title: "Open action is overdue",
        detail: action.text,
        owner: action.owner,
        sourceIds: [action.id, action.meetingId],
      });
      continue;
    }

    const createdAt = parseDate(action.createdAt);
    if (!dueAt && createdAt && ageDays(createdAt, now) >= resolved.staleActionDays) {
      issues.push({
        type: "stale_action",
        severity: "warning",
        title: `Open action is stale for ${ageDays(createdAt, now)} days`,
        detail: action.text,
        owner: action.owner,
        sourceIds: [action.id, action.meetingId],
      });
    }
  }

  for (const ownerLoad of insights.openActionsByOwner) {
    if (ownerLoad.count < resolved.ownerLoadThreshold) continue;
    issues.push({
      type: "owner_load_hotspot",
      severity: "warning",
      title: `${ownerLoad.owner} has ${ownerLoad.count} open actions`,
      detail: `Threshold is ${resolved.ownerLoadThreshold}; ${ownerLoad.overdueOrDatedCount} action(s) have due dates.`,
      owner: ownerLoad.owner,
      sourceIds: ownerLoad.actions.map((action) => action.id),
    });
  }

  for (const churn of ownershipChurn(insights.ownershipHistory, resolved.ownershipChurnThreshold)) {
    issues.push({
      type: "ownership_churn",
      severity: "warning",
      title: `${churn.subject} changed owner ${churn.changeCount} times`,
      detail: `Owner path: ${churn.owners.join(" -> ")}`,
      subject: churn.subject,
      sourceIds: churn.sourceIds,
    });
  }

  for (const conflict of sameTimeOwnershipConflicts(input.decisions)) {
    issues.push({
      type: "ownership_conflict",
      severity: "critical",
      title: `${conflict.subject} has conflicting same-time owners`,
      detail: `Owners: ${conflict.owners.join(", ")}`,
      subject: conflict.subject,
      sourceIds: conflict.sourceIds,
    });
  }

  const sortedIssues = issues.sort(compareIssues);
  return {
    generatedAt: new Date().toISOString(),
    options: resolved,
    counts: {
      decisionsAnalyzed: input.decisions.length,
      actionsAnalyzed: input.actions.length,
      issueCount: sortedIssues.length,
      critical: sortedIssues.filter((item) => item.severity === "critical").length,
      warning: sortedIssues.filter((item) => item.severity === "warning").length,
      info: sortedIssues.filter((item) => item.severity === "info").length,
      unownedOpenActions: sortedIssues.filter((item) => item.type === "unowned_action").length,
      overdueOpenActions: sortedIssues.filter((item) => item.type === "overdue_action").length,
      staleOpenActions: sortedIssues.filter((item) => item.type === "stale_action").length,
      ownerLoadHotspots: sortedIssues.filter((item) => item.type === "owner_load_hotspot").length,
      ownershipChurnSubjects: sortedIssues.filter((item) => item.type === "ownership_churn").length,
      ownershipConflicts: sortedIssues.filter((item) => item.type === "ownership_conflict").length,
    },
    issues: sortedIssues,
  };
}

function resolveOptions(options: BrainHealthOptions): Required<BrainHealthOptions> {
  return {
    now: options.now ?? new Date().toISOString(),
    staleActionDays: Math.max(1, Math.trunc(options.staleActionDays ?? 30)),
    ownerLoadThreshold: Math.max(1, Math.trunc(options.ownerLoadThreshold ?? 10)),
    ownershipChurnThreshold: Math.max(1, Math.trunc(options.ownershipChurnThreshold ?? 2)),
  };
}

function ownershipChurn(history: OwnershipHistoryItem[], threshold: number): Array<{
  subject: string;
  changeCount: number;
  owners: string[];
  sourceIds: string[];
}> {
  const bySubject = new Map<string, OwnershipHistoryItem[]>();
  for (const item of history) {
    bySubject.set(item.subject, [...(bySubject.get(item.subject) ?? []), item]);
  }

  const churn = [];
  for (const [subject, items] of bySubject.entries()) {
    const owners = items.map((item) => item.owner);
    let changeCount = 0;
    for (let index = 1; index < owners.length; index += 1) {
      if (owners[index] !== owners[index - 1]) changeCount += 1;
    }
    if (changeCount >= threshold) {
      churn.push({
        subject,
        changeCount,
        owners,
        sourceIds: items.map((item) => item.sourceDecisionId),
      });
    }
  }
  return churn;
}

function sameTimeOwnershipConflicts(decisions: DecisionRecord[]): Array<{
  subject: string;
  owners: string[];
  sourceIds: string[];
}> {
  const groups = new Map<string, Array<{ owner: string; decision: DecisionRecord }>>();
  for (const decision of decisions) {
    const parsed = parseOwnershipDecision(decision);
    if (!parsed) continue;
    const key = `${parsed.subject}\n${decision.createdAt}`;
    groups.set(key, [...(groups.get(key) ?? []), { owner: parsed.owner, decision }]);
  }

  const conflicts = [];
  for (const [key, items] of groups.entries()) {
    const owners = unique(items.map((item) => item.owner));
    if (owners.length < 2) continue;
    const [subject] = key.split("\n");
    conflicts.push({
      subject,
      owners,
      sourceIds: items.map((item) => item.decision.id),
    });
  }
  return conflicts;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function ageDays(start: Date, end: Date): number {
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000);
}

function compareIssues(a: BrainHealthIssue, b: BrainHealthIssue): number {
  return severityRank(b.severity) - severityRank(a.severity) || a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
}

function severityRank(severity: BrainHealthSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}