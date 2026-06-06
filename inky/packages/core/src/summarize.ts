/**
 * summarize() — turn normalized OrgActivity into an AI-written Standup.
 *
 * This is "the actual product" (plan §6, Phase 3): a clean per-person narrative
 * plus a project-wide summary, written by Claude. The hard rule is *grounding* —
 * the model summarizes, it does not invent. We feed it a factual digest built
 * straight from the activity (the same facts renderMechanical shows) and force a
 * structured tool call back, so every narrative maps to a real login and we never
 * have to parse free-form prose.
 *
 * The network call is injected as a narrow `MessagesCreate` function (mirrors the
 * SDK's messages.create) so this module is unit-testable with a fake client,
 * exactly like the Discord delivery layer. The real adapter lives in anthropic.ts.
 */
import { z } from 'zod';
import { isPromotionPR, windowLabel } from './render.js';
import type {
  CommitActivity,
  OrgActivity,
  OrgTotals,
  PersonActivity,
  PersonStandup,
  PrSizeBuckets,
  RoadmapStatus,
  Standup,
  TeamStats,
  Window,
} from './types.js';

// ── Narrow LLM-call interface (mocked in tests, wrapped over the SDK in prod) ──

/** A `system` content block; cache_control marks the cacheable (stable) prefix. */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CreateMessageParams {
  model: string;
  max_tokens: number;
  system: SystemBlock[];
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: Tool[];
  tool_choice: { type: 'tool'; name: string };
}

export interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: unknown;
}
export interface TextBlock {
  type: 'text';
  text: string;
}
export type ContentBlock = ToolUseBlock | TextBlock | { type: string; [k: string]: unknown };

