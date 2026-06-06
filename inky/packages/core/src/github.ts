/**
 * GitHub API layer. Reads org activity for a time window via Octokit (REST).
 *
 * Design notes:
 * - We read the API, not local clones, so Inky works on org repos nobody has
 *   checked out (mandatory for the future hosted tier).
 * - "Active in window" PRs = PRs whose updated_at >= since. Because a review or
 *   merge bumps updated_at, this set also surfaces reviews on older PRs.
 * - Per-item enrichment (commit/PR line counts) is bounded-concurrency and
 *   best-effort: a failed enrichment degrades to 0 lines, never aborts the run.
 */
import { Octokit } from '@octokit/rest';
import { isGeneratedPath, sumRealChurn, type NoiseMatcher } from './filter.js';
import type { RawIdentity } from './identity.js';
import type {
  CommitActivity,
  IssueActivity,
  PullRequestActivity,
  PullRequestState,
  ReviewActivity,
  ReviewState,
  Window,
} from './types.js';

/** User-Agent sent on every GitHub request (shared by the PAT and App clients). */
export const USER_AGENT = 'inky';

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: USER_AGENT });
}

/** A single file fetched from a repo. */
export interface RepoFile {
  /** UTF-8 decoded file contents. */
  content: string;
  /** Browser URL for the file (for linking). */
  url: string;
}

/**
 * Fetch one file from a repo's default branch (for the `roadmap-md` source).
 * Returns null when the path doesn't exist or isn't a regular file.
 */
export async function fetchRepoFile(
  octokit: Octokit,
  org: string,
  repo: string,
  path: string,
): Promise<RepoFile | null> {
  try {
    const res = await octokit.rest.repos.getContent({ owner: org, repo, path });
    const data = res.data;
    if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') return null;
    const content = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    return { content, url: data.html_url ?? '' };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** Compute a window ending now, spanning `hours` back. */
export function computeWindow(hours: number, now: Date): Window {
  const until = now;
  const since = new Date(now.getTime() - hours * 3600_000);
  return { since: since.toISOString(), until: until.toISOString() };
}

/** Run async work over items with a concurrency cap, preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A non-archived org repo + when it was last pushed to. */
export interface RepoMeta {
  name: string;
  /** ISO last-push timestamp, or null if never pushed. */
  pushedAt: string | null;
}

/** List non-archived repos in an org with their last-push time (no owner prefix). */
export async function listOrgRepos(octokit: Octokit, org: string): Promise<RepoMeta[]> {
  const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  });
  return repos.filter((r) => !r.archived).map((r) => ({ name: r.name, pushedAt: r.pushed_at ?? null }));
}

/**
 * Partition discovered repos into ones to scan vs ones to skip as stale.
 *   - staleDays "auto": skip repos with no push since `windowSince` (the run's
 *     window start) — correct for any window, no tuning.
 *   - staleDays N > 0: skip repos with no push in N days (fixed threshold).
 *   - staleDays 0: keep all.
 * Pure + deterministic (clock + window injected) so it's unit-tested without the API.
 */
export function filterStaleRepos(
  repos: RepoMeta[],
  opts: { staleDays: number | 'auto'; now: Date; windowSince: string },
): { kept: string[]; skipped: RepoMeta[] } {
  let cutoff: number;
  if (opts.staleDays === 'auto') {
    cutoff = new Date(opts.windowSince).getTime();
  } else if (opts.staleDays > 0) {
    cutoff = opts.now.getTime() - opts.staleDays * 86_400_000;
  } else {
    return { kept: repos.map((r) => r.name), skipped: [] };
  }
  const kept: string[] = [];
  const skipped: RepoMeta[] = [];
  for (const r of repos) {
    const pushed = r.pushedAt ? new Date(r.pushedAt).getTime() : 0;
    if (pushed >= cutoff) kept.push(r.name);
    else skipped.push(r);
  }
  return { kept, skipped };
}

function inWindow(iso: string | null | undefined, w: Window): boolean {
  if (!iso) return false;
  return iso >= w.since && iso <= w.until;
}

export interface CommitRecord {
  author: RawIdentity;
  commit: CommitActivity;
}

/** A commit list item from the GitHub API, paired with a branch we found it on. */
interface RawCommit {
  item: Awaited<ReturnType<Octokit['rest']['repos']['listCommits']>>['data'][number];
  branch: string;
}

/** List commits in-window on a single branch; never throws (returns [] on error). */
async function listBranchCommits(
  octokit: Octokit,
  org: string,
  repo: string,
  branch: string,
  window: Window,
): Promise<RawCommit['item'][]> {
  try {
    return await octokit.paginate(octokit.rest.repos.listCommits, {
      owner: org,
      repo,
      sha: branch,
      since: window.since,
      until: window.until,
      per_page: 100,
    });
  } catch {
    return []; // branch may be gone, empty, or inaccessible — skip it
  }
}

