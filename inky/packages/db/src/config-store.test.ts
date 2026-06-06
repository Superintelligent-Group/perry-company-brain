import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from '@inky/core/config';
import { assembleConfig, disassembleConfig } from './config-store.js';

// The Phase 6 exit criterion: a Config round-tripped through the DB decomposition
// equals the file-sourced Config. We assert assemble(disassemble(c)) === c for the
// same validated Config the file loader would produce.

test('round-trips a minimal config (defaults applied) unchanged', () => {
  const config = ConfigSchema.parse({ org: 'your-org' });
  assert.deepEqual(assembleConfig(disassembleConfig(config)), config);
});

test('round-trips a rich config (nested schedule/roadmap/aliases/installation/webhook) unchanged', () => {
  const config = ConfigSchema.parse({
    org: 'your-org',
    repos: ['api', 'web'],
    staleDays: 'auto',
    windowHours: 168,
    excludePeople: ['alice'],
    extraNoisePatterns: ['db/seed/**'],
    aliases: { alice: ['alice-work', 'alice@example.com'], bob: ['bob-bot'] },
    github: { appId: '123456', installationId: 78901234 },
    discord: {
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
      applicationId: '999',
      guildId: '888',
      channelId: '777',
    },
    schedule: {
      timezone: 'America/Los_Angeles',
      jobs: [
        { cron: '0 9 * * 1-5', windowHours: 24, label: 'daily' },
        { cron: '0 8 * * 1', windowHours: 168, label: 'weekly' },
      ],
    },
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    stats: 'on',
    trends: 'on',
    statsPerPerson: false,
    format: 'prose',
    roadmap: { enabled: true, source: 'roadmap-md', path: 'docs/ROADMAP.md', repo: 'web', atRiskDays: 14 },
  });
  assert.deepEqual(assembleConfig(disassembleConfig(config)), config);
});

test('disassemble routes each field to exactly one part (org/github/discord/settings)', () => {
  const config = ConfigSchema.parse({
    org: 'your-org',
    github: { appId: '123', installationId: 456 },
    discord: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' },
  });
  const parts = disassembleConfig(config);
  assert.equal(parts.org, 'your-org');
  assert.deepEqual(parts.github, { appId: '123', installationId: 456 });
  assert.deepEqual(parts.discord, { webhookUrl: 'https://discord.com/api/webhooks/1/abc' });
  // The org/github/discord keys must NOT leak into the settings blob.
  assert.ok(!('org' in parts.settings));
  assert.ok(!('github' in parts.settings));
  assert.ok(!('discord' in parts.settings));
  // A representative settings field IS present.
  assert.equal(parts.settings.windowHours, 24);
});

test('assemble validates through ConfigSchema — a bad settings blob is rejected', () => {
  assert.throws(
    () =>
      assembleConfig({
        org: 'your-org',
        github: {},
        discord: {},
        // windowHours must be a positive int; -5 is invalid.
        settings: { windowHours: -5 } as never,
      }),
    /windowHours|positive|greater/i,
  );
});
