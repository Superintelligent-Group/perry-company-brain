import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMeetingSemanticsWithTogether,
  getExtractionBackend,
  getTogetherExtractionConfig,
} from "@extraction";
import { normalizeGranolaZapierPayload, sampleGranolaZapierPayload } from "@meetings";

test("builds Together extraction config from env with sensible defaults", () => {
  const config = getTogetherExtractionConfig({
    TOGETHER_API_KEY: "tok-123",
    PERRY_TOGETHER_EXTRACTION_MODEL: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    PERRY_TOGETHER_EXTRACTION_CONTEXT_CHARS: "32000",
    PERRY_TOGETHER_EXTRACTION_TEMPERATURE: "0.2",
  } as NodeJS.ProcessEnv);

  assert.equal(config.apiKey, "tok-123");
  assert.equal(config.model, "meta-llama/Llama-3.3-70B-Instruct-Turbo");
  assert.equal(config.maxContextChars, 32000);
  assert.equal(config.temperature, 0.2);
});

test("falls back to the default Together model when unset", () => {
  const config = getTogetherExtractionConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.model, "meta-llama/Llama-3.3-70B-Instruct-Turbo");
  assert.equal(config.apiKey, "");
});

test("extraction backend selector honors PERRY_EXTRACTION_BACKEND", () => {
  assert.equal(getExtractionBackend({ PERRY_EXTRACTION_BACKEND: "together" } as NodeJS.ProcessEnv), "together");
  assert.equal(getExtractionBackend({ PERRY_EXTRACTION_BACKEND: "TOGETHER" } as NodeJS.ProcessEnv), "together");
  assert.equal(getExtractionBackend({ PERRY_EXTRACTION_BACKEND: "lmstudio" } as NodeJS.ProcessEnv), "lmstudio");
  assert.equal(getExtractionBackend({} as NodeJS.ProcessEnv), "lmstudio");
});

test("Together extraction fails fast without an API key", async () => {
  const note = normalizeGranolaZapierPayload(sampleGranolaZapierPayload);
  await assert.rejects(
    () =>
      extractMeetingSemanticsWithTogether(note, {
        apiKey: "",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        maxContextChars: 24000,
        temperature: 0,
      }),
    /TOGETHER_API_KEY/u
  );
});