/**
 * Fetch commits authored in the window across ALL branches of a repo, so work
 * in progress on feature branches (not yet merged to the default branch) is
 * captured — not just shipped work. Commits are deduped by SHA, and each is
 * flagged `unshipped` when it isn't on the default branch.
 */
export async function fetchCommits(
  octokit: Octokit,
  org: string,
  repo: string,
  window: Window,
  isNoise: NoiseMatcher = isGeneratedPath,
): Promise<CommitRecord[]> {
  const info = await octokit.rest.repos.get({ owner: org, repo });
  const defaultBranch = info.data.default_branch;

  const branchList = await octokit.paginate(octokit.rest.repos.listBranches, {
    owner: org,
    repo,
    per_page: 100,
  });
  // Default branch first so its commits register as "shipped" before we see
  // the same SHAs on feature branches.
  const branches = [defaultBranch, ...branchList.map((b) => b.name).filter((n) => n !== defaultBranch)];

  // Fetch each branch's in-window commits (bounded concurrency), then dedupe.
  const perBranch = await mapLimit(branches, 5, async (branch) => ({
    branch,
    commits: await listBranchCommits(octokit, org, repo, branch, window),
  }));

  const shippedShas = new Set<string>();
  const seen = new Set<string>();
  const unique: RawCommit[] = [];
  for (const { branch, commits } of perBranch) {
    const isDefault = branch === defaultBranch;
    for (const item of commits) {
      if (isDefault) shippedShas.add(item.sha);
      if (seen.has(item.sha)) continue;
      seen.add(item.sha);
      unique.push({ item, branch });
    }
  }

  return mapLimit(unique, 5, async ({ item: c, branch }) => {
    const author: RawIdentity = {
      login: c.author?.login ?? null,
      email: c.commit.author?.email ?? null,
      name: c.commit.author?.name ?? null,
      avatarUrl: c.author?.avatar_url ?? null,
    };
    let additions = 0;
    let deletions = 0;
    try {
      const full = await octokit.rest.repos.getCommit({ owner: org, repo, ref: c.sha });
      // Sum only "real" churn — exclude lockfiles/generated/vendored paths.
      const churn = sumRealChurn(
        (full.data.files ?? []).map((f) => ({
          filename: f.filename,
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
        })),
        isNoise,
      );
      additions = churn.additions;
      deletions = churn.deletions;
    } catch {
      // best-effort: leave line counts at 0
    }
    const unshipped = !shippedShas.has(c.sha);
    const commit: CommitActivity = {
      repo,
      sha: c.sha,
      message: c.commit.message.split('\n', 1)[0]!,
      additions,
      deletions,
      url: c.html_url,
      authoredAt: c.commit.author?.date ?? window.until,
      unshipped,
      branch: unshipped ? branch : undefined,
    };
    return { author, commit };
  });
}

export interface PullRequestRecord {
  author: RawIdentity;
  pr: PullRequestActivity;
}

/** A lightweight ref to a PR active in-window, used to fetch its reviews. */
export interface ActivePR {
  number: number;
  title: string;
  authorLogin: string | null;
}

function classifyPrState(pr: {
  state: string;
  draft?: boolean | null;
  merged_at?: string | null;
}): PullRequestState {
  if (pr.merged_at) return 'merged';
  if (pr.state === 'closed') return 'closed';
  if (pr.draft) return 'draft';
  return 'open';
}

/**
 * Fetch PRs with any activity in the window (updated_at >= since), plus the set
 * of active PRs so the caller can fetch their reviews. Only PRs *created*,
 * *merged*, or *closed* in-window become PullRequest activity records; PRs that
 * were merely reviewed in-window still appear in `active` for review fetching.
 */
export async function fetchPullRequests(
  octokit: Octokit,
  org: string,
  repo: string,
  window: Window,
): Promise<{ records: PullRequestRecord[]; active: ActivePR[] }> {
  const records: PullRequestRecord[] = [];
  const active: ActivePR[] = [];

  // Sorted by updated desc so we can stop once we pass the window's start.
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner: org,
    repo,
    state: 'all',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });

  outer: for await (const { data: page } of iterator) {
    for (const pr of page) {
      if (pr.updated_at < window.since) break outer; // everything older follows
      active.push({ number: pr.number, title: pr.title, authorLogin: pr.user?.login ?? null });

      const touchedInWindow =
        inWindow(pr.created_at, window) ||
        inWindow(pr.merged_at, window) ||
        inWindow(pr.closed_at, window);
      if (!touchedInWindow) continue;

      let additions = 0;
      let deletions = 0;
      try {
        const full = await octokit.rest.pulls.get({ owner: org, repo, pull_number: pr.number });
        additions = full.data.additions;
        deletions = full.data.deletions;
      } catch {
        // best-effort
      }
      records.push({
        author: {
          login: pr.user?.login ?? null,
          avatarUrl: pr.user?.avatar_url ?? null,
        },
        pr: {
          repo,
          number: pr.number,
          title: pr.title,
          state: classifyPrState(pr),
          additions,
          deletions,
          url: pr.html_url,
          createdAt: pr.created_at,
          mergedAt: pr.merged_at ?? undefined,
          closedAt: pr.closed_at ?? undefined,
        },
      });
    }
  }
  return { records, active };
}

