import assert from "node:assert/strict";
import test from "node:test";
import { getLmStudioExtractionConfig, parseLocalSemanticExtraction } from "@extraction";

test("validates local semantic extraction JSON from LM Studio", () => {
  const parsed = parseLocalSemanticExtraction(
    `Here is JSON: {"decisions":[{"text":"Ship the graph replay diff."}],"actionItems":[{"text":"Add gauntlet","owner":"Ada"}],"entities":[{"type":"repository","name":"perry-discord-bot"}],"confidence":0.91}`
  );

  assert.equal(parsed.decisions[0].text, "Ship the graph replay diff.");
  assert.equal(parsed.actionItems[0].owner, "Ada");
  assert.equal(parsed.entities[0].type, "repository");
  assert.equal(parsed.confidence, 0.91);
});

test("builds conservative LM Studio extraction config from env", () => {
  const config = getLmStudioExtractionConfig({
    LMSTUDIO_BASE_URL: "http://localhost:1234/v1/",
    PERRY_LMSTUDIO_EXTRACTION_MODEL: "gemma-4-local",
    PERRY_LMSTUDIO_EXTRACTION_CONTEXT_CHARS: "32000",
  } as NodeJS.ProcessEnv);

  assert.equal(config.baseUrl, "http://localhost:1234/v1");
  assert.equal(config.model, "gemma-4-local");
  assert.equal(config.maxContextChars, 32000);
});
