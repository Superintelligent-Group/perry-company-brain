/**
 * render() — turn normalized OrgActivity into a human-readable standup.
 *
 * Phase 2 is the *mechanical* renderer: deterministic markdown straight from the
 * activity, no AI. It doubles as the fallback when no Anthropic key is set, and
 * as the ground truth the Phase 3 summarizer is checked against. Output is
 * Discord-flavored markdown; the delivery layer handles chunking.
 *
 * It is commit-centric: the goal is to show what people *worked on*, shipped or
 * not. Merged feature PRs are highlighted as shipped work; commits on feature
 * branches are surfaced as in-progress work. Promotion/merge PRs (e.g. "Staging",
 * "main → production") are filtered out as noise.
 */
import type {
  CommitActivity,
  ItemMovement,
  OrgActivity,
  PersonActivity,
  PersonStandup,
  PullRequestActivity,
  RoadmapStatus,
  Standup,
  TeamStats,
} from './types.js';

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

/** A standup label that matches the actual window, so a 3-day view isn't "Daily". */
export function windowLabel(window: { since: string; until: string }): string {
  const hours = Math.round(
    (new Date(window.until).getTime() - new Date(window.since).getTime()) / 3_600_000,
  );
  if (hours < 20) return `Standup — last ${hours}h`; // sub-day window
  if (hours <= 26) return 'Daily Standup'; // ~24h, with slack
  const days = Math.round(hours / 24);
  if (days === 7) return 'Weekly Standup';
  if (Math.abs(hours - days * 24) <= 1) return `${days}-Day Standup`;
  return `Standup — last ${hours}h`;
}

/**
 * True for promotion/merge PRs that carry no feature signal: branch-promotion
 * ("Staging", "staging → main", "Promote: …"), env names, or "Merge X into Y".
 */
