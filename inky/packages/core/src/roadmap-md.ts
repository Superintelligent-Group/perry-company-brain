/**
 * ROADMAP.md parser — turns a checklist roadmap file into declared goals, for the
 * `roadmap-md` reconciliation source (teams that don't use GitHub Milestones).
 *
 * Format (intentionally the common OSS convention):
 *   # Roadmap                      ← H1 is the document title (ignored as a goal)
 *   ## Q3 Launch (due: 2026-09-01) ← H2/H3 heading = a goal; optional (due: YYYY-MM-DD)
 *   - [x] Auth                     ← checked task  → 1 closed
 *   - [ ] Dashboard                ← unchecked task → 1 open
 *
 * Progress = checked / total tasks. A goal with no checkbox tasks is skipped (it's
 * prose, not something to track). Pure + deterministic, so it's unit-tested with
 * fixtures — no network.
 */

/** A roadmap goal declared in ROADMAP.md, before reconciliation. */
export interface DeclaredGoal {
  title: string;
  /** ISO date (YYYY-MM-DD) parsed from a `(due: …)` suffix on the heading, if present. */
  dueOn?: string;
  /** Unchecked tasks. */
  openCount: number;
  /** Checked tasks. */
  closedCount: number;
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+\S/;
const DUE = /\(due:?\s*(\d{4}-\d{2}-\d{2})\)/i;

interface Draft {
  title: string;
  dueOn?: string;
  openCount: number;
  closedCount: number;
}

/** Parse ROADMAP.md content into declared goals (only those with ≥1 task). */
export function parseRoadmapMarkdown(content: string): DeclaredGoal[] {
  const goals: DeclaredGoal[] = [];
  let current: Draft | null = null;
  let docTitle: string | undefined;

  const flush = () => {
    if (current && current.openCount + current.closedCount > 0) {
      goals.push({
        title: current.title,
        dueOn: current.dueOn,
        openCount: current.openCount,
        closedCount: current.closedCount,
      });
    }
    current = null;
  };

  for (const raw of content.split('\n')) {
    const heading = raw.match(HEADING);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      if (level === 1) {
        // Document title — remember it (for naming stray tasks), don't open a goal.
        flush();
        docTitle = text;
        continue;
      }
      flush();
      const due = text.match(DUE);
      current = {
        title: text.replace(DUE, '').trim(),
        dueOn: due?.[1],
        openCount: 0,
        closedCount: 0,
      };
      continue;
    }

    const task = raw.match(TASK);
    if (task) {
      // A task before any heading is collected under an implicit goal.
      if (!current) current = { title: docTitle ?? 'Roadmap', openCount: 0, closedCount: 0 };
      const checked = task[1] !== ' ';
      if (checked) current.closedCount++;
      else current.openCount++;
    }
  }
  flush();
  return goals;
}
