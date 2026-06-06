/**
 * collect() — the core of Phase 1. Reads org activity for the window across all
 * configured repos, attributes every event to a canonical person via the
 * identity resolver, and normalizes it into the OrgActivity model that
 * summarize() consumes. Pure orchestration over the github + identity layers.
 */
import type { Config, Secrets } from './config.js';
import { createNoiseMatcher } from './filter.js';
import { IdentityResolver } from './identity.js';
import type { Octokit } from '@octokit/rest';
import {
  computeWindow,
  fetchCommits,
  fetchIssues,
  fetchMilestones,
  fetchPullRequests,
  fetchRepoFile,
  fetchReviews,
  filterStaleRepos,
  listOrgRepos,
  type MilestoneRecord,
} from './github.js';
import { resolveOctokit } from './github-auth.js';
import { parseRoadmapMarkdown, type DeclaredGoal } from './roadmap-md.js';
import type {
  CommitActivity,
  IssueActivity,
  OrgActivity,
  PersonActivity,
  PullRequestActivity,
  ReviewActivity,
} from './types.js';

/**
 * The repos to scan: an explicit `config.repos` list, or all non-archived org
 * repos with stale ones skipped per `config.staleDays` (logged). Shared by
 * collect() and collectRoadmap().
 */
async function resolveRepos(
  octokit: Octokit,
  config: Config,
  now: Date,
  windowSince: string,
  log: (msg: string) => void,
): Promise<string[]> {
  if (config.repos.length) return config.repos;
  const all = await listOrgRepos(octokit, config.org);
  const { kept, skipped } = filterStaleRepos(all, { staleDays: config.staleDays, now, windowSince });
  if (skipped.length) {
    const reason = config.staleDays === 'auto' ? 'no push in the window' : `no push in >${config.staleDays}d`;
    log(
      `inky: skipping ${skipped.length} stale repo(s) — ${reason}: ` +
        skipped.map((r) => r.name).join(', '),
    );
  }
  return kept;
}

/** Mutable per-person accumulator, keyed by canonical login. */
interface Bucket {
  commits: CommitActivity[];
  pullRequests: PullRequestActivity[];
  reviews: ReviewActivity[];
  issues: IssueActivity[];
}

function emptyBucket(): Bucket {
  return { commits: [], pullRequests: [], reviews: [], issues: [] };
}

export interface CollectOptions {
  /** Injectable clock for deterministic windows/tests. Defaults to now. */
  now?: Date;
  /** Progress sink (defaults to stderr). */
  log?: (msg: string) => void;
  /**
   * Override the window length (hours) from config. Lets a caller — e.g. a
   * future `/standup last 3 days` slash command — request an arbitrary window
   * without editing config.
   */
  windowHours?: number;
}

export async function collect(
  config: Config,
  secrets: Secrets,
  opts: CollectOptions = {},
): Promise<OrgActivity> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));

  const octokit = await resolveOctokit(config, secrets, log);
  const windowHours = opts.windowHours ?? config.windowHours;
  const window = computeWindow(windowHours, now);
  const resolver = new IdentityResolver(config.aliases);
  const isNoise = createNoiseMatcher(config.extraNoisePatterns);
  const buckets = new Map<string, Bucket>();

  const bucketFor = (key: string): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = emptyBucket();
      buckets.set(key, b);
    }
    return b;
  };

  const repos = await resolveRepos(octokit, config, now, window.since, log);
  log(`inky: collecting ${config.org} over ${windowHours}h across ${repos.length} repo(s)`);

  for (const repo of repos) {
    try {
      const commits = await fetchCommits(octokit, config.org, repo, window, isNoise);
      for (const { author, commit } of commits) {
        bucketFor(resolver.resolve(author)).commits.push(commit);
      }

      const { records: prs, active } = await fetchPullRequests(octokit, config.org, repo, window);
      for (const { author, pr } of prs) {
        bucketFor(resolver.resolve(author)).pullRequests.push(pr);
      }

      const reviews = await fetchReviews(octokit, config.org, repo, window, active);
      for (const { author, review } of reviews) {
        bucketFor(resolver.resolve(author)).reviews.push(review);
      }

      const issues = await fetchIssues(octokit, config.org, repo, window);
      for (const { author, issue } of issues) {
        bucketFor(resolver.resolve(author)).issues.push(issue);
      }

      log(`  ${repo}: ${commits.length} commits, ${prs.length} PRs, ${reviews.length} reviews, ${issues.length} issues`);
    } catch (err) {
      // One bad repo (permissions, empty, etc.) shouldn't sink the whole run.
      log(`  ${repo}: WARN ${(err as Error).message}`);
    }
  }

  const people = [...buckets.entries()]
    .map(([key, b]) => toPersonActivity(resolver, key, b, window))
    .filter((p): p is PersonActivity => p !== null)
    .filter((p) => includePerson(p.person.login, config))
    .sort(activityRank);

  return { org: config.org, window, people };
}

