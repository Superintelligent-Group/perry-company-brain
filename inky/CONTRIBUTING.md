# Contributing to Inky 🐙

Thanks for your interest in improving Inky! This is a small open-core project —
contributions, bug reports, and ideas are all welcome.

## Ground rules (the short version)

- **Tests and typecheck must stay green.** `pnpm test` and `pnpm typecheck` run in
  CI on every PR.
- **The core stays host-agnostic.** `collect → reconcile → summarize → render` is
  pure and testable; anything about *how it's triggered* or *where it posts* lives
  in the thin adapter layer (`worker.ts`, `bot.ts`, `discord.ts`, `cli.ts`).
- **No real identities or secrets in the diff.** Committed code, fixtures, and docs
  use placeholders (`your-org`, `alice`/`bob`/`carol`). Real org names, tokens, and
  webhook URLs live only in gitignored files (`.env`, `inky.config.json`).
- **Ground the AI.** Summaries must be derived from real activity, never invented —
  see the grounding discipline in `summarize.ts`. New report content follows the
  same rule: compute it mechanically, then let the model narrate from the figures.

## Getting set up

```bash
corepack enable            # provides the pinned pnpm version (see package.json)
pnpm install
cp .env.example .env        # add GITHUB_TOKEN — see docs/github-token-setup.md
cp inky.config.example.json inky.config.json   # set your org/repos
```

Node is pinned in `.node-version` (22) and pnpm via `packageManager` in
`package.json`. Run things in dev with `pnpm --silent dev <command>`:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm --silent dev standup --dry-run --days 1
GITHUB_TOKEN=$(gh auth token) pnpm --silent dev collect
```

`--dry-run` builds the standup and prints it without posting to Discord, so you can
develop against a real org with zero side effects. `--mechanical` skips the LLM
entirely (no API key needed).

## Development workflow

1. **Branch** off `main`.
2. **Write a test.** New behavior gets a `*.test.ts` next to the code. Tests use the
   built-in `node:test` runner and run with no network — the GitHub, LLM, and
   Discord layers are all injected, so unit tests pass a fake (`collect`,
   `MessagesCreate`, `fetch`, a fake `StandupInteraction`). Keep it that way.
3. **Run the checks** before pushing:
   ```bash
   pnpm typecheck
   pnpm test
   ```
4. **Open a PR** against `main`. Fill out the template; link any issue it closes.

## Code conventions

- **TypeScript, strict, ESM (NodeNext).** Match the surrounding style.
- **Config is data.** New knobs go through the config schema (validated with zod)
  and, where it makes sense, a matching CLI flag and `/standup` option — the CLI,
  worker, and slash command should expose the same capability.
- **Secrets only from env.** Never read a secret from config; add it to
  `.env.example` (with a placeholder) and resolve it from `process.env`.
- **Git hygiene:** stage explicit paths (`git add <path>`, not `git add -A`), and
  commit per logical change. Don't add co-author trailers.

## What's most wanted

The [roadmap](docs/planning/roadmap-and-phase-6.md) lays out three tracks. Especially
welcome right now:

- **Roadmap sources** beyond GitHub Milestones — a config/`ROADMAP.md`-declared
  roadmap, GitHub Projects v2, Linear/Notion (the `reconcile()` `source` enum already
  leaves room).
- **Delivery adapters** — Slack alongside Discord (same core, a second delivery layer).
- **Report depth** — week-over-week trends on the stats panel.
- **Docs & onboarding** polish — anything that lowers the friction to self-host.

If you're planning something substantial, open an issue or a Discussion first so we
can align on the approach before you build.

## Reporting bugs & security issues

- **Bugs / features:** use the issue templates. Redact tokens, webhook URLs, and any
  private repo content.
- **Security vulnerabilities:** please report privately via
  [a security advisory](https://github.com/Doppel-Labs/inky/security/advisories/new)
  rather than a public issue.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
