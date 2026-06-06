import type { MeetingNote } from "@meetings";
import {
  buildExtractionPrompt,
  parseLocalSemanticExtraction,
  SEMANTIC_EXTRACTION_SYSTEM_PROMPT,
  type LocalSemanticExtraction,
} from "./semantic";

function localSemanticExtractionResponseFormat(): object {
  return {
    type: "json_schema",
    json_schema: {
      name: "perry_local_semantic_extraction",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
          actionItems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                owner: { type: "string" },
                dueDate: { type: "string" },
              },
              required: ["text"],
            },
          },
          entities: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["person", "project", "repository", "customer", "policy", "channel", "data_source"] },
                name: { type: "string" },
                stableKey: { type: "string" },
              },
              required: ["type", "name"],
            },
          },
          confidence: { type: "number" },
        },
        required: ["decisions", "actionItems", "entities", "confidence"],
      },
    },
  };
}

export interface LmStudioExtractionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxContextChars: number;
  temperature: number;
}

export function getLmStudioExtractionConfig(env: NodeJS.ProcessEnv = process.env): LmStudioExtractionConfig {
  return {
    baseUrl: (env.LMSTUDIO_BASE_URL ?? env.GRAPHITI_OPENAI_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/u, ""),
    apiKey: env.LMSTUDIO_API_KEY ?? env.GRAPHITI_OPENAI_API_KEY ?? "lm-studio",
    model: env.PERRY_LMSTUDIO_EXTRACTION_MODEL ?? env.GRAPHITI_LLM_MODEL ?? "local-model",
    timeoutMs: Math.max(Number(env.PERRY_LMSTUDIO_EXTRACTION_TIMEOUT_MS ?? 30_000), 1_000),
    maxContextChars: Math.max(Number(env.PERRY_LMSTUDIO_EXTRACTION_CONTEXT_CHARS ?? 24_000), 2_000),
    temperature: Number(env.PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE ?? 0),
  };
}

export async function extractMeetingSemanticsWithLmStudio(
  note: MeetingNote,
  config: LmStudioExtractionConfig = getLmStudioExtractionConfig()
): Promise<LocalSemanticExtraction> {
  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, config.timeoutMs, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      response_format: localSemanticExtractionResponseFormat(),
      messages: [
        { role: "system", content: SEMANTIC_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: buildExtractionPrompt(note, config.maxContextChars) },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LM Studio extraction failed: ${response.status} ${text}`);
  const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LM Studio extraction failed: empty response content");
  return parseLocalSemanticExtraction(content);
}

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
