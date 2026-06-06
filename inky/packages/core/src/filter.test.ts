import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoiseMatcher, isGeneratedPath, sumRealChurn } from './filter.js';

test('flags lockfiles across ecosystems at any depth', () => {
  for (const p of [
    'pnpm-lock.yaml',
    'package-lock.json',
    'apps/web/yarn.lock',
    'frontend/bun.lock', // the real miss the live audit surfaced
    'bun.lockb',
    'deno.lock',
    'go.sum',
    'crates/core/Cargo.lock',
    'backend/uv.lock',
    'poetry.lock',
    'Pipfile.lock',
  ]) {
    assert.ok(isGeneratedPath(p), `expected noise: ${p}`);
  }
});

test('flags generated code and source maps', () => {
  for (const p of [
    'frontend/src/lib/generated/api.d.ts', // the 22k-churn file from the live audit
    'src/__generated__/types.ts',
    'proto/foo.pb.go',
    'api/client.gen.ts',
    'src/routes.generated.tsx',
    'web/app.min.js',
    'web/app.js.map',
    'tsconfig.tsbuildinfo',
  ]) {
    assert.ok(isGeneratedPath(p), `expected noise: ${p}`);
  }
});

test('flags JS/TS build output and framework caches', () => {
  for (const p of [
    'dist/index.js',
    'apps/web/.next/static/chunk.js',
    'web/.vite/deps/dep.js',
    '.turbo/cache/x',
    'packages/ui/storybook-static/main.js',
    'coverage/lcov.info',
  ]) {
    assert.ok(isGeneratedPath(p), `expected noise: ${p}`);
  }
});

test('flags Python venvs, caches, and compiled artifacts', () => {
  for (const p of [
    '.venv/lib/python3.12/site-packages/foo.py',
    'backend/venv/bin/activate',
    'app/__pycache__/module.cpython-312.pyc',
    'app/services/module.pyc',
    '.mypy_cache/3.12/foo.json',
    '.ruff_cache/x',
    'proto/foo_pb2.py',
    'src/app.egg-info/PKG-INFO',
    'htmlcov/index.html',
  ]) {
    assert.ok(isGeneratedPath(p), `expected noise: ${p}`);
  }
});

test('leaves real source — including migrations — alone', () => {
  for (const p of [
    'src/index.ts',
    'backend/app/services/citation_extraction.py',
    'frontend/src/pages/library/Library.tsx',
    'supabase/migrations/0001_add_users.sql', // migrations are real work, kept
    'README.md',
    'packages/core/src/compile.ts',
  ]) {
    assert.equal(isGeneratedPath(p), false, `expected real: ${p}`);
  }
});

test('over-matches a "build/" dir anywhere (known, documented tradeoff)', () => {
  assert.ok(isGeneratedPath('packages/core/src/build/compile.ts'));
});

test('extraNoisePatterns extends the defaults without losing them', () => {
  const isNoise = createNoiseMatcher(['db/seed/**', '**/*.snapshot']);
  assert.ok(isNoise('db/seed/data.sql')); // custom
  assert.ok(isNoise('tests/foo.snapshot')); // custom
  assert.ok(isNoise('pnpm-lock.yaml')); // default still applies
  assert.equal(isNoise('src/app.ts'), false);
});

test('sumRealChurn excludes noise but counts source', () => {
  const churn = sumRealChurn([
    { filename: 'src/app.ts', additions: 100, deletions: 10 },
    { filename: 'pnpm-lock.yaml', additions: 5000, deletions: 4000 },
    { filename: 'frontend/bun.lock', additions: 2461, deletions: 42 },
    { filename: 'src/util.ts', additions: 20, deletions: 5 },
    { filename: 'frontend/src/lib/generated/api.d.ts', additions: 15238, deletions: 7348 },
  ]);
  assert.deepEqual(churn, { additions: 120, deletions: 15 });
});

test('sumRealChurn honors a custom matcher', () => {
  const isNoise = createNoiseMatcher(['data/**']);
  const churn = sumRealChurn(
    [
      { filename: 'data/big.json', additions: 9000, deletions: 0 },
      { filename: 'src/app.ts', additions: 50, deletions: 5 },
    ],
    isNoise,
  );
  assert.deepEqual(churn, { additions: 50, deletions: 5 });
});
