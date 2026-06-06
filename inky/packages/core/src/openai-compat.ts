/**
 * OpenAI-compatible LLM adapter: one fetch-based implementation that serves Groq,
 * OpenAI, OpenRouter, a local Ollama — anything speaking the /chat/completions
 * API. It translates Inky's narrow (Anthropic-shaped) `MessagesCreate` request
 * into a chat-completions call and maps the response back, so summarize() doesn't
 * know or care which provider answered.
 *
 * Translation notes:
 *   - system blocks → one `system` role message (cache_control is dropped; only
 *     Anthropic honors it).
 *   - tools: {name, description, input_schema} → {type:'function', function:{…}}.
 *     A forced tool_choice maps to {type:'function', function:{name}}.
 *   - the model's first tool_call.arguments (a JSON string) becomes our tool_use
 *     block's `input`, matching the shape summarize() already parses.
 *
 * No SDK dependency — Node's global fetch is enough, and an injectable fetch keeps
 * the adapter unit-testable without a network.
 */
import type { CreateMessageParams, MessageResponse, MessagesCreate } from './summarize.js';

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;

export interface OpenAICompatOptions {
  apiKey: string;
  /** API base, e.g. https://api.groq.com/openai/v1 (no trailing /chat/completions). */
  baseUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Build a MessagesCreate backed by an OpenAI-compatible /chat/completions API. */
export function makeOpenAICompatMessagesCreate(opts: OpenAICompatOptions): MessagesCreate {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return async (params: CreateMessageParams): Promise<MessageResponse> => {
    const systemText = params.system.map((s) => s.text).join('\n\n');
    const body = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: [
        { role: 'system', content: systemText },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      tools: params.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: { type: 'function', function: { name: params.tool_choice.name } },
    };

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    const call = message?.tool_calls?.[0]?.function;

    const content: MessageResponse['content'] = call?.name
      ? [{ type: 'tool_use', name: call.name, input: safeParse(call.arguments) }]
      : [{ type: 'text', text: message?.content ?? '' }];

    return {
      content,
      usage: {
        input_tokens: data.usage?.prompt_tokens,
        output_tokens: data.usage?.completion_tokens,
      },
    };
  };
}

/** Tool-call arguments arrive as a JSON string; tolerate malformed output. */
function safeParse(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
