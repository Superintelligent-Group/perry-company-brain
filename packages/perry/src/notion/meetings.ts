import { Client } from "@notionhq/client";
import { loadAppSettings } from "@core";
import type { MeetingNote } from "@meetings";
import { meetingNotesSchema } from "./wiki-schema";

export interface CreatedMeetingPage {
  id: string;
  url?: string;
}

export async function createMeetingNotePage(
  note: MeetingNote,
  options: { dataSourceId?: string } = {}
): Promise<CreatedMeetingPage | undefined> {
  if (process.env.PERRY_NOTION_DRY_RUN === "true") {
    return {
      id: `dry-run-${note.sourceId ?? slug(note.title)}`,
      url: `https://notion.example/perry-dry-run/${encodeURIComponent(note.sourceId ?? slug(note.title))}`,
    };
  }

  const settings = loadAppSettings();
  const notionToken = process.env.NOTION_TOKEN;
  const dataSourceId =
    options.dataSourceId ??
    process.env.NOTION_MEETING_NOTES_DATA_SOURCE_ID ??
    settings.notion.meetingNotesDataSourceId;
  if (!notionToken || !dataSourceId) return undefined;

  const notion = new Client({ auth: notionToken, notionVersion: "2025-09-03" } as any);
  const page = await notion.pages.create({
    parent: { data_source_id: dataSourceId } as any,
    properties: {
      [meetingNotesSchema.title]: {
        title: [{ text: { content: note.title } }],
      },
      [meetingNotesSchema.source]: {
        select: { name: "Granola" },
      },
      [meetingNotesSchema.sourceId]: note.sourceId
        ? {
            rich_text: [{ text: { content: note.sourceId } }],
          }
        : undefined,
      [meetingNotesSchema.date]: note.startedAt
        ? {
            date: { start: note.startedAt },
          }
        : undefined,
      [meetingNotesSchema.granolaLink]: note.sourceUrl
        ? {
            url: note.sourceUrl,
          }
        : undefined,
      [meetingNotesSchema.attendees]:
        note.attendees.length > 0
          ? {
              rich_text: [
                {
                  text: {
                    content: note.attendees
                      .map((attendee) => attendee.name ?? attendee.email)
                      .filter(Boolean)
                      .join(", "),
                  },
                },
              ],
            }
          : undefined,
    },
    children: buildMeetingBlocks(note),
  } as any);

  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function buildMeetingBlocks(note: MeetingNote): any[] {
  const blocks: any[] = [
    heading("Summary"),
    ...markdownParagraphs(note.summaryMarkdown),
  ];

  if (note.privateNotes) {
    blocks.push(heading("Private Notes"), ...markdownParagraphs(note.privateNotes));
  }

  if (note.transcript) {
    blocks.push(heading("Transcript"), ...markdownParagraphs(note.transcript.slice(0, 15000)));
  }

  return blocks.slice(0, 100);
}

function heading(content: string): any {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function markdownParagraphs(markdown: string): any[] {
  return markdown
    .split(/\n{2,}/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: chunk.slice(0, 1900) } }],
      },
    }));
}

