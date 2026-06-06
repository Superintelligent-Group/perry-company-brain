import { z } from "zod";
import type { MeetingNote } from "@meetings";

/**
 * The structured "company-brain objects" an LLM extracts from a meeting note.
 * Shared by every extraction backend (LM Studio, Together.ai) so the contract
 * — and the prompt that produces it — lives in exactly one place.
 */
export const LocalSemanticExtractionSchema = z.object({
  decisions: z.array(z.object({ text: z.string().min(1) })).default([]),
  actionItems: z
    .array(
      z.object({
        text: z.string().min(1),
        owner: z.string().optional(),
        dueDate: z.string().optional(),
      })
    )
    .default([]),
  entities: z
    .array(
      z.object({
        type: z.enum(["person", "project", "repository", "customer", "policy", "channel", "data_source"]),
        name: z.string().min(1),
        stableKey: z.string().optional(),
      })
    )
    .default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type LocalSemanticExtraction = z.infer<typeof LocalSemanticExtractionSchema>;

/** System instruction shared by all semantic-extraction backends. */
export const SEMANTIC_EXTRACTION_SYSTEM_PROMPT =
  "Extract company-brain objects from a meeting. Return only valid JSON with decisions, actionItems, entities, and confidence. Preserve each Decisions bullet as a separate decision and each Action items bullet as a separate action item. Extract explicit repository names like owner/repo, explicit customer names, project names, policies, channels, and data sources. Do not include private notes unless provided in the user message.";

/** Builds the user-message body from a meeting note, capped to maxContextChars. */
export function buildExtractionPrompt(note: MeetingNote, maxContextChars: number): string {
  const body = [
    `Title: ${note.title}`,
    note.calendarTitle ? `Calendar: ${note.calendarTitle}` : undefined,
    note.folderName ? `Folder: ${note.folderName}` : undefined,
    note.startedAt ? `Started: ${note.startedAt}` : undefined,
    note.attendees.length
      ? `Attendees: ${note.attendees.map((attendee) => attendee.name ?? attendee.email).filter(Boolean).join(", ")}`
      : undefined,
    "Summary:",
    note.summaryMarkdown,
  ]
    .filter(Boolean)
    .join("\n");
  return body.slice(0, maxContextChars);
}

/** Parses + validates a raw LLM JSON response (tolerates surrounding prose). */
export function parseLocalSemanticExtraction(content: string): LocalSemanticExtraction {
  const parsed = JSON.parse(extractJsonObject(content)) as unknown;
  return LocalSemanticExtractionSchema.parse(parsed);
}

/** Slices the outermost { … } object out of a possibly chatty response. */
export function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Semantic extraction response did not contain a JSON object");
  return trimmed.slice(start, end + 1);
}
