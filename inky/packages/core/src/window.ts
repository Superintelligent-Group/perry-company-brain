/**
 * Resolve a standup window from CLI args into the (end, length) pair the core
 * uses. The window is [since, until]:
 *   --since A --until B   → exactly [A, B]
 *   --until B (+ --days N) → N days ending at B
 *   --since A             → [A, now]
 *   --days N (only)       → N days ending now (the default)
 *
 * `collect()` computes its window as [now − windowHours, now], so we return the
 * window END (its `now`, undefined = live now) and the length in hours.
 */
export interface ResolveWindowArgs {
  since?: string;
  until?: string;
  /** Length in hours from --days/--hours, if given. */
  windowHours?: number;
  /** Injectable clock for the --since-only case (defaults to real now). */
  now?: Date;
}

export interface ResolvedWindow {
  /** Pass as collect()'s `now` — undefined means "live now". */
  windowEnd?: Date;
  /** Pass as collect()'s `windowHours` — undefined means "config default". */
  windowHours?: number;
}

function parseDate(raw: string, flag: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${flag}: invalid date "${raw}" (use e.g. 2026-06-01 or an ISO timestamp)`);
  }
  return d;
}

export function resolveWindow(args: ResolveWindowArgs): ResolvedWindow {
  const until = args.until !== undefined ? parseDate(args.until, '--until') : undefined;
  const since = args.since !== undefined ? parseDate(args.since, '--since') : undefined;

  let windowHours = args.windowHours;
  if (since) {
    // The length is fully determined by since → end; --days/--hours is ignored.
    const end = until ?? args.now ?? new Date();
    const hours = (end.getTime() - since.getTime()) / 3_600_000;
    if (hours <= 0) throw new Error('--since must be before --until (or now)');
    windowHours = hours;
  }

  return { windowEnd: until, windowHours };
}
