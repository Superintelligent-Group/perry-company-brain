<!-- Thanks for contributing to Inky 🐙 -->

## What & why

<!-- What does this change, and what problem does it solve? Link issues with "Closes #123". -->

## How it was tested

<!-- Commands you ran, new tests added, manual verification. -->

```
pnpm typecheck
pnpm test
```

## Checklist

- [ ] `pnpm typecheck` is clean
- [ ] `pnpm test` passes (new behavior has a test)
- [ ] No real org / contributor names, tokens, or webhook URLs in the diff (use `your-org`, `alice`/`bob`)
- [ ] Secrets stay in `.env` (gitignored) — nothing sensitive committed
- [ ] Docs updated if behavior or config changed (README / `docs/`)
- [ ] Core stays host-agnostic — trigger/delivery changes live in the adapter layer
