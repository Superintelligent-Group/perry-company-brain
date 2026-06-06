import { listActionItems, listDecisions, type ActionItemRecord, type DecisionRecord } from "@store";

export interface OwnershipInsight {
  subject: string;
  owner: string;
  previousOwner?: string;
  fallbackReviewer?: string;
  sourceDecisionId: string;
  sourceMeetingId: string;
  updatedAt: string;
  sourceText: string;
}

export interface OwnershipHistoryItem extends OwnershipInsight {
  sequence: number;
}

export interface OpenActionOwnerInsight {
  owner: string;
  count: number;
  overdueOrDatedCount: number;
  actions: ActionItemRecord[];
}

export interface CompanyBrainInsights {
  generatedAt: string;
  counts: {
    decisionsAnalyzed: number;
    actionsAnalyzed: number;
    ownershipSubjects: number;
    ownersWithOpenActions: number;
    ownershipChanges: number;
  };
  ownership: OwnershipInsight[];
  ownershipHistory: OwnershipHistoryItem[];
  openActionsByOwner: OpenActionOwnerInsight[];
  unownedOpenActions: ActionItemRecord[];
}

export function getCompanyBrainInsights(limit = 10_000): CompanyBrainInsights {
  return buildCompanyBrainInsights({
    decisions: listDecisions(limit),
    actions: listActionItems(limit),
  });
}

export function buildCompanyBrainInsights(input: {
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}): CompanyBrainInsights {
  const decisions = [...input.decisions].sort(compareRecords);
  const actions = [...input.actions].sort(compareRecords);
  const currentOwnership = new Map<string, OwnershipInsight>();
  const ownershipHistory: OwnershipHistoryItem[] = [];

  decisions.forEach((decision) => {
    const parsed = parseOwnershipDecision(decision);
    if (!parsed) return;
    const previous = currentOwnership.get(parsed.subject);
    const insight: OwnershipInsight = {
      subject: parsed.subject,
      owner: parsed.owner,
      previousOwner: parsed.previousOwner ?? previous?.owner,
      fallbackReviewer: parsed.fallbackReviewer,
      sourceDecisionId: decision.id,
      sourceMeetingId: decision.meetingId,
      updatedAt: decision.createdAt,
      sourceText: decision.text,
    };
    currentOwnership.set(parsed.subject, insight);
    ownershipHistory.push({ ...insight, sequence: ownershipHistory.length + 1 });
  });

  const openActions = actions.filter((action) => action.status === "open");
  const actionsByOwner = new Map<string, ActionItemRecord[]>();
  const unownedOpenActions: ActionItemRecord[] = [];
  for (const action of openActions) {
    if (!action.owner) {
      unownedOpenActions.push(action);
      continue;
    }
    const existing = actionsByOwner.get(action.owner) ?? [];
    existing.push(action);
    actionsByOwner.set(action.owner, existing);
  }

  const openActionsByOwner = [...actionsByOwner.entries()]
    .map(([owner, ownerActions]) => ({
      owner,
      count: ownerActions.length,
      overdueOrDatedCount: ownerActions.filter((action) => Boolean(action.dueDate)).length,
      actions: ownerActions.slice(0, 20),
    }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));

  const ownership = [...currentOwnership.values()].sort((a, b) => a.subject.localeCompare(b.subject));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      decisionsAnalyzed: decisions.length,
      actionsAnalyzed: actions.length,
      ownershipSubjects: ownership.length,
      ownersWithOpenActions: openActionsByOwner.length,
      ownershipChanges: ownershipHistory.filter((item) => Boolean(item.previousOwner) && item.previousOwner !== item.owner).length,
    },
    ownership,
    ownershipHistory,
    openActionsByOwner,
    unownedOpenActions,
  };
}

export function parseOwnershipDecision(decision: DecisionRecord): {
  owner: string;
  subject: string;
  previousOwner?: string;
  fallbackReviewer?: string;
} | undefined {
  const normalized = decision.text.replace(/\s+/gu, " ").trim();
  const nowOwns = normalized.match(
    /^(?<owner>[A-Z][\w .'-]{1,40})\s+now owns\s+(?<subject>.+?)(?:;\s*(?<fallback>[A-Z][\w .'-]{1,40})\s+is the fallback reviewer)?\.?$/u
  );
  if (nowOwns?.groups) {
    return {
      owner: nowOwns.groups.owner.trim(),
      subject: cleanSubject(nowOwns.groups.subject),
      previousOwner: nowOwns.groups.fallback?.trim(),
      fallbackReviewer: nowOwns.groups.fallback?.trim(),
    };
  }

  const ownsUntil = normalized.match(
    /^(?<owner>[A-Z][\w .'-]{1,40})\s+owns\s+(?<subject>.+?)\s+until\s+.+\.?$/u
  );
  if (ownsUntil?.groups) {
    return {
      owner: ownsUntil.groups.owner.trim(),
      subject: cleanSubject(ownsUntil.groups.subject),
    };
  }

  return undefined;
}

function cleanSubject(subject: string): string {
  return subject.replace(/[.;]\s*$/u, "").trim();
}

function compareRecords(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
