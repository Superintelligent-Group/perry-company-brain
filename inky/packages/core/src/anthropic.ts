/**
 * Real Anthropic adapter: the thin boundary between Inky's narrow
 * `MessagesCreate` interface and the official SDK. Everything testable lives in
 * summarize.ts; this file is the one piece that actually hits the network, so it
 * stays a near one-liner and is the only thing that needs a live key.
 *
 * BYO key: the key comes from ANTHROPIC_API_KEY (loadSecrets), never config.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CreateMessageParams, MessageResponse, MessagesCreate } from './summarize.js';

/** Wrap an Anthropic client's messages.create into our injectable interface. */
export function makeMessagesCreate(apiKey: string): MessagesCreate {
  const client = new Anthropic({ apiKey });
  return (params: CreateMessageParams): Promise<MessageResponse> =>
    // The SDK's param/response types are a strict superset of ours; the shapes we
    // use (system blocks w/ cache_control, a forced tool call, tool_use content)
    // are wire-compatible, so we cross the boundary with a cast here only.
    client.messages.create(params as never) as unknown as Promise<MessageResponse>;
}
