/**
 * Core domain models for Inky.
 *
 * The pipeline is: collect() -> normalize() -> [reconcile()] -> summarize() -> render()
 * Each stage consumes the previous stage's model. These types are the contract
 * between stages, so the trigger and delivery layers stay thin and swappable.
 */

/** A resolved person, after identity aliasing collapses multiple git identities. */
export interface Person {
  /** Canonical GitHub login (lowercased). The stable key across repos. */
  login: string;
  /** Human display name, best-effort from commit metadata or the GitHub profile. */
  displayName: string;
  /** All git emails seen for this person, after alias merging. */
  emails: string[];
  avatarUrl?: string;
}

/** A time window the standup covers (typically the last 24h). */
export interface Window {
  /** Inclusive ISO-8601 start. */
  since: string;
  /** Exclusive ISO-8601 end. */
  until: string;
}

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';
export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';
export type IssueState = 'open' | 'closed';

export interface CommitActivity {
  repo: string;
  sha: string;
  message: string;
  additions: number;
  deletions: number;
  url: string;
  /** ISO-8601 author timestamp. */
  authoredAt: string;
  /** True if the commit is NOT on the repo's default branch — i.e. work in
   *  progress on a feature branch, not yet shipped to main. */
  unshipped: boolean;
  /** A branch the commit lives on. Set for unshipped commits (the feature branch). */
  branch?: string;
}

export interface PullRequestActivity {
  repo: string;
  number: number;
  title: string;
  state: PullRequestState;
  additions: number;
  deletions: number;
  url: string;
  createdAt: string;
  mergedAt?: string;
  closedAt?: string;
}

export interface ReviewActivity {
  repo: string;
  /** The PR that was reviewed. */
  pullRequestNumber: number;
  pullRequestTitle: string;
  state: ReviewState;
  /** The PR author (who received the review), for context. */
  pullRequestAuthor: string;
  url: string;
  submittedAt: string;
}

export interface IssueActivity {
  repo: string;
  number: number;
  title: string;
  state: IssueState;
  /** What the person did to the issue in-window. */
  action: 'opened' | 'closed' | 'commented';
  url: string;
  at: string;
  /** The milestone this issue belongs to, if any — for roadmap reconciliation (Phase 5). */
  milestoneNumber?: number;
}

/**
 * Everything one person did across the org's repos in the window, after
 * identity aliasing. This is the output of normalize() and the input to
 * summarize(). Counts are derived in normalize() so summarize/render don't recompute.
 */
export interface PersonActivity {
  person: Person;
  commits: CommitActivity[];
  pullRequests: PullRequestActivity[];
  reviews: ReviewActivity[];
  issues: IssueActivity[];
  totals: {
    commits: number;
    /** Commits on feature branches not yet merged to default — work in progress. */
    unshippedCommits: number;
    additions: number;
    deletions: number;
    prsOpened: number;
    prsMerged: number;
    reviewsGiven: number;
    issuesOpened: number;
    issuesClosed: number;
    /** Distinct repos touched. */
    repos: number;
  };
}

/**
 * The normalized, org-wide activity for a window. Output of normalize().
 * `people` is sorted by descending activity (most active first).
 */
export interface OrgActivity {
  org: string;
  window: Window;
  people: PersonActivity[];
}

/** Org-wide rollups for the window, computed mechanically (never model-counted). */
export interface OrgTotals {
  contributors: number;
  commits: number;
  unshippedCommits: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  issuesOpened: number;
  issuesClosed: number;
  repos: number;
  additions: number;
  deletions: number;
}

/**
 * Distribution of merged (non-promotion) PRs by lines changed. Small-and-frequent
 * PRs are the healthy agentic-era pattern (faster review, lower risk), so the
 * shape matters more than the raw LOC. Buckets: xs <10, s 10–99, m 100–499,
 * l 500–999, xl 1000+ lines (additions + deletions).
 */
export interface PrSizeBuckets {
  xs: number;
  s: number;
  m: number;
  l: number;
  xl: number;
}

/**
 * OrgTotals plus a few derived, agentic-era-friendly signals for the stats panel
 * (see docs/research/agentic-coding-metrics.md): a stability proxy (reverts), a
 * throughput proxy (PR cycle time), a review-bottleneck proxy (time-to-first-
 * review), and the PR size distribution. All team-level, all cheap from data
 * Inky already has.
 */
