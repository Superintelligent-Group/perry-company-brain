/**
 * Provider resolution: map (config.provider + available env key) → the one
 * injected `MessagesCreate` the pipeline uses. This is the single place that
 * knows about concrete providers; summarize() stays agnostic.
 *
 * Returns null when no key is configured for the chosen provider, so the CLI can
 * fall back to the mechanical render instead of erroring.
 */
import type { Config, Secrets } from './config.js';
import type { MessagesCreate } from './summarize.js';
import { makeMessagesCreate } from './anthropic.js';
import { makeOpenAICompatMessagesCreate } from './openai-compat.js';

/** Default base URLs for the OpenAI-compatible providers. */
const BASE_URLS: Record<'groq' | 'openai', string> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
};

/**
 * Sensible default model per provider when config.model is omitted. summarize()
 * is constrained extraction over a pre-built digest, not open reasoning, so a
 * small/fast model matches the bigger ones in quality at a fraction of the cost
 * — and this runs daily, on the user's own key. Bump via config.model for bigger
 * or noisier teams that want more headroom (e.g. claude-sonnet-4-6).
 */
const DEFAULT_MODELS: Record<Config['provider'], string> = {
  // Sonnet over Haiku: live A/B showed Haiku occasionally mislabels org-wide
  // aggregates (reported a per-person count as the team total) even with verified
  // figures in the digest; Sonnet got every aggregate right and writes a richer
  // standup, still cheaply. Drop to claude-haiku-4-5 via config.model to cut cost.
  anthropic: 'claude-sonnet-4-6',
  // gpt-oss-120b (OpenAI's open-weight model on Groq) grounds far better than
  // Llama 3.3 70b — sharp shipped/unshipped distinctions and faithful aggregates.
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
};

export interface ResolvedLlm {
  create: MessagesCreate;
  model: string;
  provider: Config['provider'];
}

/** The env var a provider's key comes from — for clear "set X" error messages. */
export const PROVIDER_ENV: Record<Config['provider'], string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/**
 * Build the LLM call for the configured provider, or null if its key is unset.
 * The key always comes from secrets (env), never config.
 */
export function resolveLlm(config: Config, secrets: Secrets): ResolvedLlm | null {
  const provider = config.provider;
  const model = config.model ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case 'anthropic': {
      if (!secrets.anthropicApiKey) return null;
      return { create: makeMessagesCreate(secrets.anthropicApiKey), model, provider };
    }
    case 'groq': {
      if (!secrets.groqApiKey) return null;
      const baseUrl = config.baseUrl ?? BASE_URLS.groq;
      return {
        create: makeOpenAICompatMessagesCreate({ apiKey: secrets.groqApiKey, baseUrl }),
        model,
        provider,
      };
    }
    case 'openai': {
      if (!secrets.openaiApiKey) return null;
      const baseUrl = config.baseUrl ?? BASE_URLS.openai;
      return {
        create: makeOpenAICompatMessagesCreate({ apiKey: secrets.openaiApiKey, baseUrl }),
        model,
        provider,
      };
    }
  }
}
