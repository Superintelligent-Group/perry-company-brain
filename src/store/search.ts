// search — split out of the former monolithic meeting-store.ts
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type BrainSearchOptions, type BrainSearchResult, type Row } from "./types";
import { optionalString, statement, withDb } from "./db";

export function searchBrain(query: string, limit = 20, options: BrainSearchOptions = {}): BrainSearchResult[] {
  let ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const types = options.types?.filter((type) => type === "meeting" || type === "decision" || type === "action") ?? [];
  if (types.length === 1) {
    ftsQuery = `type:${types[0]} ${ftsQuery}`;
  }
  return withDb((db) => {
    const rows = searchBrainFtsRows(db, ftsQuery, normalizedLimit, types);
    const relaxedQuery = rows.length === 0 ? toRelaxedFtsQuery(query) : "";
    const relaxedRows = rows.length > 0 || !relaxedQuery ? rows : searchBrainFtsRows(db, relaxedQuery, normalizedLimit, types);
    const anyQuery = relaxedRows.length === 0 ? toAnyFtsQuery(query) : "";
    return (relaxedRows.length > 0 || !anyQuery ? relaxedRows : searchBrainFtsRows(db, anyQuery, normalizedLimit, types)).map((row) => {
      const item = row as Row;
      return {
        type: String(item.type) as BrainSearchResult["type"],
        id: String(item.entity_id),
        meetingId: optionalString(item.meeting_id),
        title: String(item.title),
        snippet: String(item.body),
        url: optionalString(item.url),
        createdAt: String(item.created_at),
      };
    });
  });
}

function searchBrainFtsRows(
  db: DatabaseSync,
  ftsQuery: string,
  normalizedLimit: number,
  types: Array<BrainSearchResult["type"]>
): Row[] {
  const typeClause = types.length > 1 ? ` AND type IN (${types.map(() => "?").join(", ")})` : "";
  const params = types.length > 1 ? [ftsQuery, ...types, normalizedLimit] : [ftsQuery, normalizedLimit];
  return statement(
    db,
    `SELECT type, entity_id, meeting_id, title, body, url, created_at
     FROM brain_fts
     WHERE brain_fts MATCH ?${typeClause}
     ORDER BY bm25(brain_fts)
     LIMIT ?`
  ).all(...params) as Row[];
}

function toFtsQuery(query: string): string {
  return ftsQueryParts(query)
    .map((part) => `${part}*`)
    .join(" ");
}

function toRelaxedFtsQuery(query: string): string {
  return ftsQueryParts(query)
    .filter((part) => !/^\d$/u.test(part))
    .map((part) => `${part}*`)
    .join(" ");
}

function toAnyFtsQuery(query: string): string {
  return ftsQueryParts(query)
    .filter((part) => !/^\d$/u.test(part))
    .map((part) => `${part}*`)
    .join(" OR ");
}

function ftsQueryParts(query: string): string[] {
  return query
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
