const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const strict = process.argv.includes("--strict");
const baseUrl = (process.env.LMSTUDIO_BASE_URL ?? process.env.GRAPHITI_OPENAI_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/u, "");
const apiKey = process.env.LMSTUDIO_API_KEY ?? process.env.GRAPHITI_OPENAI_API_KEY ?? "lm-studio";
const models = (process.env.PERRY_LMSTUDIO_EVAL_MODELS ?? process.env.PERRY_LMSTUDIO_EXTRACTION_MODEL ?? process.env.GRAPHITI_LLM_MODEL ?? "local-model")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const temperature = Number(process.env.PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE ?? 0);
const maxContextChars = Math.max(Number(process.env.PERRY_LMSTUDIO_EXTRACTION_CONTEXT_CHARS ?? 24000), 2000);
const cases = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "lmstudio-extraction-eval.json"), "utf8"));

async function main() {
  const results = [];
  for (const model of models) {
    for (const fixture of cases) {
      results.push(await evaluateCase(model, fixture));
    }
  }

  for (const result of results) {
    const label = result.ok ? "PASS" : "FAIL";
    console.log(`${label} ${result.model} ${result.id}: score=${result.score.toFixed(2)} ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0 && strict) process.exit(1);
}

async function evaluateCase(model, fixture) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        response_format: responseFormat(),
        messages: [
          {
            role: "system",
            content:
              "Extract company-brain objects from a meeting. Return only valid JSON with decisions, actionItems, entities, and confidence. Preserve each Decisions bullet as a separate decision and each Action items bullet as a separate action item. Extract explicit repository names like owner/repo, explicit customer names, project names, policies, channels, and data sources.",
          },
          { role: "user", content: promptFor(fixture).slice(0, maxContextChars) },
        ],
      }),
    });
    const text = await response.text();
    const elapsed = performance.now() - started;
    if (!response.ok) return { model, id: fixture.id, ok: false, score: 0, detail: `${response.status} ${text.slice(0, 160)}` };
    const payload = JSON.parse(text);
    const content = payload.choices?.[0]?.message?.content ?? "";
    const extracted = JSON.parse(extractJson(content));
    const score = scoreExtraction(extracted, fixture.expected);
    return { model, id: fixture.id, ok: score >= 0.75, score, detail: `${elapsed.toFixed(1)}ms` };
  } catch (error) {
    return { model, id: fixture.id, ok: false, score: 0, detail: error instanceof Error ? error.message : String(error) };
  }
}

function responseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "perry_local_semantic_extraction",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
          actionItems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                owner: { type: "string" },
                dueDate: { type: "string" },
              },
              required: ["text"],
            },
          },
          entities: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["person", "project", "repository", "customer", "policy", "channel", "data_source"] },
                name: { type: "string" },
                stableKey: { type: "string" },
              },
              required: ["type", "name"],
            },
          },
          confidence: { type: "number" },
        },
        required: ["decisions", "actionItems", "entities", "confidence"],
      },
    },
  };
}

function promptFor(fixture) {
  return [
    `Title: ${fixture.title}`,
    `Calendar: ${fixture.calendarTitle}`,
    `Folder: ${fixture.folderName}`,
    `Started: ${fixture.startedAt}`,
    `Attendees: ${fixture.attendees.map((attendee) => attendee.name).join(", ")}`,
    "Summary:",
    fixture.summaryMarkdown,
  ].join("\n");
}

function scoreExtraction(extracted, expected) {
  const decisions = (extracted.decisions ?? []).map((item) => item.text ?? "").join("\n").toLowerCase();
  const actions = (extracted.actionItems ?? []).map((item) => item.text ?? "").join("\n").toLowerCase();
  const entities = (extracted.entities ?? []).map((item) => `${item.name ?? ""} ${item.stableKey ?? ""}`).join("\n").toLowerCase();
  const checks = [
    ...expected.decisionKeywords.map((keyword) => decisions.includes(keyword.toLowerCase())),
    ...expected.actionKeywords.map((keyword) => actions.includes(keyword.toLowerCase())),
    ...expected.entityKeywords.map((keyword) => entities.includes(keyword.toLowerCase())),
  ];
  if (checks.length === 0) return 1;
  return checks.filter(Boolean).length / checks.length;
}

function extractJson(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("response did not contain a JSON object");
  return trimmed.slice(start, end + 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
