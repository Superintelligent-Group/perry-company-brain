import { z } from "zod";

export interface MeetingNote {
  source: "granola";
  sourceId?: string;
  title: string;
  creatorName?: string;
  creatorEmail?: string;
  attendees: Array<{ name?: string; email?: string }>;
  calendarTitle?: string;
  startedAt?: string;
  summaryMarkdown: string;
  transcript?: string;
  privateNotes?: string;
  sourceUrl?: string;
  folderName?: string;
}

const GranolaZapierPayloadSchema = z
  .object({
    id: z.string().optional(),
    note_id: z.string().optional(),
    sourceId: z.string().optional(),
    title: z.string().optional(),
    creator: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    attendees: z
      .array(
        z.object({
          name: z.string().optional(),
          email: z.string().optional(),
        })
      )
      .optional(),
    calendar_event: z
      .object({
        title: z.string().optional(),
        start_time: z.string().optional(),
        start: z.string().optional(),
      })
      .optional(),
    my_notes: z.string().optional(),
    summary: z.string().optional(),
    transcript: z.string().optional(),
    link: z.string().optional(),
    url: z.string().optional(),
    folder: z.string().optional(),
    folder_name: z.string().optional(),
    folderName: z.string().optional(),
  })
  .passthrough();

export function normalizeGranolaZapierPayload(input: unknown): MeetingNote {
  const payload = GranolaZapierPayloadSchema.parse(input);
  const title = payload.title ?? payload.calendar_event?.title ?? "Untitled Granola note";
  const summaryMarkdown = payload.summary?.trim() || "No enhanced summary was included.";

  return {
    source: "granola",
    sourceId: payload.note_id ?? payload.id ?? payload.sourceId,
    title,
    creatorName: payload.creator?.name,
    creatorEmail: payload.creator?.email,
    attendees: payload.attendees ?? [],
    calendarTitle: payload.calendar_event?.title,
    startedAt: payload.calendar_event?.start_time ?? payload.calendar_event?.start,
    summaryMarkdown,
    transcript: payload.transcript,
    privateNotes: payload.my_notes,
    sourceUrl: payload.link ?? payload.url,
    folderName: payload.folder_name ?? payload.folderName ?? payload.folder,
  };
}

export function formatMeetingAnnouncement(note: MeetingNote, notionUrl?: string): string {
  const lines = [`**Meeting notes: ${note.title}**`];
  if (note.startedAt) lines.push(`Date: ${formatDateTime(note.startedAt)}`);
  if (note.creatorName) lines.push(`Captured by: ${note.creatorName}`);
  if (note.attendees.length > 0) {
    lines.push(`Attendees: ${note.attendees.map((attendee) => attendee.name ?? attendee.email).join(", ")}`);
  }
  if (notionUrl) lines.push(`Notion: ${notionUrl}`);
  if (note.sourceUrl) lines.push(`Granola: ${note.sourceUrl}`);
  lines.push("");
  lines.push(truncateForDiscord(note.summaryMarkdown, 1400));
  return lines.join("\n");
}

function truncateForDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