export interface ReviewRecord {
  author: RawIdentity;
  review: ReviewActivity;
}

function normalizeReviewState(state: string | undefined): ReviewState | null {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes_requested';
    case 'COMMENTED':
      return 'commented';
    case 'DISMISSED':
      return 'dismissed';
    default:
      return null; // PENDING and unknown states are ignored
  }
}

/** Fetch reviews submitted in-window across the given active PRs. */
export async function fetchReviews(
  octokit: Octokit,
  org: string,
  repo: string,
  window: Window,
  prs: ActivePR[],
): Promise<ReviewRecord[]> {
  const perPr = await mapLimit(prs, 5, async (pr) => {
    let reviews;
    try {
      reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner: org,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });
    } catch {
      return [] as ReviewRecord[];
    }
    const out: ReviewRecord[] = [];
    for (const rev of reviews) {
      const state = normalizeReviewState(rev.state);
      if (!state || !inWindow(rev.submitted_at, window)) continue;
      // Don't count self-reviews.
      if (rev.user?.login && pr.authorLogin && rev.user.login === pr.authorLogin) continue;
      out.push({
        author: { login: rev.user?.login ?? null, avatarUrl: rev.user?.avatar_url ?? null },
        review: {
          repo,
          pullRequestNumber: pr.number,
          pullRequestTitle: pr.title,
          state,
          pullRequestAuthor: pr.authorLogin ?? 'unknown',
          url: rev.html_url,
          submittedAt: rev.submitted_at!,
        },
      });
    }
    return out;
  });
  return perPr.flat();
}

export interface IssueRecord {
  author: RawIdentity;
  issue: IssueActivity;
}

/** Fetch issues (not PRs) opened or closed in-window. */
export async function fetchIssues(
  octokit: Octokit,
  org: string,
  repo: string,
  window: Window,
): Promise<IssueRecord[]> {
  const list = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: org,
    repo,
    state: 'all',
    since: window.since,
    per_page: 100,
  });

  const out: IssueRecord[] = [];
  for (const issue of list) {
    if (issue.pull_request) continue; // listForRepo includes PRs; skip them
    const openedInWindow = inWindow(issue.created_at, window);
    const closedInWindow = inWindow(issue.closed_at, window);
    if (!openedInWindow && !closedInWindow) continue;

    // An issue opened AND closed in-window is both events — emit one record per
    // action so the opened/closed counts stay accurate (don't drop the close).
    const author = { login: issue.user?.login ?? null, avatarUrl: issue.user?.avatar_url ?? null };
    const base = {
      repo,
      number: issue.number,
      title: issue.title,
      state: (issue.state === 'closed' ? 'closed' : 'open') as IssueActivity['state'],
      url: issue.html_url,
      milestoneNumber: issue.milestone?.number, // for roadmap reconciliation (Phase 5)
    };
    if (openedInWindow) {
      out.push({ author, issue: { ...base, action: 'opened', at: issue.created_at } });
    }
    if (closedInWindow) {
      out.push({ author, issue: { ...base, action: 'closed', at: issue.closed_at ?? issue.updated_at } });
    }
  }
  return out;
}

export interface MilestoneRecord {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  /** Due date if set (ISO-8601). */
  dueOn?: string;
  openIssues: number;
  closedIssues: number;
}

/**
 * Fetch a repo's milestones (open + closed) for roadmap reconciliation (Phase 5).
 * The milestone object carries open/closed issue counts and the due date, so
 * progress and "on track vs due" come for free — no per-issue fetch needed.
 */
export async function fetchMilestones(
  octokit: Octokit,
  org: string,
  repo: string,
): Promise<MilestoneRecord[]> {
  const list = await octokit.paginate(octokit.rest.issues.listMilestones, {
    owner: org,
    repo,
    state: 'all',
    per_page: 100,
  });
  return list.map((m) => ({
    repo,
    number: m.number,
    title: m.title,
    url: m.html_url,
    state: m.state === 'closed' ? 'closed' : 'open',
    dueOn: m.due_on ?? undefined,
    openIssues: m.open_issues,
    closedIssues: m.closed_issues,
  }));
}
