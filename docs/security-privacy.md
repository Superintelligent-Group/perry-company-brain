# Security And Privacy Notes

Perry handles meeting-derived operational memory. The safe default is to move structured, bounded objects across tools, not raw transcript context.

## Discord

- `/brain` commands are open only when no Discord admin roles are configured.
- Configure `DISCORD_ADMIN_ROLE_IDS` or admin role ids in `data/perry.config.json` before using `/brain` in a real guild.
- Brain replies are ephemeral to reduce channel noise and accidental broad disclosure.
- Route public summaries to project channels; keep raw source notes and private notes outside Discord posts.

## Notion

- Use `PERRY_NOTION_DRY_RUN=true` for schema and write-contract testing.
- Keep decisions, action items, projects, and meeting notes in separate data sources so permissions and views can differ.
- Do not write transcript bodies by default. Meeting pages should link to source evidence and bounded summaries.

## Graph Memory

- Graph change sets should contain stable keys, relation assertions, retirements, and bounded evidence excerpts.
- Replay diff is the production trust check: posted entities, relations, retirements, and evidence must be readable after write.
- Graphiti group ids are tenant/data-boundary controls. Do not reuse one group id across unrelated companies.

## LM Studio

- Prefer deterministic extraction settings for automation: temperature `0`, explicit JSON response format, bounded prompt length.
- Evaluate models on fixed fixtures before trusting a new local model for automation.
- Use the model to propose structured objects; keep final writes behind schema validation and replay/readback checks.

## Secrets

Required production-like secrets are environment variables, not committed files:

- `DISCORD_TOKEN`
- `NOTION_TOKEN`
- `ADMIN_API_TOKEN`
- `GRANOLA_WEBHOOK_TOKEN`
- `LMSTUDIO_API_KEY` if your local server requires it

Rotate a token after sharing logs, screenshots, or config files that may have included it.
