import {
  listActionItems,
  listDecisions,
  listMeetingRecords,
  searchBrain,
  type ActionItemRecord,
  type BrainSearchResult,
  type DecisionRecord,
  type MeetingRecord,
} from "@store";
import { parseOwnershipDecision } from "./insights";

export interface QueryContext {
  meetings: MeetingRecord[];
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}

export interface ProjectStateQuery {
  project: string;
  searchLimit?: number;
}

export interface ProjectStateResult {
  project: string;
  counts: {
    meetings: number;
    decisions: number;
    actions: number;
    openActions: number;
    owners: number;
  };
  owners: Array<{ owner: string; openActions: number; examples: string[] }>;
  recentMeetings: MeetingRecord[];
  recentDecisions: DecisionRecord[];
  openActions: ActionItemRecord[];
  searchResults: BrainSearchResult[];
}

export interface OwnerLoadResult {
  owner: string;
  openActions: number;
  datedActions: number;
  overdueActions: number;
  staleActions: number;
  projects: Array<{ project: string; count: number }>;
  actions: ActionItemRecord[];
}

export interface DecisionHistoryResult {
  subject: string;
  decisions: Array<{
    decision: DecisionRecord;
    owner?: string;
    previousOwner?: string;
    fallbackReviewer?: string;
  }>;
  currentOwner?: string;
}

export interface StaleActionsResult {
  now: string;
  staleActionDays: number;
  actions: Array<ActionItemRecord & { ageDays: number; overdue: boolean }>;
}

export interface ConflictResult {
  type: "ownership_conflict" | "duplicate_decision_theme";
  subject: string;
  detail: string;
  decisionIds: string[];
  meetingIds: string[];
}

export interface ChangedSinceResult {
  since: string;
  project?: string;
  meetings: MeetingRecord[];
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}

export function getQueryContext(limit = 100_000): QueryContext {
  return {
    meetings: paged((offset) => listMeetingRecords({ limit: 1000, offset }), limit),
    decisions: paged((offset) => listDecisions(5000, offset), limit),
    actions: paged((offset) => listActionItems(5000, offset), limit),
  };
}

export function queryProjectState(input: ProjectStateQuery, context = getQueryContext()): ProjectStateResult {
  const project = input.project.trim();
  const meetings = context.meetings.filter((meeting) => matchesText(meeting.title, project));
  const decisions = context.decisions.filter((decision) => matchesText(decision.text, project));
  const actions = context.actions.filter((action) => matchesText(`${action.text} ${action.owner ?? ""}`, project));
  const openActions = actions.filter((action) => action.status === "open");
  const owners = summarizeOwners(openActions);
  return {
    project,
    counts: {
      meetings: meetings.length,
      decisions: decisions.length,
      actions: actions.length,
      openActions: openActions.length,
      owners: owners.length,
    },
    owners,
    recentMeetings: sortByCreatedDesc(meetings).slice(0, 20),
    recentDecisions: sortByCreatedDesc(decisions).slice(0, 20),
    openActions: sortByCreatedDesc(openActions).slice(0, 50),
    searchResults: searchBrain(project, input.searchLimit ?? 25),
  };
}

export function queryOwnerLoad(owner: string, context = getQueryContext(), options: { now?: string; staleActionDays?: number } = {}): OwnerLoadResult {
  const now = new Date(options.now ?? new Date().toISOString());
  const staleActionDays = Math.max(1, Math.trunc(options.staleActionDays ?? 30));
  const actions = context.actions.filter((action) => action.status === "open" && action.owner === owner);
  return {
    owner,
    openActions: actions.length,
    datedActions: actions.filter((action) => Boolean(action.dueDate)).length,
    overdueActions: actions.filter((action) => isOverdue(action, now)).length,
    staleActions: actions.filter((action) => !action.dueDate && ageDays(new Date(action.createdAt), now) >= staleActionDays).length,
    projects: bucketProjects(actions),
    actions: sortByCreatedDesc(actions).slice(0, 100),
  };
}

export function queryDecisionHistory(subject: string, context = getQueryContext()): DecisionHistoryResult {
  const decisions = sortByCreatedAsc(
    context.decisions.filter((decision) => matchesText(decision.text, subject))
  );
  const history = decisions.map((decision) => {
    const ownership = parseOwnershipDecision(decision);
    return {
      decision,
      owner: ownership?.owner,
      previousOwner: ownership?.previousOwner,
      fallbackReviewer: ownership?.fallbackReviewer,
    };
  });
  return {
    subject,
    decisions: history,
    currentOwner: [...history].reverse().find((item) => item.owner)?.owner,
  };
}

export function queryStaleActions(context = getQueryContext(), options: { now?: string; staleActionDays?: number; owner?: string; project?: string } = {}): StaleActionsResult {
  const now = new Date(options.now ?? new Date().toISOString());
  const staleActionDays = Math.max(1, Math.trunc(options.staleActionDays ?? 30));
  const actions = context.actions
    .filter((action) => action.status === "open")
    .filter((action) => !options.owner || action.owner === options.owner)
    .filter((action) => !options.project || matchesText(action.text, options.project))
    .map((action) => ({
      ...action,
      ageDays: ageDays(new Date(action.createdAt), now),
      overdue: isOverdue(action, now),
    }))
    .filter((action) => action.overdue || (!action.dueDate && action.ageDays >= staleActionDays))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.ageDays - a.ageDays);
  return { now: now.toISOString(), staleActionDays, actions };
}

