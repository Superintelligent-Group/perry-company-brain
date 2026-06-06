import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlm, PROVIDER_ENV } from './llm.js';
import type { Config, Secrets } from './config.js';

function config(over: Partial<Config> = {}): Config {
  return {
    org: 'Acme',
    repos: [],
    windowHours: 24,
    excludeBots: true,
    extraNoisePatterns: [],
    aliases: {},
    discord: {},
    provider: 'anthropic',
    model: undefined,
    baseUrl: undefined,
    ...over,
  } as Config;
}

const onlyGithub: Secrets = { githubToken: 't' };

test('resolves anthropic with its default model when keyed', () => {
  const llm = resolveLlm(config({ provider: 'anthropic' }), {
    ...onlyGithub,
    anthropicApiKey: 'a',
  });
  assert.ok(llm);
  assert.equal(llm!.provider, 'anthropic');
  assert.equal(llm!.model, 'claude-sonnet-4-6');
});

test('resolves groq with its default model when keyed', () => {
  const llm = resolveLlm(config({ provider: 'groq' }), { ...onlyGithub, groqApiKey: 'g' });
  assert.ok(llm);
  assert.equal(llm!.provider, 'groq');
  assert.equal(llm!.model, 'openai/gpt-oss-120b');
});

test('config.model overrides the per-provider default', () => {
  const llm = resolveLlm(config({ provider: 'groq', model: 'mixtral-8x7b' }), {
    ...onlyGithub,
    groqApiKey: 'g',
  });
  assert.equal(llm!.model, 'mixtral-8x7b');
});

test('returns null when the chosen provider has no key', () => {
  assert.equal(resolveLlm(config({ provider: 'anthropic' }), onlyGithub), null);
  assert.equal(resolveLlm(config({ provider: 'groq' }), { ...onlyGithub, anthropicApiKey: 'a' }), null);
});

test('PROVIDER_ENV names the env var per provider', () => {
  assert.equal(PROVIDER_ENV.anthropic, 'ANTHROPIC_API_KEY');
  assert.equal(PROVIDER_ENV.groq, 'GROQ_API_KEY');
  assert.equal(PROVIDER_ENV.openai, 'OPENAI_API_KEY');
});