export interface MessageResponse {
  content: ContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Mirrors `anthropic.messages.create`. The real one is a one-line wrapper. */
export type MessagesCreate = (params: CreateMessageParams) => Promise<MessageResponse>;

// ── Prompt + structured-output contract ──────────────────────────────────────

const TOOL_NAME = 'emit_standup';

/** Tone + grounding rules. Stable across runs, so it's the cached system prefix. */
const SYSTEM_PROMPT = `You write a team's daily engineering standup from GitHub activity.

You are given a factual digest of what each person did (commits, pull requests,
reviews, issues) in a time window. Your job is to turn it into a concise, readable
standup — NOT to evaluate, praise, or speculate.

Hard rules:
- GROUND EVERYTHING in the digest. Never invent work, intent, or outcomes that
  aren't stated. If the digest is thin, the narrative is short. Do not pad.
- Summarize across commits — describe themes of work, not a list of every commit.
- Reference concrete artifacts where natural: PR numbers as "#123", repo names,
  and call out work-in-progress (unshipped) effort explicitly.
- Match the DEPTH TARGET given in the user message: short windows get a terse
  update, longer windows get a proportionally more thorough one (more sentences,
  more highlights). Never pad to hit a length — depth comes from real activity.
- Per person: present tense ("Shipped…", "Working on…"). No filler, no adjectives
  like "great"/"solid", no manager-speak.
- The project summary: the through-line — what the team collectively moved, what
  shipped vs. what's in flight. No per-person repetition.
- For any team-wide or aggregate count (total PRs merged, commits, contributors,
  repos), use ONLY the "Org totals" figures given in the digest, verbatim. Never
  sum or estimate across people yourself — if a number isn't in Org totals, don't
  state it.
- If (and ONLY if) the digest includes a "Roadmap status" block, also fill
  "statusVsPlan": a short, grounded read of where the project stands vs the plan —
  which milestones advanced, what's stalled or at risk — using ONLY the listed
  items and their verified figures. Never invent milestone names, progress, or due
  dates. With no Roadmap status block, omit statusVsPlan entirely.
- Write for engineers reading their own team's update. Plain, direct, specific.

Return your answer ONLY by calling the ${TOOL_NAME} tool.`;

const EMIT_TOOL: Tool = {
  name: TOOL_NAME,
  description: 'Emit the finished standup: a project-wide summary and one entry per active person.',
  input_schema: {
    type: 'object',
    properties: {
      projectSummary: {
        type: 'string',
        description: 'Project-wide summary, grounded in the digest. Length per the depth target.',
      },
      people: {
        type: 'array',
        description: 'One entry per active person from the digest.',
        items: {
          type: 'object',
          properties: {
            login: { type: 'string', description: 'The GitHub login exactly as in the digest.' },
            narrative: { type: 'string', description: 'Narrative for this person; length per the depth target.' },
            work: {
              type: 'array',
              description:
                "This person's bullets GROUPED BY REPOSITORY — one entry per repo they " +
                'worked in (most people touch one repo → one entry).',
              items: {
                type: 'object',
                properties: {
                  repo: { type: 'string', description: 'Repository name, exactly as in the digest.' },
                  points: {
                    type: 'array',
                    description:
                      "Bullet lines for THIS repo (shipped first, then work-in-progress), each " +
                      'with refs (#PR). Do not repeat the repo name inside a point.',
                    items: { type: 'string' },
                  },
                },
                required: ['repo', 'points'],
              },
            },
          },
          required: ['login', 'narrative', 'work'],
        },
      },
      statusVsPlan: {
        type: 'string',
        description:
          'OPTIONAL. Only when the digest has a "Roadmap status" block: 1–3 sentences on ' +
          'where the project stands vs the plan (advanced / stalled / at risk), grounded ' +
          'strictly in the listed roadmap items and figures. Omit if no roadmap figures are given.',
      },
    },
    required: ['projectSummary', 'people'],
  },
};

/** Validates the model's tool input before we trust it. */
const StandupOutputSchema = z.object({
  projectSummary: z.string(),
  people: z
    .array(
      z.object({
        login: z.string(),
        narrative: z.string(),
        work: z
          .array(z.object({ repo: z.string(), points: z.array(z.string()).default([]) }))
          .default([]),
      }),
    )
    .default([]),
  statusVsPlan: z.string().optional(),
});

// ── Grounding digest ─────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * How thorough the write-up should be, scaled to the window length. A daily
 * standup is a terse pulse; a weekly or monthly review earns proportionally more
 * depth — more sentences per person, more highlights, and more raw activity in
 * the digest for the model to draw on. Depth still comes from real work: these
 * are ceilings, not quotas.
 */
export interface DetailLevel {
  tier: 'daily' | 'multi-day' | 'weekly' | 'monthly' | 'long-range';
  /** Target sentences per person, e.g. "1–2". */
  perPersonSentences: string;
  /** Target sentences for the project summary. */
  projectSentences: string;
  /** Max highlight bullets per person. */
  maxHighlights: number;
  /** How many commits/PRs per person to include in the digest. */
  commitCap: number;
  prCap: number;
  /** Output-token budget — longer reports need more room so they aren't truncated. */
  outputTokens: number;
}

/** Pick a detail level from the window length (roughly: longer window → longer report). */
export function detailForWindow(window: Window): DetailLevel {
  const hours = Math.round(
    (new Date(window.until).getTime() - new Date(window.since).getTime()) / 3_600_000,
  );
  const days = hours / 24;
  if (hours <= 26) {
    return { tier: 'daily', perPersonSentences: '1–2', projectSentences: '1–2', maxHighlights: 3, commitCap: 8, prCap: 6, outputTokens: 1024 };
  }
  if (days <= 4) {
    return { tier: 'multi-day', perPersonSentences: '2–3', projectSentences: '2', maxHighlights: 4, commitCap: 12, prCap: 8, outputTokens: 1536 };
  }
  if (days <= 10) {
    return { tier: 'weekly', perPersonSentences: '2–4', projectSentences: '2–3', maxHighlights: 6, commitCap: 18, prCap: 12, outputTokens: 2560 };
  }
  if (days <= 40) {
    return { tier: 'monthly', perPersonSentences: '3–5', projectSentences: '3–4', maxHighlights: 8, commitCap: 30, prCap: 20, outputTokens: 3584 };
  }
  return { tier: 'long-range', perPersonSentences: '4–6', projectSentences: '4–5', maxHighlights: 10, commitCap: 45, prCap: 30, outputTokens: 4096 };
}

/** Deduplicate commits by message+repo (rebases/cherry-picks repeat), drop merges. */
function meaningfulCommits(commits: CommitActivity[]): CommitActivity[] {
  const seen = new Set<string>();
  const out: CommitActivity[] = [];
  for (const c of commits) {
    if (/^merge\b/i.test(c.message)) continue;
    const key = `${c.repo}:${c.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function personStatLine(p: PersonActivity): string {
  const t = p.totals;
  const parts: string[] = [];
  if (t.commits) parts.push(`${t.commits} commits (${t.unshippedCommits} unshipped)`);
  if (t.additions || t.deletions) parts.push(`+${fmtNum(t.additions)}/−${fmtNum(t.deletions)} LOC`);
  if (t.prsOpened) parts.push(`${t.prsOpened} PRs opened`);
  if (t.prsMerged) parts.push(`${t.prsMerged} PRs merged`);
  if (t.reviewsGiven) parts.push(`${t.reviewsGiven} reviews`);
  if (t.issuesOpened) parts.push(`${t.issuesOpened} issues opened`);
  if (t.issuesClosed) parts.push(`${t.issuesClosed} issues closed`);
  if (t.repos > 1) parts.push(`${t.repos} repos`);
  return parts.join(', ');
}

/**
 * Org-wide rollups, computed mechanically so the model never has to count. The
 * project summary is the one place tempted to state aggregate numbers ("9 PRs
 * merged"), and a model summing across people drifts — so we hand it verified
 * totals and forbid it from doing its own arithmetic.
 */
export function computeOrgTotals(activity: OrgActivity): OrgTotals {
  const repos = new Set<string>();
  let commits = 0,
    unshippedCommits = 0,
    prsOpened = 0,
    prsMerged = 0,
    reviews = 0,
    issuesOpened = 0,
    issuesClosed = 0,
    additions = 0,
    deletions = 0;
  for (const p of activity.people) {
    const t = p.totals;
    commits += t.commits;
    unshippedCommits += t.unshippedCommits;
    prsOpened += t.prsOpened;
    prsMerged += t.prsMerged;
    reviews += t.reviewsGiven;
    issuesOpened += t.issuesOpened;
    issuesClosed += t.issuesClosed;
    additions += t.additions;
    deletions += t.deletions;
    for (const c of p.commits) repos.add(c.repo);
    for (const pr of p.pullRequests) repos.add(pr.repo);
    for (const r of p.reviews) repos.add(r.repo);
    for (const i of p.issues) repos.add(i.repo);
  }
  return {
    contributors: activity.people.length,
    commits,
    unshippedCommits,
    prsOpened,
    prsMerged,
    reviews,
    issuesOpened,
    issuesClosed,
    repos: repos.size,
    additions,
    deletions,
  };
}

/** A commit that undoes earlier work — `git revert` output or a "revert" message. */
export function isRevertCommit(message: string): boolean {
  return /^revert\b/i.test(message.trim()) || /this reverts commit/i.test(message);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Bucket a PR by total lines changed (additions + deletions). */
export function classifyPrSize(lines: number): keyof PrSizeBuckets {
  if (lines < 10) return 'xs';
  if (lines < 100) return 's';
  if (lines < 500) return 'm';
  if (lines < 1000) return 'l';
  return 'xl';
}

/**
 * OrgTotals plus two derived signals for the stats panel: revert rate (stability)
 * and median merged-PR cycle time (throughput). Both from data Inky already has
 * — no extra fetching — per the agentic-era metrics research.
 */
export function computeTeamStats(activity: OrgActivity): TeamStats {
  const totals = computeOrgTotals(activity);
  const since = activity.window.since;

  // Earliest non-self review per PR (repo#number). fetchReviews already drops
  // self-reviews and keeps in-window reviews; for a PR opened in-window that
  // earliest review IS its first review (no earlier one can exist).
  const firstReviewAt = new Map<string, string>();
  for (const p of activity.people) {
    for (const r of p.reviews) {
      const key = `${r.repo}#${r.pullRequestNumber}`;
      const prev = firstReviewAt.get(key);
      if (!prev || r.submittedAt < prev) firstReviewAt.set(key, r.submittedAt);
    }
  }

