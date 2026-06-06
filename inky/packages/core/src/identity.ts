/**
 * Identity resolution. People commit under multiple identities (work + personal
 * email, multiple machines, GitHub noreply addresses). This collapses them into
 * one canonical GitHub login so per-person activity merges correctly.
 *
 * Heuristic ported from team-perf, simplified because the GitHub API usually
 * gives us `author.login` directly (team-perf had to parse local git log and
 * resolve emails to logins via extra API calls).
 *
 * Resolution order for a raw observation:
 *   1. GitHub login (from the API), else
 *   2. login extracted from a `<login>@users.noreply.github.com` email, else
 *   3. the raw email (person has no linked GitHub account), else
 *   4. "unknown".
 * The resulting key is then run through the alias map to merge split identities.
 */
import type { AliasMap } from './config.js';
import type { Person } from './types.js';

/** A raw author observation from a single GitHub event. */
export interface RawIdentity {
  login?: string | null;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

/** Extract a login from a GitHub noreply email, e.g. `12345+octocat@users.noreply.github.com`. */
export function extractLoginFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** Build a reverse map: alias (lowercased) -> canonical login (lowercased). */
export function buildReverseAliasMap(aliases: AliasMap): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [canonical, list] of Object.entries(aliases)) {
    const canon = canonical.toLowerCase();
    for (const alias of list) reverse.set(alias.toLowerCase(), canon);
  }
  return reverse;
}

/**
 * Accumulates raw author observations across the org's events and produces
 * canonical Person records. Call resolve() for each event to get its canonical
 * key, then read all() once collection is done.
 */
export class IdentityResolver {
  private readonly reverse: Map<string, string>;
  private readonly people = new Map<string, Person>();

  constructor(aliases: AliasMap) {
    this.reverse = buildReverseAliasMap(aliases);
  }

  /** Resolve a raw observation to a canonical key, merging it into the people map. */
  resolve(raw: RawIdentity): string {
    const base =
      raw.login?.toLowerCase() ||
      extractLoginFromEmail(raw.email) ||
      raw.email?.toLowerCase() ||
      'unknown';

    // An explicit alias on the email takes precedence over one on the login.
    const key =
      (raw.email && this.reverse.get(raw.email.toLowerCase())) ||
      this.reverse.get(base) ||
      base;

    const existing = this.people.get(key);
    if (existing) {
      if (raw.email && !existing.emails.includes(raw.email.toLowerCase())) {
        existing.emails.push(raw.email.toLowerCase());
      }
      // Prefer a real display name / avatar if we didn't have one yet.
      if (raw.name && (!existing.displayName || existing.displayName === existing.login)) {
        existing.displayName = raw.name;
      }
      if (raw.avatarUrl && !existing.avatarUrl) existing.avatarUrl = raw.avatarUrl;
      // If we learn the real login later (started from an email key), keep the email key
      // stable but record the login — handled by alias config in practice.
    } else {
      this.people.set(key, {
        login: key,
        displayName: raw.name || key,
        emails: raw.email ? [raw.email.toLowerCase()] : [],
        avatarUrl: raw.avatarUrl ?? undefined,
      });
    }
    return key;
  }

  get(key: string): Person | undefined {
    return this.people.get(key);
  }

  all(): Person[] {
    return [...this.people.values()];
  }
}