export function isPromotionPR(title: string): boolean {
  const t = title.trim();
  if (/^(staging|main|master|production|prod|dev|develop|release)$/i.test(t)) return true;
  if (/^promote\b/i.test(t)) return true;
  if (/^merge\b.*\binto\b/i.test(t)) return true;
  if (/\b(staging|main|master|production)\s*(→|->|=>|to)\s*(main|master|production|prod)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** A compact one-line stats summary, omitting zero-valued parts. */
function statLine(p: PersonActivity): string {
  const t = p.totals;
  const parts: string[] = [];
  if (t.commits) {
    const wip = t.unshippedCommits ? ` (${t.unshippedCommits} unshipped)` : '';
    parts.push(`${t.commits} commit${t.commits === 1 ? '' : 's'}${wip}`);
  }
  if (t.additions || t.deletions) parts.push(`+${fmtNum(t.additions)}/−${fmtNum(t.deletions)}`);
  const prBits: string[] = [];
  if (t.prsOpened) prBits.push(`${t.prsOpened} opened`);
  if (t.prsMerged) prBits.push(`${t.prsMerged} merged`);
  if (prBits.length) parts.push(`PRs: ${prBits.join(', ')}`);
  if (t.reviewsGiven) parts.push(`${t.reviewsGiven} review${t.reviewsGiven === 1 ? '' : 's'}`);
  const issueBits: string[] = [];
  if (t.issuesOpened) issueBits.push(`${t.issuesOpened} opened`);
  if (t.issuesClosed) issueBits.push(`${t.issuesClosed} closed`);
  if (issueBits.length) parts.push(`issues: ${issueBits.join(', ')}`);
  if (t.repos > 1) parts.push(`${t.repos} repos`);
  return parts.join(' · ');
}

/** Deduplicate commits by first-line message + repo (rebases/cherry-picks repeat). */
function dedupeCommits(commits: CommitActivity[]): CommitActivity[] {
  const seen = new Set<string>();
  const out: CommitActivity[] = [];
  for (const c of commits) {
    const key = `${c.repo}:${c.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function prLine(pr: PullRequestActivity): string {
  return `✅ shipped [#${pr.number}](${pr.url}) ${pr.title} \`${pr.repo}\``;
}

function commitLine(c: CommitActivity): string {
  const where = c.unshipped && c.branch ? ` \`${c.repo}@${c.branch}\`` : ` \`${c.repo}\``;
  const tag = c.unshipped ? '🔧 ' : '• ';
  return `${tag}${c.message}${where}`;
}

/**
 * Build the highlight lines for a person: shipped feature PRs first, then a
 * sample of commit work (in-progress commits prioritized), then reviews.
 */
function highlights(p: PersonActivity, opts: { commitSample: number }): string[] {
  const lines: string[] = [];

  const featurePRs = p.pullRequests.filter((pr) => pr.state === 'merged' && !isPromotionPR(pr.title));
  for (const pr of featurePRs.slice(0, 5)) lines.push(prLine(pr));

  // Commit work, in-progress first so unshipped effort is visible.
  const commits = dedupeCommits(p.commits).filter((c) => !/^merge\b/i.test(c.message));
  commits.sort((a, b) => Number(b.unshipped) - Number(a.unshipped));
  for (const c of commits.slice(0, opts.commitSample)) lines.push(commitLine(c));

  const reviewed = p.reviews.length;
  if (reviewed) lines.push(`👀 reviewed ${reviewed} PR${reviewed === 1 ? '' : 's'}`);

  return lines;
}

export interface RenderOptions {
  /** Title prefix. Defaults to a calendar emoji + "Daily Standup". */
  title?: string;
  /** Max commit lines to show per person (default 5). */
  commitSample?: number;
  /** Show the team-level stats panel (renderStandup only). */
  showStats?: boolean;
  /** Also show a per-person stat line under each name (renderStandup only). */
  statsPerPerson?: boolean;
  /** Previous equal-window stats — when set, the panel shows trend arrows. */
  prevStats?: TeamStats;
}

/** Render the full mechanical standup as Discord-flavored markdown. */
export function renderMechanical(activity: OrgActivity, opts: RenderOptions = {}): string {
  const { org, window, people } = activity;
  const title = opts.title ?? `📋 ${windowLabel(window)}`;
  const commitSample = opts.commitSample ?? 5;
  const day = fmtDate(window.until);
  const span = fmtDate(window.since) === day ? day : `${fmtDate(window.since)} → ${day}`;

  const out: string[] = [];
  out.push(`# ${title} — ${org}`);
  out.push(`**${span}** · ${people.length} contributor${people.length === 1 ? '' : 's'} active`);
  out.push('');

  if (people.length === 0) {
    out.push('_No GitHub activity in this window._');
    return out.join('\n');
  }

  for (const p of people) {
    const name =
      p.person.displayName && p.person.displayName !== p.person.login
        ? `${p.person.displayName} (\`${p.person.login}\`)`
        : `\`${p.person.login}\``;
    out.push(`## ${name}`);
    const stats = statLine(p);
    if (stats) out.push(`*${stats}*`);
    for (const line of highlights(p, { commitSample })) out.push(`- ${line}`);
    out.push('');
  }

  out.push('—');
  out.push('_Generated by Inky 🐙 from GitHub activity (all branches). Reflects code activity only._');
  return out.join('\n').trimEnd() + '\n';
}

/** A short relative phrase for stats headings, from the window length. */
function statsPeriod(window: { since: string; until: string }): string {
  const hours = Math.round(
    (new Date(window.until).getTime() - new Date(window.since).getTime()) / 3_600_000,
  );
  if (hours <= 26) return 'today';
  const days = Math.round(hours / 24);
  if (days === 7) return 'this week';
  if (days >= 28 && days <= 31) return 'this month';
  return `last ${days} days`;
}

/** Human-friendly duration from hours: "9m" under 1h, "5h" under 2 days, else "2.3d". */
function fmtDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * Team-level stats panel. Deliberately team-only and labels lines as size rather
 * than score — these inform, they are not a leaderboard (see docs/research). Adds
 * a throughput proxy (PR cycle time) and a stability proxy (revert rate).
 */
/** Trend arrow for a count vs the previous period: ↑/↓ with the magnitude, → if flat. */
function countDelta(cur: number, prev: number | undefined): string {
  if (prev === undefined) return '';
  const d = cur - prev;
  if (d === 0) return ' (→)';
  return d > 0 ? ` (↑${d})` : ` (↓${-d})`;
}

/** Trend arrow for a duration metric (hours); both windows must have a value. */
function hoursDelta(cur: number | null, prev: number | null | undefined): string {
  if (cur === null || prev === null || prev === undefined) return '';
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return ' (→)';
  // Arrow tracks the number; lower cycle time / review latency is the better direction.
  return d > 0 ? ` (↑${fmtDuration(d)})` : ` (↓${fmtDuration(-d)})`;
}

/** Block ramp for sparklines, low → high. */
const SPARK_RAMP = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * A unicode block sparkline for a series of non-negative values, scaled to the
 * max. Returns '' when every value is 0. The reusable visual primitive — used now
 * for the PR-size distribution, and later for multi-window history once it's stored.
 */
export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  if (max === 0) return '';
  const top = SPARK_RAMP.length - 1;
  return values.map((v) => SPARK_RAMP[Math.round((v / max) * top)]!).join('');
}

function teamStatsPanel(
  t: TeamStats,
  window: { since: string; until: string },
  prev?: TeamStats,
): string[] {
  const head = `### 📊 Team stats — ${statsPeriod(window)}`;
  const lines = [prev ? `${head} · trend vs previous period` : head];
  lines.push(
    `- **${t.prsMerged}** PRs merged${countDelta(t.prsMerged, prev?.prsMerged)}` +
      (t.prsOpened ? `, **${t.prsOpened}** opened${countDelta(t.prsOpened, prev?.prsOpened)}` : ''),
  );
  if (t.medianPrCycleHours !== null) {
    lines.push(
      `- median PR cycle time: **${fmtDuration(t.medianPrCycleHours)}**` +
        `${hoursDelta(t.medianPrCycleHours, prev?.medianPrCycleHours)} (open → merged)`,
    );
  }
  if (t.medianTimeToFirstReviewHours !== null) {
    lines.push(
      `- median time to first review: **${fmtDuration(t.medianTimeToFirstReviewHours)}**` +
        hoursDelta(t.medianTimeToFirstReviewHours, prev?.medianTimeToFirstReviewHours),
    );
  }
  const sz = t.prSizes;
  const sizedPrs = sz.xs + sz.s + sz.m + sz.l + sz.xl;
  if (sizedPrs) {
    const smallPct = Math.round(((sz.xs + sz.s) / sizedPrs) * 100);
    const spark = sparkline([sz.xs, sz.s, sz.m, sz.l, sz.xl]);
    lines.push(
      `- PR size \`${spark}\` (XS→XL): **${smallPct}%** small (<100 lines) — ` +
        `XS ${sz.xs} · S ${sz.s} · M ${sz.m} · L ${sz.l} · XL ${sz.xl}`,
    );
  }
  lines.push(
    `- **${t.commits}** commits${countDelta(t.commits, prev?.commits)}` +
      (t.unshippedCommits ? ` (**${t.unshippedCommits}** unshipped)` : ''),
  );
  // Activity shape over the window — only meaningful for multi-day windows with
  // commits (a daily standup is a single bucket).
  if (t.dailyCommits.length >= 2 && t.commits > 0) {
    lines.push(`- commits/day \`${sparkline(t.dailyCommits)}\` _(oldest → newest)_`);
  }
  if (t.commits) {
    lines.push(`- **${t.reverts}** reverts (**${(t.revertRate * 100).toFixed(1)}%** of commits)`);
  }
  if (t.reviews) lines.push(`- **${t.reviews}** reviews given${countDelta(t.reviews, prev?.reviews)}`);
  if (t.issuesOpened || t.issuesClosed) {
    lines.push(`- issues: **${t.issuesOpened}** opened, **${t.issuesClosed}** closed`);
  }
  lines.push(`- **${t.repos}** repo${t.repos === 1 ? '' : 's'} touched`);
  lines.push(`- **+${fmtNum(t.additions)} / −${fmtNum(t.deletions)}** lines _(size, not score)_`);
  return lines;
}

/** A compact per-person stat line, omitting zero-valued parts. */
function personTotalsLine(t: NonNullable<PersonStandup['totals']>): string {
  const parts: string[] = [];
  if (t.commits) {
    parts.push(`${t.commits} commit${t.commits === 1 ? '' : 's'}` + (t.unshippedCommits ? ` (${t.unshippedCommits} unshipped)` : ''));
  }
  const prBits: string[] = [];
  if (t.prsMerged) prBits.push(`${t.prsMerged} merged`);
  if (t.prsOpened) prBits.push(`${t.prsOpened} opened`);
  if (prBits.length) parts.push(`PRs: ${prBits.join('/')}`);
  if (t.reviewsGiven) parts.push(`${t.reviewsGiven} review${t.reviewsGiven === 1 ? '' : 's'}`);
  if (t.additions || t.deletions) parts.push(`+${fmtNum(t.additions)}/−${fmtNum(t.deletions)}`);
  if (t.repos > 1) parts.push(`${t.repos} repos`);
  return parts.join(' · ');
}

/** Movement → a short, scannable label for the roadmap panel. */
const MOVEMENT_LABEL: Record<ItemMovement, string> = {
  completed: '✅ completed',
  advanced: '📈 advanced',
  'in-progress': '🔧 in progress',
  stalled: '🛑 stalled',
  untouched: '• no movement',
};

/** Mechanical roadmap status lines (per tracked item), beneath the AI narrative. */
function roadmapPanel(roadmap: RoadmapStatus): string[] {
  const lines: string[] = [];
  for (const it of roadmap.items) {
    const total = it.item.openCount + it.item.closedCount;
    const pct = Math.round(it.progress * 100);
    const label =
      it.movement === 'advanced' && it.closedThisWindow
        ? `📈 advanced (+${it.closedThisWindow} this period)`
        : MOVEMENT_LABEL[it.movement];
    const bits = [label];
    if (it.atRisk) bits.push(`⚠️ ${it.note ?? 'at risk'}`);
    lines.push(`- **${it.item.title}** — ${it.item.closedCount}/${total} (${pct}%) · ${bits.join(' · ')}`);
  }
  if (roadmap.unplanned.closedIssues) {
    const n = roadmap.unplanned.closedIssues;
    lines.push(`- _${n} issue${n === 1 ? '' : 's'} closed outside any tracked milestone_`);
  }
  return lines;
}

/**
 * Render an AI-written Standup (output of summarize()) as Discord-flavored
 * markdown. Same shell as renderMechanical — title, span, footer — but the body
 * is the model's prose instead of mechanical bullet lines. Highlights, if any,
 * follow each narrative as bullets (they already carry their own refs). An
 * optional team stats panel, a roadmap status block, and per-person stat lines
 * are gated by opts / by the data's presence.
 */
export function renderStandup(standup: Standup, opts: RenderOptions = {}): string {
  const { org, window, projectSummary, people, statusVsPlan } = standup;
  const title = opts.title ?? `📋 ${windowLabel(window)}`;
  const day = fmtDate(window.until);
  const span = fmtDate(window.since) === day ? day : `${fmtDate(window.since)} → ${day}`;

  const out: string[] = [];
  out.push(`# ${title} — ${org}`);
  out.push(`**${span}** · ${people.length} contributor${people.length === 1 ? '' : 's'} active`);
  out.push('');

  // Stats lead the report (numbers first, evaluator-style), then the prose.
  if (opts.showStats && standup.teamTotals) {
    for (const line of teamStatsPanel(standup.teamTotals, window, opts.prevStats)) out.push(line);
    out.push('');
  }

  if (projectSummary) {
    out.push(projectSummary);
    out.push('');
  }

  // Status vs plan (Phase 5): the grounded narrative + the mechanical milestone
  // panel. Present only when roadmap reconciliation ran and tracked something.
  if (standup.roadmap && standup.roadmap.items.length) {
    out.push('## 📍 Status vs plan');
    if (statusVsPlan) {
      out.push(statusVsPlan);
      out.push('');
    }
    for (const line of roadmapPanel(standup.roadmap)) out.push(line);
    out.push('');
  }

  if (people.length === 0) {
    out.push('_No GitHub activity in this window._');
    return out.join('\n').trimEnd() + '\n';
  }

  for (const p of people) {
    const name =
      p.person.displayName && p.person.displayName !== p.person.login
        ? `${p.person.displayName} (\`${p.person.login}\`)`
        : `\`${p.person.login}\``;
    out.push(`## ${name}`);
    if (opts.statsPerPerson && p.totals) {
      const line = personTotalsLine(p.totals);
      if (line) out.push(`*${line}*`);
    }
    if (p.narrative) out.push(p.narrative);
    // Group bullets by repo; show a repo subheader only when the person spans >1.
    const multiRepo = p.work.length > 1;
    for (const group of p.work) {
      if (multiRepo) out.push(`**${group.repo}**`);
      for (const pt of group.points) out.push(`- ${pt}`);
    }
    out.push('');
  }

  out.push('—');
  out.push('_Written by Inky 🐙 from GitHub activity (all branches). AI-summarized; reflects code activity only._');
  return out.join('\n').trimEnd() + '\n';
}
