import type { MeetingNote } from "@meetings";
import { extractMeetingSemanticsWithLmStudio } from "./lm-studio";
import { extractMeetingSemanticsWithTogether } from "./together";
import type { LocalSemanticExtraction } from "./semantic";

export type ExtractionBackend = "lmstudio" | "together";

/** Resolves the configured semantic-extraction backend (default: lmstudio). */
export function getExtractionBackend(env: NodeJS.ProcessEnv = process.env): ExtractionBackend {
  return (env.PERRY_EXTRACTION_BACKEND ?? "lmstudio").trim().toLowerCase() === "together"
    ? "together"
    : "lmstudio";
}

/**
 * Backend-agnostic semantic extraction. Routes to Together.ai (via the AI SDK)
 * or a local LM Studio / OpenAI-compatible endpoint based on
 * PERRY_EXTRACTION_BACKEND, so callers never hard-code a provider.
 */
export async function extractMeetingSemantics(
  note: MeetingNote,
  env: NodeJS.ProcessEnv = process.env
): Promise<LocalSemanticExtraction> {
  return getExtractionBackend(env) === "together"
    ? extractMeetingSemanticsWithTogether(note)
    : extractMeetingSemanticsWithLmStudio(note);
}
