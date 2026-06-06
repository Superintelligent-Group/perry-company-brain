#!/usr/bin/env node
// Live smoke test for the Together.ai extraction backend. Reads TOGETHER_API_KEY
// from .env, runs a real extraction over the sample Granola payload, and prints
// the structured result. Requires `pnpm build` first (uses compiled dist/).
const path = require("node:path");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // .env is optional — env vars may already be present in the shell.
}

const { extractMeetingSemanticsWithTogether, getTogetherExtractionConfig } = require("../dist/extraction/together.js");
const { normalizeGranolaZapierPayload, sampleGranolaZapierPayload } = require("../dist/meetings/index.js");

async function main() {
  const config = getTogetherExtractionConfig();
  if (!config.apiKey) {
    console.error("TOGETHER_API_KEY is not set (add it to .env). Aborting.");
    process.exit(1);
  }
  console.log(`Extracting with Together model: ${config.model}`);
  const note = normalizeGranolaZapierPayload(sampleGranolaZapierPayload);
  const started = Date.now();
  const result = await extractMeetingSemanticsWithTogether(note, config);
  console.log(`Done in ${Date.now() - started}ms`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Together smoke failed:", err?.message ?? err);
  process.exit(1);
});
