const { spawnSync } = require("node:child_process");

const env = {
  ...process.env,
  LMSTUDIO_BASE_URL: process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
  LMSTUDIO_API_KEY: process.env.LMSTUDIO_API_KEY ?? "lm-studio",
  PERRY_LMSTUDIO_EVAL_MODELS: process.env.PERRY_LMSTUDIO_EVAL_MODELS ?? "gemma-4-e4b-claude-abliterated",
  PERRY_LMSTUDIO_EXTRACTION_MODEL: process.env.PERRY_LMSTUDIO_EXTRACTION_MODEL ?? "gemma-4-e4b-claude-abliterated",
  PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE: process.env.PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE ?? "0",
  PERRY_GRAPHITI_ENABLED: process.env.PERRY_GRAPHITI_ENABLED ?? "true",
  PERRY_GRAPHITI_BRIDGE_URL: process.env.PERRY_GRAPHITI_BRIDGE_URL ?? "http://127.0.0.1:8791",
  PERRY_GRAPHITI_GROUP_ID: process.env.PERRY_GRAPHITI_GROUP_ID ?? "doppel-labs",
  PERRY_GRAPHITI_TIMEOUT_MS: process.env.PERRY_GRAPHITI_TIMEOUT_MS ?? "120000",
  PERRY_GRAPHITI_DIRECT_CHANGESETS: process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS ?? "true",
  PERRY_ADMIN_URL: process.env.PERRY_ADMIN_URL ?? "http://127.0.0.1:8792",
  PERRY_DB_PATH: process.env.PERRY_DB_PATH ?? ":memory:",
  PERRY_SQLITE_JOURNAL_MODE: process.env.PERRY_SQLITE_JOURNAL_MODE ?? "MEMORY",
  PERRY_DEFAULT_PUBLISH_MODE: process.env.PERRY_DEFAULT_PUBLISH_MODE ?? "auto",
  PERRY_DISCORD_DRY_RUN: process.env.PERRY_DISCORD_DRY_RUN ?? "true",
  PERRY_NOTION_DRY_RUN: process.env.PERRY_NOTION_DRY_RUN ?? "true",
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  await checkJson("graphiti health", `${env.PERRY_GRAPHITI_BRIDGE_URL}/health`, (payload) => payload.ok === true);
  await checkJson("graphiti llm health", `${env.PERRY_GRAPHITI_BRIDGE_URL}/llm/health`, (payload) => payload.ok === true && payload.modelAvailable === true && payload.embeddingModelAvailable === true);
  await checkJson("lmstudio models", `${env.LMSTUDIO_BASE_URL}/models`, (payload) => Array.isArray(payload.data) && payload.data.some((model) => model.id === env.PERRY_LMSTUDIO_EXTRACTION_MODEL), {
    authorization: `Bearer ${env.LMSTUDIO_API_KEY}`,
  });

  run("lmstudio eval", ["scripts/lmstudio-extraction-evaluate.cjs"]);
  run("company brain graph gauntlet", ["scripts/company-brain-gauntlet.cjs", "--note-id", `brain-acceptance-${Date.now()}`, "--force", "true", "--drain", "1", "--replay", "true"]);
  run("live local brain gauntlet", ["scripts/local-brain-gauntlet.cjs", "--strict"]);

  console.log(`PASS brain acceptance: ${(performance.now() - started).toFixed(1)}ms`);
}

async function checkJson(name, url, validate, headers = {}) {
  const started = performance.now();
  const response = await fetch(url, { headers: { accept: "application/json", ...headers } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${text.slice(0, 300)}`);
  const payload = text ? JSON.parse(text) : undefined;
  if (!validate(payload)) throw new Error(`${name} semantic check failed: ${JSON.stringify(payload).slice(0, 500)}`);
  console.log(`PASS ${name}: ${response.status} in ${(performance.now() - started).toFixed(1)}ms`);
}

function run(name, args) {
  console.log(`RUN ${name}: node ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status}`);
}