  // Commits per 24h slice across the window (oldest first), for the activity
  // sparkline. Slice from `since` (not calendar days) so it's timezone-agnostic
  // and matches the windowHours semantics.
  const sinceMs = Date.parse(activity.window.since);
  const dayMs = 86_400_000;
  const dayCount = Math.max(1, Math.round((Date.parse(activity.window.until) - sinceMs) / dayMs));
  const dailyCommits = new Array<number>(dayCount).fill(0);

  let reverts = 0;
  const cycleHours: number[] = [];
  const ttfrHours: number[] = [];
  const prSizes: PrSizeBuckets = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
  for (const p of activity.people) {
    for (const c of p.commits) {
      if (isRevertCommit(c.message)) reverts++;
      const slice = Math.floor((Date.parse(c.authoredAt) - sinceMs) / dayMs);
      // Clamp the high end so a commit at exactly `until` (the exclusive window
      // end) lands in the last day's bucket rather than being dropped — keeps the
      // sparkline's total consistent with the commit count.
      if (slice >= 0) {
        const bucket = Math.min(slice, dayCount - 1);
        dailyCommits[bucket] = (dailyCommits[bucket] ?? 0) + 1;
      }
    }
    for (const pr of p.pullRequests) {
      if (isPromotionPR(pr.title)) continue; // promotion/auto-merge PRs aren't real review/flow
      // Exclude promotion/auto-merge PRs (e.g. "Staging") — they merge instantly
      // and would drag the cycle-time median to ~0, hiding real feature lead time.
      if (pr.state === 'merged' && pr.mergedAt) {
        const h = (new Date(pr.mergedAt).getTime() - new Date(pr.createdAt).getTime()) / 3_600_000;
        if (h >= 0) cycleHours.push(h);
        prSizes[classifyPrSize(pr.additions + pr.deletions)]++;
      }
      // Time-to-first-review: only PRs opened in-window (so the first captured
      // review is genuinely the first), that actually received a review.
      if (pr.createdAt >= since) {
        const fr = firstReviewAt.get(`${pr.repo}#${pr.number}`);
        if (fr) {
          const h = (new Date(fr).getTime() - new Date(pr.createdAt).getTime()) / 3_600_000;
          if (h >= 0) ttfrHours.push(h);
        }
      }
    }
  }