export interface TeamStats extends OrgTotals {
  /** Commits that revert earlier work — a stability/instability proxy. */
  reverts: number;
  /** reverts / commits, 0..1 (0 when there are no commits). */
  revertRate: number;
  /** Median merged-PR cycle time (createdAt → mergedAt) in hours; null if none. */
  medianPrCycleHours: number | null;
  /**
   * Median time-to-first-review (createdAt → first non-self review) in hours for
   * PRs opened in-window; null if none were reviewed. The review-bottleneck signal
   * the agentic-era research flags as most valuable — review is the bottleneck
   * once agents speed up coding.
   */
  medianTimeToFirstReviewHours: number | null;
  /** Merged (non-promotion) PRs bucketed by lines changed. */
  prSizes: PrSizeBuckets;
  /**
   * Commit counts per 24h slice across the window, oldest first — the shape of
   * the week's activity, rendered as an in-Discord sparkline. One bucket per day
   * the window spans (e.g. 7 for a weekly standup), from data Inky already has
   * (commit timestamps); no history store needed.
   */
  dailyCommits: number[];
}

/** A person's bullets for a single repository, so work is grouped by repo. */
export interface RepoWork {
  repo: string;
  /** Bullet lines for this repo (shipped first, then WIP), with refs. */
  points: string[];
}

/** One person's section of the rendered standup. Output of summarize(). */
export interface PersonStandup {
  person: Person;
  /** AI-written prose: what they did, grounded in their activity. */
  narrative: string;
  /** Bullet highlights grouped by repo — one entry per repo the person touched. */
  work: RepoWork[];
  /** This person's raw totals, carried for an optional per-person stats line. */
  totals?: PersonActivity['totals'];
}

// ── Phase 5: roadmap reconciliation (status vs plan) ──

/** A roadmap item being tracked: a GitHub milestone, or a declared goal from ROADMAP.md. */
export interface RoadmapItem {
  /** Stable id, e.g. "milestone:web#3" or "goal:2". */
  id: string;
  kind: 'milestone' | 'goal';
  title: string;
  /** Link to the item (milestone URL, or the ROADMAP.md file); '' if none. */
  url: string;
  /** Owning repo for a milestone; '' for a declared goal. */
  repo: string;
  /** Due date if set (ISO-8601). */
  dueOn?: string;
  /**
   * Open / closed sub-item counts — milestone open/closed issues, or a declared
   * goal's unchecked/checked tasks. Gives progress for free either way.
   */
  openCount: number;
  closedCount: number;
  state: 'open' | 'closed';
}

/** How a tracked item moved this window. */
export type ItemMovement =
  | 'completed' // closed this window, or reached 100%
  | 'advanced' // ≥1 sub-issue closed in-window
  | 'in-progress' // in-window activity on its issues, but no closures
  | 'stalled' // open, no in-window activity (flagged: past/near due or simply idle)
  | 'untouched'; // open, no activity, not flagged

/** A roadmap item after reconciling the window's activity against it. */
export interface RoadmapItemStatus {
  item: RoadmapItem;
  movement: ItemMovement;
  /** Sub-issues under this item closed in-window. */
  closedThisWindow: number;
  /** closedCount / (openCount + closedCount), 0..1. */
  progress: number;
  /** Due date set, work remaining, and due within atRiskDays or already past. */
  atRisk: boolean;
  /** Short mechanical reason (e.g. "due in 3 days · 4 open", "9 days overdue"). */
  note?: string;
}

/**
 * The reconciled roadmap picture for the window. Every figure here is mechanical
 * (never model-counted) — the model only narrates from it, like the stats panel.
 */
export interface RoadmapStatus {
  items: RoadmapItemStatus[];
  /** In-window issue closures not tied to any tracked item. */
  unplanned: { closedIssues: number };
  totals: { tracked: number; completed: number; advanced: number; stalled: number; atRisk: number };
}

/** The full standup for a day. Output of summarize(), input to render(). */
export interface Standup {
  org: string;
  window: Window;
  /** AI-written org-wide summary: where the project stands today. */
  projectSummary: string;
  people: PersonStandup[];
  /** Verified team-wide stats, carried for an optional stats panel. */
  teamTotals?: TeamStats;
  /** Phase 5: AI-written, grounded narrative of where the project stands vs the plan. */
  statusVsPlan?: string;
  /** Phase 5: the mechanical roadmap reconciliation, rendered as a status panel. */
  roadmap?: RoadmapStatus;
}
