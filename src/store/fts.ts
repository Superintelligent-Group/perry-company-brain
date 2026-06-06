// fts — split out of the former monolithic meeting-store.ts
import { type Row } from "./types";
import { statement, withBrainTransaction, withDb } from "./db";

export function flushFtsQueue(limit = 1000): number {
  return withDb((db) => {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100_000);
    const countRow = statement(
      db,
      "SELECT COUNT(*) AS count FROM (SELECT 1 FROM fts_queue ORDER BY queued_at LIMIT ?)"
    ).get(normalizedLimit) as Row;
    const count = Number(countRow.count);
    if (count === 0) return 0;
    withBrainTransaction(() => {
      statement(
        db,
        `INSERT INTO brain_fts (type, entity_id, meeting_id, title, body, url, created_at)
         SELECT type, entity_id, meeting_id, title, body, url, created_at
         FROM fts_queue
         ORDER BY queued_at
         LIMIT ?`
      ).run(normalizedLimit);
      statement(
        db,
        `DELETE FROM fts_queue
         WHERE entity_key IN (
           SELECT entity_key FROM fts_queue ORDER BY queued_at LIMIT ?
         )`
      ).run(normalizedLimit);
    });
    return count;
  });
}

export function pendingFtsCount(): number {
  return withDb((db) => {
    const row = statement(db, "SELECT COUNT(*) AS count FROM fts_queue").get() as Row;
    return Number(row.count);
  });
}