  return {
    ...totals,
    reverts,
    revertRate: totals.commits ? reverts / totals.commits : 0,
    medianPrCycleHours: median(cycleHours),
    medianTimeToFirstReviewHours: median(ttfrHours),
    prSizes,
    dailyCommits,
  };
}

/** Verified roadmap lines for the digest — the model narrates only from these. */
function roadmapDigestLines(roadmap: RoadmapStatus): string[] {
  const lines = ['Roadmap status (verified figures — do not recompute; narrate only from these):'];
  for (const it of roadmap.items) {
    const m = it.item;
    const pct = Math.round(it.progress * 100);
    const bits = [`${m.closedCount}/${m.openCount + m.closedCount} closed (${pct}%)`, it.movement];
    if (it.closedThisWindow) bits.push(`+${it.closedThisWindow} closed this window`);
    if (it.atRisk) bits.push(`AT RISK${it.note ? ` — ${it.note}` : ''}`);
    lines.push(`- ${m.title}${m.repo ? ` (${m.repo})` : ''}: ${bits.join(', ')}`);
  }
  if (roadmap.unplanned.closedIssues) {
    lines.push(`- ${roadmap.unplanned.closedIssues} issue(s) closed outside any tracked roadmap item`);
  }
  const tt = roadmap.totals;
  lines.push(
    `Roadmap rollup: ${tt.tracked} tracked, ${tt.completed} completed, ${tt.advanced} advanced, ` +
      `${tt.stalled} stalled, ${tt.atRisk} at-risk`,
  );
  lines.push('');
  return lines;
}

/**
 * Build the factual per-person digest the model summarizes. This — not raw API
 * data — is the model's entire source of truth, so it must be complete and clean.
 * When a roadmap is passed, its verified figures are included for the status block.
 */
