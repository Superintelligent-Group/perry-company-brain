import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOpenAICompatMessagesCreate } from './openai-compat.js';
import type { CreateMessageParams } from './summarize.js';

const params: CreateMessageParams = {
  model: 'llama-3.3-70b-versatile',
  max_tokens: 1024,
  system: [{ type: 'text', text: 'be terse', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'the digest' }],
  tools: [
    {
      name: 'emit_standup',
      description: 'emit it',
      input_schema: { type: 'object', properties: { projectSummary: { type: 'string' } } },
    },
  ],
  tool_choice: { type: 'tool', name: 'emit_standup' },
};

/** A fake fetch that records the request and returns a canned chat completion. */
function fakeFetch(
  responseBody: unknown,
  record: { url?: string; body?: any } = {},
  ok = true,
) {
  return async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    record.url = url;
    record.body = JSON.parse(init.body);
    return {
      ok,
      status: ok ? 200 : 500,
      text: async () => 'error body',
      json: async () => responseBody,
    };
  };
}

test('translates Anthropic-shaped params into a chat-completions request', async () => {
  const record: { url?: string; body?: any } = {};
  const create = makeOpenAICompatMessagesCreate({
    apiKey: 'k',
    baseUrl: 'https://api.groq.com/openai/v1',
    fetchImpl: fakeFetch(
      { choices: [{ message: { tool_calls: [{ function: { name: 'emit_standup', arguments: '{}' } }] } }] },
      record,
    ),
  });
  await create(params);

  assert.equal(record.url, 'https://api.groq.com/openai/v1/chat/completions');
  // system block flattened to a system message
  assert.equal(record.body.messages[0].role, 'system');
  assert.equal(record.body.messages[0].content, 'be terse');
  assert.equal(record.body.messages[1].content, 'the digest');
  // tool translated to OpenAI function shape + forced
  assert.equal(record.body.tools[0].type, 'function');
  assert.equal(record.body.tools[0].function.name, 'emit_standup');
  assert.deepEqual(record.body.tool_choice, { type: 'function', function: { name: 'emit_standup' } });
});

test('maps a tool_call back into a tool_use block summarize() can read', async () => {
  const create = makeOpenAICompatMessagesCreate({
    apiKey: 'k',
    baseUrl: 'https://api.groq.com/openai/v1',
    fetchImpl: fakeFetch({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: 'emit_standup', arguments: '{"projectSummary":"shipped"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 40 },
    }),
  });
  const res = await create(params);
  assert.equal(res.content[0]?.type, 'tool_use');
  assert.equal((res.content[0] as any).name, 'emit_standup');
  assert.deepEqual((res.content[0] as any).input, { projectSummary: 'shipped' });
  assert.equal(res.usage?.input_tokens, 300);
  assert.equal(res.usage?.output_tokens, 40);
});

test('falls back to a text block when the model returns no tool call', async () => {
  const create = makeOpenAICompatMessagesCreate({
    apiKey: 'k',
    baseUrl: 'https://x/v1',
    fetchImpl: fakeFetch({ choices: [{ message: { content: 'no can do' } }] }),
  });
  const res = await create(params);
  assert.equal(res.content[0]?.type, 'text');
  assert.equal((res.content[0] as any).text, 'no can do');
});

test('throws a readable error on a non-OK response', async () => {
  const create = makeOpenAICompatMessagesCreate({
    apiKey: 'k',
    baseUrl: 'https://x/v1',
    fetchImpl: fakeFetch({}, {}, false),
  });
  await assert.rejects(() => create(params), /LLM request failed: 500/);
});
