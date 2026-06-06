/**
 * LOC noise filtering. Lockfiles, generated code, virtual environments, caches,
 * and build artifacts inflate line counts without representing real engineering
 * effort. For a narrative standup this matters less than for metrics, but
 * "+22k lines" from a regenerated `api.d.ts` or `+13k` from a lockfile is
 * actively misleading, so we exclude these paths from line totals. Commit/PR
 * counts are never affected — only LOC.
 *
 * Goal: work across frameworks out of the box (we lean TS — Next/Vite/React —
 * and Python — venv/pyenv/uv — but aim to cover the common ecosystems). Repos
 * can extend this via `extraNoisePatterns` in config without a code change.
 *
 * Lineage: started from team-perf's GENERATED_PATH_PATTERNS, broadened here.
 */
import picomatch from 'picomatch';

/** Paths excluded from LOC counts by default, grouped by ecosystem. */
export const DEFAULT_NOISE_PATTERNS: string[] = [
  // --- Package-manager lockfiles (JS/TS, Rust, Python, Ruby, PHP, Go) ---
  '**/*-lock.yaml',
  '**/*-lock.json',
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/bun.lockb',
  '**/deno.lock',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/uv.lock',
  '**/Pipfile.lock',
  '**/pdm.lock',
  '**/Gemfile.lock',
  '**/composer.lock',
  '**/go.sum',

  // --- Generated code ---
  '**/__generated__/**',
  '**/generated/**',
  '**/.generated/**',
  '**/*.generated.*',
  '**/*.gen.*',
  '**/*.pb.go',
  '**/*.pb.ts',
  '**/*_pb.py',
  '**/*_pb2.py',
  '**/*_pb2.pyi',
  '**/schema.graphql',
  '**/schema.gql',

  // --- Minified / bundled / source-map artifacts ---
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  '**/*.chunk.js',
  '**/*.map',
  '**/*.tsbuildinfo',

  // --- JS/TS build output & framework caches (Next, Vite, etc.) ---
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.astro/**',
  '**/.vite/**',
  '**/.turbo/**',
  '**/.parcel-cache/**',
  '**/.cache/**',
  '**/.vercel/**',
  '**/.netlify/**',
  '**/storybook-static/**',
  '**/.yarn/**',
  '**/.pnpm-store/**',
  '**/.eslintcache',

  // --- Python: virtual envs, caches, build, compiled ---
  '**/.venv/**',
  '**/venv/**',
  '**/virtualenv/**',
  '**/site-packages/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.pyd',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
  '**/.tox/**',
  '**/.nox/**',
  '**/*.egg-info/**',
  '**/.eggs/**',
  '**/.ipynb_checkpoints/**',

  // --- Test coverage output ---
  '**/coverage/**',
  '**/htmlcov/**',
  '**/.coverage',
  '**/__snapshots__/**',
  '**/*.snap',

  // --- Other ecosystems' build dirs (Rust/JVM/iOS/Terraform) ---
  '**/target/**',
  '**/.gradle/**',
  '**/Pods/**',
  '**/.terraform/**',

  // --- Vendored libraries ---
  '**/vendor/**',
  '**/third_party/**',
  '**/node_modules/**',

  // --- Archived / reference content ---
  '**/_archive/**',
  '**/archive/**',
  '**/.archive/**',
];

/** A predicate that returns true for noise paths excluded from LOC counts. */
export type NoiseMatcher = (path: string) => boolean;

/**
 * Build a noise matcher from the defaults plus any repo-specific extra patterns.
 * Patterns use glob syntax (picomatch); `dot: true` so dot-dirs (.next, .venv)
 * and dotfiles (.coverage) match.
 */
export function createNoiseMatcher(extraPatterns: string[] = []): NoiseMatcher {
  const isMatch = picomatch([...DEFAULT_NOISE_PATTERNS, ...extraPatterns], { dot: true });
  return (path: string) => isMatch(path);
}

/** Default matcher (no extra patterns). */
export const isGeneratedPath: NoiseMatcher = createNoiseMatcher();

/** A per-file churn record, as returned by the GitHub commit/PR file APIs. */
export interface FileChurn {
  filename: string;
  additions: number;
  deletions: number;
}

/** Sum additions/deletions across files, skipping noise paths. */
export function sumRealChurn(
  files: FileChurn[],
  isNoise: NoiseMatcher = isGeneratedPath,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    if (isNoise(f.filename)) continue;
    additions += f.additions ?? 0;
    deletions += f.deletions ?? 0;
  }
  return { additions, deletions };
}
