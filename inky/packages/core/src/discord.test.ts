import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown, postStandupToDiscord } from './discord.js';

test('chunkMarkdown keeps every chunk within the limit', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line number ${i} with some text`);
  const chunks = chunkMarkdown(lines.join('\n'), 100);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 100, `chunk too long: ${c.length}`);
});

test('chunkMarkdown hard-splits a single over-long line', () => {
  const chunks = chunkMarkdown('x'.repeat(250), 100);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(''), 'x'.repeat(250));
});

test('chunkMarkdown returns one chunk for short text', () => {
  assert.deepEqual(chunkMarkdown('## dev\n- did things', 4096), ['## dev\n- did things']);
});

test('postStandupToDiscord batches embeds and posts via injected fetch', async () => {
  const calls: object[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  // 25 person sections each ~3.9k chars (just under the 4096 embed limit), so
  // each becomes its own embed -> 25 embeds -> 3 messages (10/10/5).
  const md = Array.from({ length: 25 }, (_, i) => `## person${i}\n- ${'detail '.repeat(550)}`).join('\n');
  const result = await postStandupToDiscord('https://discord/webhook', md, {
    fetchImpl: fakeFetch,
    sleep: async () => {},
  });

  assert.equal(result.embeds, 25);
  assert.equal(result.messages, 3);
  assert.equal(result.messages, calls.length);
  for (const body of calls as Array<{ embeds: unknown[]; username: string }>) {
    assert.ok(body.embeds.length <= 10);
    assert.equal(body.username, 'Inky');
  }
});

test('postStandupToDiscord throws a useful error on non-2xx', async () => {
  const fakeFetch = (async () =>
    new Response('bad webhook', { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(
    postStandupToDiscord('https://discord/webhook', '## dev\n- x', {
      fetchImpl: fakeFetch,
      sleep: async () => {},
    }),
    /Discord webhook returned 404/,
  );
});