/**
 * Fetch the roadmap (GitHub milestones across the configured repos) for Phase 5
 * reconciliation. Separate from collect() so the standup path doesn't pay for it
 * unless roadmap is enabled. One bad repo warns and is skipped, never aborts.
 */
export async function collectRoadmap(
  config: Config,
  secrets: Secrets,
  opts: { log?: (msg: string) => void; now?: Date; windowSince?: string } = {},
): Promise<MilestoneRecord[]> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
  const octokit = await resolveOctokit(config, secrets, log);
  const now = opts.now ?? new Date();
  const windowSince = opts.windowSince ?? computeWindow(config.windowHours, now).since;
  const repos = await resolveRepos(octokit, config, now, windowSince, log);
  const all: MilestoneRecord[] = [];
  for (const repo of repos) {
    try {
      all.push(...(await fetchMilestones(octokit, config.org, repo)));
    } catch (err) {
      log(`  ${repo}: WARN milestones ${(err as Error).message}`);
    }
  }
  return all;
}

/**
 * Fetch + parse a declared roadmap (ROADMAP.md) for the `roadmap-md` source.
 * Reads `config.roadmap.path` from `config.roadmap.repo` (or the first configured
 * repo). Non-fatal: a missing repo/file logs and returns no goals.
 */
export async function collectDeclaredRoadmap(
  config: Config,
  secrets: Secrets,
  opts: { log?: (msg: string) => void } = {},
): Promise<{ goals: DeclaredGoal[]; sourceUrl: string }> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
  const repo = config.roadmap.repo ?? config.repos[0];
  if (!repo) {
    log('inky: roadmap source "roadmap-md" needs a repo — set roadmap.repo (or list repos[]); skipping.');
    return { goals: [], sourceUrl: '' };
  }
  const octokit = await resolveOctokit(config, secrets, log);
  const file = await fetchRepoFile(octokit, config.org, repo, config.roadmap.path);
  if (!file) {
    log(`inky: no ${config.roadmap.path} in ${config.org}/${repo}; skipping status vs plan.`);
    return { goals: [], sourceUrl: '' };
  }
  const goals = parseRoadmapMarkdown(file.content);
  log(`inky: parsed ${goals.length} goal(s) from ${repo}/${config.roadmap.path}`);
  return { goals, sourceUrl: file.url };
}

/** GitHub bot accounts have logins suffixed with `[bot]` (e.g. `dependabot[bot]`). */
function isBot(login: string): boolean {
  return login.endsWith('[bot]');
}

/**
 * Whether a resolved person appears in the standup: not a `[bot]` (when
 * excludeBots), and not on the per-person opt-out list (case-insensitive,
 * matched on canonical login). Pure, so it's unit-tested without the API.
 */
export function includePerson(login: string, config: Config): boolean {
  if (config.excludeBots && isBot(login)) return false;
  const target = login.toLowerCase();
  return !config.excludePeople.some((name) => name.toLowerCase() === target);
}

function toPersonActivity(
  resolver: IdentityResolver,
  key: string,
  b: Bucket,
  window: OrgActivity['window'],
): PersonActivity | null {
  const person = resolver.get(key);
  if (!person) return null;

  const repos = new Set<string>();
  for (const c of b.commits) repos.add(c.repo);
  for (const p of b.pullRequests) repos.add(p.repo);
  for (const r of b.reviews) repos.add(r.repo);
  for (const i of b.issues) repos.add(i.repo);

  const openedInWindow = (iso: string) => iso >= window.since && iso <= window.until;
  const totals: PersonActivity['totals'] = {
    commits: b.commits.length,
    unshippedCommits: b.commits.filter((c) => c.unshipped).length,
    additions: b.commits.reduce((s, c) => s + c.additions, 0),
    deletions: b.commits.reduce((s, c) => s + c.deletions, 0),
    prsOpened: b.pullRequests.filter((p) => openedInWindow(p.createdAt)).length,
    prsMerged: b.pullRequests.filter((p) => p.state === 'merged').length,
    reviewsGiven: b.reviews.length,
    issuesOpened: b.issues.filter((i) => i.action === 'opened').length,
    issuesClosed: b.issues.filter((i) => i.action === 'closed').length,
    repos: repos.size,
  };

  return {
    person,
    commits: b.commits,
    pullRequests: b.pullRequests,
    reviews: b.reviews,
    issues: b.issues,
    totals,
  };
}

/** Sort the most active people first. Commits dominate, then PRs, then reviews. */
function activityRank(a: PersonActivity, b: PersonActivity): number {
  const score = (p: PersonActivity) =>
    p.totals.commits * 3 + p.totals.prsOpened * 2 + p.totals.reviewsGiven + p.totals.issuesOpened;
  return score(b) - score(a);
}
