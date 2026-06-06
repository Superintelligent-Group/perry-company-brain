import { enqueueMeetingGraphSync } from "./queue";
import { listMeetingGraphBackfillRecords, type MeetingGraphBackfillRecord, type PageOptions } from "@store";

export interface GraphBackfillResult {
  scanned: number;
  queued: number;
  skipped: number;
  offset: number;
  limit: number;
}

export function enqueueGraphBackfillPage(options: PageOptions = {}): GraphBackfillResult {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 1000);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const records = listMeetingGraphBackfillRecords({ limit, offset });
  let queued = 0;
  let skipped = 0;

  for (const item of records) {
    const job = enqueueMeetingGraphSync(toSyncInput(item));
    if (job) queued += 1;
    else skipped += 1;
  }

  return {
    scanned: records.length,
    queued,
    skipped,
    offset,
    limit,
  };
}

function toSyncInput(item: MeetingGraphBackfillRecord): Parameters<typeof enqueueMeetingGraphSync>[0] {
  const summaryMarkdown = [
    item.knowledge.decisions.length > 0
      ? `Decisions:\n${item.knowledge.decisions.map((decision) => `- ${decision.text}`).join("\n")}`
      : undefined,
    item.knowledge.actionItems.length > 0
      ? `Action items:\n${item.knowledge.actionItems.map((action) => `- ${formatAction(action)}`).join("\n")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    note: {
      source: item.record.source,
      sourceId: item.record.sourceId,
      title: item.record.title,
      attendees: [],
      startedAt: item.record.createdAt,
      summaryMarkdown: summaryMarkdown || item.record.title,
      sourceUrl: item.record.notionUrl,
    },
    record: item.record,
    knowledge: item.knowledge,
    notionUrl: item.record.notionUrl,
    discordMessageUrl: item.record.discordMessageUrl,
  };
}

function formatAction(action: { text: string; owner?: string; dueDate?: string }): string {
  const prefix = action.owner ? `${action.owner}: ` : "";
  const suffix = action.dueDate ? ` by ${action.dueDate}` : "";
  return `${prefix}${action.text}${suffix}`;
}
