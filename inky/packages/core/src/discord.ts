/**
 * Discord delivery. Posts a standup to a channel via an incoming webhook.
 *
 * We send the standup as embeds rather than plain message content because
 * Discord only renders masked links (`[text](url)`) and reliable markdown inside
 * embeds. Long standups are split across multiple embeds (4096 chars each) and
 * batched into messages (10 embeds each), with basic 429 backoff.
 */

const EMBED_DESCRIPTION_LIMIT = 4096;
export const EMBEDS_PER_MESSAGE = 10;
const INKY_COLOR = 0x5865f2; // Discord blurple

/**
 * Split markdown into chunks no longer than `limit`, breaking on line
 * boundaries and preferring to start a new chunk before a `## ` person header
 * once the current chunk is reasonably full (keeps people sections intact).
 */
export function chunkMarkdown(text: string, limit = EMBED_DESCRIPTION_LIMIT): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur = '';

  const flush = () => {
    if (cur.length) chunks.push(cur.replace(/\n+$/, ''));
    cur = '';
  };

  for (const line of lines) {
    const isPersonHeader = line.startsWith('## ');
    const wouldOverflow = cur.length + line.length + 1 > limit;
    const preferBreak = isPersonHeader && cur.length > limit * 0.6;

    if ((wouldOverflow || preferBreak) && cur.length) flush();

    // A single line longer than the limit (very rare) must be hard-split.
    if (line.length > limit) {
      flush();
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    cur += (cur.length ? '\n' : '') + line;
  }
  flush();
  return chunks.length ? chunks : [''];
}

/** A Discord embed as we build them: a chunk of the standup markdown, blurple. */
export interface StandupEmbed {
  description: string;
  color: number;
}

/**
 * Turn standup markdown into Discord embeds (chunked to the per-embed limit).
 * Shared by the webhook poster and the `/standup` slash command so both render
 * the standup identically.
 */
export function standupEmbeds(markdown: string): StandupEmbed[] {
  return chunkMarkdown(markdown).map((description) => ({ description, color: INKY_COLOR }));
}

export interface PostOptions {
  username?: string;
  /** Injectable fetch + sleep for testing. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST one message (with up to 10 embeds), retrying once on HTTP 429. */
async function postMessage(
  webhookUrl: string,
  embeds: object[],
  opts: Required<Pick<PostOptions, 'fetchImpl' | 'sleep'>> & Pick<PostOptions, 'username'>,
): Promise<void> {
  const body = JSON.stringify({ username: opts.username ?? 'Inky', embeds });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await opts.fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (res.status === 429) {
      const retryMs = Number(res.headers.get('retry-after') ?? '1') * 1000 || 1000;
      await opts.sleep(retryMs);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Discord webhook returned ${res.status}: ${detail.slice(0, 300)}`);
    }
    return;
  }
  throw new Error('Discord webhook rate-limited after retry');
}

/** Post a full standup (markdown) to a Discord webhook. */
export async function postStandupToDiscord(
  webhookUrl: string,
  markdown: string,
  opts: PostOptions = {},
): Promise<{ messages: number; embeds: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  const embeds = standupEmbeds(markdown);

  let messages = 0;
  for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
    const batch = embeds.slice(i, i + EMBEDS_PER_MESSAGE);
    await postMessage(webhookUrl, batch, { fetchImpl, sleep, username: opts.username });
    messages++;
    if (i + EMBEDS_PER_MESSAGE < embeds.length) await sleep(300); // gentle pacing
  }
  return { messages, embeds: embeds.length };
}