export function queryConflicts(context = getQueryContext(), options: { duplicateThemeThreshold?: number } = {}): ConflictResult[] {
  return [
    ...sameTimeOwnershipConflicts(context.decisions),
    ...duplicateDecisionThemes(context.decisions, Math.max(2, Math.trunc(options.duplicateThemeThreshold ?? 10))),
  ];
}

export function queryChangedSince(since: string, context = getQueryContext(), options: { project?: string } = {}): ChangedSinceResult {
  const sinceDate = new Date(since);
  const project = options.project?.trim();
  const isIncluded = (value: { createdAt: string }, text: string) => {
    const createdAt = new Date(value.createdAt);
    return createdAt >= sinceDate && (!project || matchesText(text, project));
  };
  return {
    since: sinceDate.toISOString(),
    project,
    meetings: sortByCreatedDesc(context.meetings.filter((meeting) => isIncluded(meeting, meeting.title))).slice(0, 100),
    decisions: sortByCreatedDesc(context.decisions.filter((decision) => isIncluded(decision, decision.text))).slice(0, 100),
    actions: sortByCreatedDesc(context.actions.filter((action) => isIncluded(action, `${action.text} ${action.owner ?? ""}`))).slice(0, 100),
  };
}

function summarizeOwners(actions: ActionItemRecord[]): Array<{ owner: string; openActions: number; examples: string[] }> {
  const byOwner = new Map<string, ActionItemRecord[]>();
  for (const action of actions) {
    if (!action.owner) continue;
    byOwner.set(action.owner, [...(byOwner.get(action.owner) ?? []), action]);
  }
  return [...byOwner.entries()]
    .map(([owner, ownerActions]) => ({
      owner,
      openActions: ownerActions.length,
      examples: ownerActions.slice(0, 5).map((action) => action.text),
    }))
    .sort((a, b) => b.openActions - a.openActions || a.owner.localeCompare(b.owner));
}

function sameTimeOwnershipConflicts(decisions: DecisionRecord[]): ConflictResult[] {
  const groups = new Map<string, Array<{ owner: string; subject: string; decision: DecisionRecord }>>();
  for (const decision of decisions) {
    const parsed = parseOwnershipDecision(decision);
    if (!parsed) continue;
    const key = `${parsed.subject}\n${decision.createdAt}`;
    groups.set(key, [...(groups.get(key) ?? []), { owner: parsed.owner, subject: parsed.subject, decision }]);
  }
  const out: ConflictResult[] = [];
  for (const items of groups.values()) {
    const owners = unique(items.map((item) => item.owner));
    if (owners.length < 2) continue;
    out.push({
      type: "ownership_conflict",
      subject: items[0].subject,
      detail: `Conflicting owners at same timestamp: ${owners.join(", ")}`,
      decisionIds: items.map((item) => item.decision.id),
      meetingIds: unique(items.map((item) => item.decision.meetingId)),
    });
  }
  return out;
}

function duplicateDecisionThemes(decisions: DecisionRecord[], threshold: number): ConflictResult[] {
  const buckets = new Map<string, DecisionRecord[]>();
  for (const decision of decisions) {
    const key = analyticsKey(decision.text);
    if (!key) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), decision]);
  }
  return [...buckets.entries()]
    .filter(([, items]) => items.length >= threshold)
    .map(([subject, items]) => ({
      type: "duplicate_decision_theme" as const,
      subject,
      detail: `${items.length} decisions share this normalized theme`,
      decisionIds: items.slice(0, 100).map((decision) => decision.id),
      meetingIds: unique(items.slice(0, 100).map((decision) => decision.meetingId)),
    }))
    .sort((a, b) => b.decisionIds.length - a.decisionIds.length || a.subject.localeCompare(b.subject));
}

function bucketProjects(actions: ActionItemRecord[]): Array<{ project: string; count: number }> {
  const buckets = new Map<string, number>();
  for (const action of actions) {
    const project = inferProject(action.text);
    buckets.set(project, (buckets.get(project) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([project, count]) => ({ project, count }))
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project));
}

function inferProject(text: string): string {
  const known = ["Perry", "Wallace", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory", "Context Engine", "Customer Brain"];
  return known.find((project) => matchesText(text, project)) ?? "unknown";
}

function matchesText(value: string, query: string): boolean {
  return normalizeText(value).includes(normalizeText(query));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function analyticsKey(value: string): string {
  const stop = new Set(["a", "an", "and", "by", "for", "from", "in", "is", "of", "on", "the", "to", "with"]);
  return normalizeText(value)
    .split(/\s+/u)
    .filter((part) => part.length > 1 && !stop.has(part) && !/^\d+$/u.test(part))
    .slice(0, 8)
    .join(" ");
}

function isOverdue(action: ActionItemRecord, now: Date): boolean {
  if (!action.dueDate) return false;
  return startOfDay(new Date(action.dueDate)) < startOfDay(now);
}

function ageDays(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime())) return 0;
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sortByCreatedDesc<T extends { createdAt: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

function sortByCreatedAsc<T extends { createdAt: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function paged<T>(readPage: (offset: number) => T[], limit: number): T[] {
  const out: T[] = [];
  let offset = 0;
  while (out.length < limit) {
    const page = readPage(offset);
    if (page.length === 0) break;
    out.push(...page.slice(0, limit - out.length));
    offset += page.length;
    if (page.length < 1000) break;
  }
  return out;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}