export function buildGroundingDigest(
  activity: OrgActivity,
  detail: DetailLevel = detailForWindow(activity.window),
  roadmap?: RoadmapStatus,
): string {
  const { org, window, people } = activity;
  const t = computeOrgTotals(activity);
  const lines: string[] = [];
  lines.push(`Organization: ${org}`);
  lines.push(`Window: ${window.since} → ${window.until} (${windowLabel(window)})`);
  lines.push('');
  lines.push('Org totals (verified — use these exact figures for any team-wide count):');
  lines.push(`- Contributors active: ${t.contributors}`);
  lines.push(`- Commits: ${t.commits} (${t.unshippedCommits} unshipped)`);
  lines.push(`- PRs: ${t.prsMerged} merged, ${t.prsOpened} opened`);
  if (t.reviews) lines.push(`- Reviews: ${t.reviews}`);
  if (t.issuesOpened || t.issuesClosed) {
    lines.push(`- Issues: ${t.issuesOpened} opened, ${t.issuesClosed} closed`);
  }
  lines.push(`- Repos touched: ${t.repos}`);
  lines.push(`- Net lines: +${fmtNum(t.additions)}/−${fmtNum(t.deletions)}`);
  lines.push('');

  if (roadmap && roadmap.items.length) lines.push(...roadmapDigestLines(roadmap));

  for (const p of people) {
    const name =
      p.person.displayName && p.person.displayName !== p.person.login
        ? `${p.person.displayName} (login: ${p.person.login})`
        : `login: ${p.person.login}`;
    lines.push(`### ${name}`);
    const stat = personStatLine(p);
    if (stat) lines.push(`Totals: ${stat}`);

    const mergedFeature = p.pullRequests.filter((pr) => pr.state === 'merged');
    if (mergedFeature.length) {
      lines.push('Merged PRs:');
      for (const pr of mergedFeature.slice(0, detail.prCap)) {
        lines.push(`- #${pr.number} ${pr.title} (${pr.repo})`);
      }
    }
    const openPrs = p.pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft');
    if (openPrs.length) {
      lines.push('Open PRs:');
      for (const pr of openPrs.slice(0, detail.prCap)) {
        lines.push(`- #${pr.number} ${pr.title} (${pr.repo})${pr.state === 'draft' ? ' [draft]' : ''}`);
      }
    }

    const commits = meaningfulCommits(p.commits);
    const unshipped = commits.filter((c) => c.unshipped);
    const shipped = commits.filter((c) => !c.unshipped);
    if (unshipped.length) {
      lines.push('Work in progress (unshipped commits on feature branches):');
      for (const c of unshipped.slice(0, detail.commitCap)) {
        lines.push(`- ${c.message} (${c.repo}${c.branch ? `@${c.branch}` : ''})`);
      }
    }
    if (shipped.length) {
      lines.push('Shipped commits (on default branch):');
      for (const c of shipped.slice(0, detail.commitCap)) {
        lines.push(`- ${c.message} (${c.repo})`);
      }
    }

    if (p.reviews.length) {
      const reviewed = p.reviews
        .slice(0, 8)
        .map((r) => `#${r.pullRequestNumber} "${r.pullRequestTitle}" (${r.repo})`);
      lines.push(`Reviewed ${p.reviews.length} PRs: ${reviewed.join('; ')}`);
    }

    const issues = p.issues.filter((i) => i.action === 'opened' || i.action === 'closed');
    if (issues.length) {
      lines.push('Issues:');
      for (const i of issues.slice(0, 8)) {
        lines.push(`- ${i.action} #${i.number} ${i.title} (${i.repo})`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ── summarize() ──────────────────────────────────────────────────────────────

export interface SummarizeOptions {
  /** Injected LLM call. The real one wraps anthropic.messages.create. */
  create: MessagesCreate;
  /** Model id (defaults to config). */
  model?: string;
  /** Max output tokens (default 2048; per-person narratives are short). */
  maxTokens?: number;
  /**
   * Per-person output style: 'prose' (default) = a short narrative paragraph;
   * 'bullets' = a list of concise bullet points (no paragraph). The project
   * summary stays prose either way.
   */
  format?: 'prose' | 'bullets';
  /** Reconciled roadmap (Phase 5). When set, the digest carries its verified
   *  figures and the model writes a grounded `statusVsPlan`; it's also attached
   *  to the returned Standup for the render-side status panel. */
  roadmap?: RoadmapStatus;
  log?: (msg: string) => void;
}

/** Extract the first tool_use block named emit_standup. */
function extractToolInput(res: MessageResponse): unknown {
  for (const block of res.content) {
    if (block.type === 'tool_use' && (block as ToolUseBlock).name === TOOL_NAME) {
      return (block as ToolUseBlock).input;
    }
  }
  throw new Error(`summarize: model did not call ${TOOL_NAME} (no tool_use block in response)`);
}

/** A plain factual fallback if the model omits a person the digest included. */
function fallbackNarrative(p: PersonActivity): string {
  const stat = personStatLine(p);
  return stat ? `Activity: ${stat}.` : 'No notable activity in this window.';
}

/**
 * Turn normalized activity into an AI-written Standup. One model call covers the
 * whole org (cheaper, and gives the project summary cross-person context). Every
 * person in the digest gets a section — a model omission falls back to facts.
 */
export async function summarize(activity: OrgActivity, opts: SummarizeOptions): Promise<Standup> {
  const { org, window, people } = activity;
  const log = opts.log ?? (() => {});

  // No activity → no need to spend a token; the empty standup is fully factual.
  // The roadmap panel still attaches (stalled/at-risk items matter on a quiet day).
  if (people.length === 0) {
    return {
      org,
      window,
      projectSummary: 'No GitHub activity in this window.',
      people: [],
      roadmap: opts.roadmap,
    };
  }

  const detail = detailForWindow(window);
  const digest = buildGroundingDigest(activity, detail, opts.roadmap);
  const format = opts.format ?? 'prose';
  const groupRule =
    `Always GROUP each person's bullets by repository in "work": one entry per repo they ` +
    `touched, points = that repo's bullets (shipped first, then WIP), no repo name repeated ` +
    `inside a point. Up to ${detail.maxHighlights + 3} points per repo.`;
  const styleTarget =
    format === 'bullets'
      ? `STYLE — bullets: ${groupRule} Leave "narrative" empty or a single short lead clause ` +
        `— do NOT write a prose paragraph.`
      : `STYLE — prose: write each person's "narrative" as roughly ` +
        `${detail.perPersonSentences} sentences. ${groupRule}`;
  const depthTarget =
    `DEPTH TARGET — this is a ${detail.tier} window (${windowLabel(window)}). Scale the ` +
    `write-up to match; longer windows mean a more thorough report — but only from real ` +
    `activity, never padding. The project summary is ${detail.projectSentences} sentences ` +
    `of prose regardless of style.\n${styleTarget}`;
  const roadmapTarget =
    opts.roadmap && opts.roadmap.items.length
      ? `\n\nROADMAP — the digest includes a verified "Roadmap status" block. Also write ` +
        `"statusVsPlan": 1–3 sentences on where the project stands vs the plan (advanced / ` +
        `stalled / at risk), grounded only in those figures.`
      : '';
  const res = await opts.create({
    model: opts.model ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? detail.outputTokens,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `${depthTarget}${roadmapTarget}\n\nHere is the factual activity digest. Write the standup.\n\n${digest}`,
      },
    ],
    tools: [EMIT_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
  });

  if (res.usage) {
    const { input_tokens, output_tokens, cache_read_input_tokens } = res.usage;
    log(
      `summarize: ${input_tokens ?? '?'} in / ${output_tokens ?? '?'} out tokens` +
        (cache_read_input_tokens ? ` (${cache_read_input_tokens} cached)` : ''),
    );
  }

  const parsed = StandupOutputSchema.parse(extractToolInput(res));
  const byLogin = new Map(parsed.people.map((e) => [e.login.toLowerCase(), e]));

  const peopleStandups: PersonStandup[] = people.map((p) => {
    const entry = byLogin.get(p.person.login.toLowerCase());
    return {
      person: p.person,
      narrative: entry?.narrative?.trim() || fallbackNarrative(p),
      work: entry?.work ?? [],
      totals: p.totals,
    };
  });

  // Carry verified rollups so render() can show an optional stats panel without
  // recomputing or letting the model near the numbers. The roadmap (mechanical)
  // and its grounded narrative ride along the same way (Phase 5).
  const statusVsPlan = opts.roadmap?.items.length ? parsed.statusVsPlan?.trim() || undefined : undefined;
  return {
    org,
    window,
    projectSummary: parsed.projectSummary.trim(),
    people: peopleStandups,
    teamTotals: computeTeamStats(activity),
    statusVsPlan,
    roadmap: opts.roadmap,
  };
}
