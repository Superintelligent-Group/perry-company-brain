const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const args = parseArgs(process.argv.slice(2));
const count = Math.max(1, Number(args.count || 25));
const batchSize = Math.max(1, Math.min(Number(args.batch || 5), 10));
const seed = Number(args.seed || 73);
const mode = args.mode || "lmstudio-tools";
const outPath = args.out || join("tests", "fixtures", "generated-company-scenarios.json");
const baseUrl = (process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/u, "");
const apiKey = process.env.LMSTUDIO_API_KEY ?? "lm-studio";
const model = args.model || process.env.PERRY_LMSTUDIO_EXTRACTION_MODEL || "gemma-4-e4b-claude-abliterated";

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const started = performance.now();
  const scenarios = [];
  const fallbacks = [];
  const seenIds = new Map();
  for (let offset = 0; offset < count; offset += batchSize) {
    const size = Math.min(batchSize, count - offset);
    const generated = mode === "deterministic" ? deterministicBatch(offset, size) : mode === "lmstudio-tools" ? await safeLmStudioToolBatch(offset, size, fallbacks) : await safeLmStudioBatch(offset, size, fallbacks);
    const filled = fillShortBatch(generated, offset, size);
    scenarios.push(...filled.map((scenario, index) => uniquifyScenario(normalizeScenario(scenario, offset + index), seenIds)));
    console.log(`generated ${Math.min(scenarios.length, count)}/${count}`);
  }

  const corpus = scenarios.slice(0, count);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, outPath, count: corpus.length, mode, model, fallbacks, elapsedMs: Math.round((performance.now() - started) * 100) / 100 }, null, 2));
}

async function safeLmStudioBatch(offset, size, fallbacks) {
  try {
    return await lmStudioBatch(offset, size);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fallbacks.push({ offset, size, message });
    console.warn(`WARN scenario generation batch ${offset}-${offset + size - 1} fell back: ${message}`);
    return deterministicBatch(offset, size);
  }
}

async function safeLmStudioToolBatch(offset, size, fallbacks) {
  try {
    return await lmStudioToolBatch(offset, size);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fallbacks.push({ offset, size, mode: "lmstudio-tools", message });
    console.warn(`WARN scenario tool generation batch ${offset}-${offset + size - 1} fell back: ${message}`);
    return deterministicBatch(offset, size);
  }
}

async function lmStudioToolBatch(offset, size) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: Number(args.temperature ?? 0.55),
      response_format: toolResponseFormat(),
      messages: [
        {
          role: "system",
          content: "You generate synthetic Perry company-brain data by emitting operations against a constrained scenario object. Return only JSON. Never include real secrets, real customer data, or private personal data.",
        },
        {
          role: "user",
          content: toolPrompt(offset, size),
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LM Studio scenario tool generation failed: ${response.status} ${text}`);
  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LM Studio scenario tool generation returned empty content");
  const parsed = JSON.parse(extractJson(content));
  if (!Array.isArray(parsed.operations)) throw new Error("LM Studio scenario tool generation returned no operations array");
  return buildScenariosFromOperations(parsed.operations, offset, size);
}
async function lmStudioBatch(offset, size) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: Number(args.temperature ?? 0.7),
      response_format: responseFormat(),
      messages: [
        {
          role: "system",
          content: "Generate realistic but synthetic Doppel Labs meeting scenarios for Perry company-brain evaluation. Return only JSON. Make every scenario internally consistent and safe: no real secrets, no real customer data, no private personal data. Use the exact meeting-note summary format requested by the user message.",
        },
        {
          role: "user",
          content: prompt(offset, size),
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LM Studio scenario generation failed: ${response.status} ${text}`);
  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LM Studio scenario generation returned empty content");
  const parsed = JSON.parse(extractJson(content));
  if (!Array.isArray(parsed.scenarios)) throw new Error("LM Studio scenario generation returned no scenarios array");
  return parsed.scenarios;
}

function prompt(offset, size) {
  return `Create ${size} synthetic meeting scenarios starting at index ${offset}.\n\nUse this company context:\n- Company: Doppel Labs\n- Products/projects: Perry, Wallace, Notion Wiki, Discord Ops, Graph Memory, Atlas\n- People: Ada, Ben, Mira, Perry, Iris, Kai, Jules, Sam\n- Customers/accounts: Acme, Northstar, Helio, Meridian, ExampleCo\n- Repositories: doppel-labs/perry-discord-bot, doppel-labs/wallace-webapp, doppel-labs/graph-memory, doppel-labs/notion-wiki\n- Policies: SOC2 Evidence Retention, Incident Review, Customer Escalation, Private Notes\n\nCreate a varied corpus with: planning, architecture reviews, customer escalations, incident reviews, sales/product feedback, pivots, conflicting decisions, missing owners, overdue actions, duplicate-like titles, and adversarial generic phrases.\n\nFor each scenario, provide exact expected decisions/actions/search checks copied from the summary text. Summaries must follow this format exactly:\nDecisions:\n- ...\n- ...\n\nAction items:\n- Ada: ...\n- Ben: ...\n\nDo not write "Owner:" inside action bullets. Every action bullet must be "- Person: task". Expected decisions/actions/search checks must be copied from the summary text. Include privateNotes and transcript containing markers that must not leak: PRIVATE_SYNTHETIC_MARKER and TRANSCRIPT_SYNTHETIC_MARKER. Also include expectedPrivacyMarkers with those two strings.\n\nMake ids stable and unique.`;
}

function toolPrompt(offset, size) {
  return `Create ${size} synthetic meeting scenarios starting at index ${offset} by emitting ordered operations.

The available abstract tools are:
- create_meeting: start or update a scenario with title, folderName, project, customer, and attendees.
- add_decision: append one concrete decision copied into the final summary.
- add_action: append one owner/task pair copied into the final summary.
- add_private_note: append private note text. Must include PRIVATE_SYNTHETIC_MARKER.
- add_transcript_excerpt: append transcript text. Must include TRANSCRIPT_SYNTHETIC_MARKER.
- add_search_check: add a retrieval check where mustContain appears in the final summary.
- add_edge_case: describe a pivot, conflict, duplicate-like title, missing owner, overdue action, customer escalation, or incident nuance.

Use this company world object:
- Company: Doppel Labs
- Products/projects: Perry, Wallace, Notion Wiki, Discord Ops, Graph Memory, Atlas
- People: Ada, Ben, Mira, Perry, Iris, Kai, Jules, Sam
- Customers/accounts: Acme, Northstar, Helio, Meridian, ExampleCo
- Repositories: doppel-labs/perry-discord-bot, doppel-labs/wallace-webapp, doppel-labs/graph-memory, doppel-labs/notion-wiki
- Policies: SOC2 Evidence Retention, Incident Review, Customer Escalation, Private Notes

For each scenario index 0..${size - 1}, emit at least: one create_meeting, two add_decision operations, two add_action operations, one add_private_note, one add_transcript_excerpt, and one add_search_check. Do not use real secrets or real customer data. Action owners must be person names like Ada or Ben, not "Owner".`;
}

function toolResponseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "perry_scenario_operations",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          operations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["create_meeting", "add_decision", "add_action", "add_private_note", "add_transcript_excerpt", "add_search_check", "add_edge_case"] },
                scenarioIndex: { type: "number" },
                title: { type: "string" },
                folderName: { type: "string" },
                project: { type: "string" },
                customer: { type: "string" },
                attendees: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, email: { type: "string" } }, required: ["name", "email"] } },
                text: { type: "string" },
                owner: { type: "string" },
                query: { type: "string" },
                mustContain: { type: "string" },
                tag: { type: "string" }
              },
              required: ["op", "scenarioIndex"]
            }
          }
        },
        required: ["operations"]
      }
    }
  };
}

function buildScenariosFromOperations(operations, offset, size) {
  const drafts = Array.from({ length: size }, (_, index) => defaultDraft(offset + index));
  for (const operation of operations) {
    const draft = drafts[coerceScenarioIndex(operation?.scenarioIndex, size)];
    if (!draft) continue;
    applyOperation(draft, operation);
  }
  return drafts.map((draft, index) => finalizeDraft(draft, offset + index));
}

function defaultDraft(index) {
  const projects = ["Perry", "Wallace", "Notion Wiki", "Discord Ops", "Graph Memory", "Atlas"];
  const customers = ["Acme", "Northstar", "Helio", "Meridian", "ExampleCo"];
  const project = projects[(seed + index) % projects.length];
  const customer = customers[(seed + index * 2) % customers.length];
  return {
    id: `tool-${slug(project)}-${index + 1}`,
    title: `${project} Synthetic Company Brain Scenario ${index + 1}`,
    folderName: project,
    project,
    customer,
    startedAt: new Date(Date.UTC(2026, 4, 25, 14, index % 60, 0)).toISOString(),
    attendees: defaultAttendees(index),
    decisions: [],
    actions: [],
    search: [],
    privateNotes: `PRIVATE_SYNTHETIC_MARKER ${project} private synthetic note for ${customer}.`,
    transcript: `TRANSCRIPT_SYNTHETIC_MARKER ${project} synthetic transcript for ${customer}.`,
    edgeCases: [],
  };
}

function applyOperation(draft, operation) {
  const op = String(operation?.op || "");
  if (op === "create_meeting") {
    draft.title = cleanText(operation.title) || draft.title;
    draft.folderName = cleanText(operation.folderName || operation.project) || draft.folderName;
    draft.project = cleanText(operation.project) || draft.project;
    draft.customer = cleanText(operation.customer) || draft.customer;
    draft.attendees = normalizeAttendees(operation.attendees, draft.attendees);
    draft.id = slug(`${draft.folderName}-${draft.title}`) || draft.id;
    return;
  }
  if (op === "add_decision" && isUsableExpectedText(operation.text)) draft.decisions.push(cleanText(operation.text));
  if (op === "add_action" && isUsableExpectedText(operation.text)) draft.actions.push({ owner: cleanOwner(operation.owner), text: cleanText(operation.text) });
  if (op === "add_private_note" && isUsableExpectedText(operation.text)) draft.privateNotes = withMarker(cleanText(operation.text), "PRIVATE_SYNTHETIC_MARKER");
  if (op === "add_transcript_excerpt" && isUsableExpectedText(operation.text)) draft.transcript = withMarker(cleanText(operation.text), "TRANSCRIPT_SYNTHETIC_MARKER");
  if (op === "add_search_check" && isUsableExpectedText(operation.query) && isUsableExpectedText(operation.mustContain)) draft.search.push({ query: cleanText(operation.query), mustContain: cleanText(operation.mustContain) });
  if (op === "add_edge_case" && isUsableExpectedText(operation.text)) draft.edgeCases.push(`${cleanText(operation.tag || "edge")}: ${cleanText(operation.text)}`);
}

function finalizeDraft(draft, index) {
  while (draft.decisions.length < 2) {
    draft.decisions.push(`${ownerForIndex(index + draft.decisions.length)} owns ${draft.project} follow-through for customer ${draft.customer}.`);
  }
  while (draft.actions.length < 2) {
    const owner = ownerForIndex(index + draft.actions.length + 2);
    draft.actions.push({ owner, text: `Review ${draft.project} documentation quality for ${draft.customer}.` });
  }
  const summary = `Decisions:\n${draft.decisions.slice(0, 4).map((decision) => `- ${decision}`).join("\n")}\n\nAction items:\n${draft.actions.slice(0, 4).map((action) => `- ${cleanOwner(action.owner)}: ${action.text}`).join("\n")}`;
  const search = draft.search.filter((check) => isUsableSearchCheck(check, summary));
  const expected = {
    decisions: extractSectionBullets(summary, "Decisions"),
    actions: extractSectionBullets(summary, "Action items").map((item) => {
      const match = item.match(/^([^:]+):\s*(.+)$/u);
      return { owner: match?.[1]?.trim() || "unowned", text: match?.[2]?.trim() || item };
    }),
    search: search.length ? search : fallbackSearchChecks(draft.decisions, draft.actions, { title: draft.title, folderName: draft.folderName }),
    expectedPrivacyMarkers: ["PRIVATE_SYNTHETIC_MARKER", "TRANSCRIPT_SYNTHETIC_MARKER"],
  };
  return {
    id: draft.id || `tool-scenario-${index + 1}`,
    title: draft.title,
    folderName: draft.folderName,
    startedAt: draft.startedAt,
    attendees: draft.attendees,
    summary,
    privateNotes: withMarker(draft.privateNotes, "PRIVATE_SYNTHETIC_MARKER"),
    transcript: withMarker(draft.transcript, "TRANSCRIPT_SYNTHETIC_MARKER"),
    expected,
  };
}

function coerceScenarioIndex(value, size) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(size - 1, Math.trunc(numeric)));
}

function normalizeAttendees(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  return value.slice(0, 6).map((item, index) => {
    const name = cleanOwner(item?.name || ownerForIndex(index));
    return { name, email: cleanText(item?.email || `${name.toLowerCase()}@doppel.example`) };
  });
}

function defaultAttendees(index) {
  const first = ownerForIndex(index);
  const second = ownerForIndex(index + 4);
  return [first, second].map((name) => ({ name, email: `${name.toLowerCase()}@doppel.example` }));
}

function cleanOwner(value) {
  const text = cleanText(value).replace(/^Owner\s*:?\s*/iu, "");
  return /^[A-Z][A-Za-z]+$/u.test(text) ? text : "Perry";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function withMarker(value, marker) {
  const text = cleanText(value);
  return text.includes(marker) ? text : `${marker} ${text || "synthetic content"}`;
}
function responseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "perry_generated_company_scenarios",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scenarios: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                folderName: { type: "string" },
                startedAt: { type: "string" },
                attendees: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, email: { type: "string" } }, required: ["name", "email"] } },
                summary: { type: "string" },
                privateNotes: { type: "string" },
                transcript: { type: "string" },
                expected: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    decisions: { type: "array", items: { type: "string" } },
                    actions: { type: "array", items: { type: "object", additionalProperties: false, properties: { owner: { type: "string" }, text: { type: "string" } }, required: ["owner", "text"] } },
                    search: { type: "array", items: { type: "object", additionalProperties: false, properties: { query: { type: "string" }, mustContain: { type: "string" } }, required: ["query", "mustContain"] } },
                    expectedPrivacyMarkers: { type: "array", items: { type: "string" } },
                  },
                  required: ["decisions", "actions", "search", "expectedPrivacyMarkers"],
                },
              },
              required: ["id", "title", "folderName", "startedAt", "attendees", "summary", "privateNotes", "transcript", "expected"],
            },
          },
        },
        required: ["scenarios"],
      },
    },
  };
}

function fillShortBatch(generated, offset, size) {
  const output = Array.isArray(generated) ? [...generated] : [];
  if (output.length >= size) return output.slice(0, size);
  const fallback = deterministicBatch(offset + output.length, size - output.length);
  return [...output, ...fallback];
}

function normalizeScenario(scenario, index) {
  const id = slug(scenario.id || `${scenario.folderName || "scenario"}-${seed}-${index}`);
  const startedAt = validIso(scenario.startedAt) || new Date(Date.UTC(2026, 4, 25, 14, index % 60, 0)).toISOString();
  const attendees = Array.isArray(scenario.attendees) && scenario.attendees.length ? scenario.attendees : [{ name: "Perry", email: "perry@doppel.example" }];
  const title = String(scenario.title || `Generated Scenario ${index + 1}`);
  const folderName = String(scenario.folderName || inferFolderName(title) || "Perry");
  const summary = normalizeSummary(String(scenario.summary || ""), index, { title, folderName });
  const expected = normalizeExpected(scenario.expected, summary, { title, folderName });
  return {
    id,
    payload: {
      note_id: id,
      title,
      summary,
      my_notes: String(scenario.privateNotes || `PRIVATE_SYNTHETIC_MARKER Generated private note ${index + 1}.`),
      transcript: String(scenario.transcript || `TRANSCRIPT_SYNTHETIC_MARKER Generated transcript ${index + 1}.`),
      calendar_event: {
        title,
        start_time: startedAt,
        attendees,
      },
      attendees,
      folder_name: folderName,
      source_url: `https://granola.example/generated/${encodeURIComponent(id)}`,
    },
    expected,
    generated: { model: mode === "deterministic" ? "deterministic" : model, mode, seed, index },
  };
}

function normalizeSummary(summary, index, context) {
  const text = normalizeActionBullets(normalizeHeadings(summary));
  if (/Decisions:\s*\n- /u.test(text) && /Action items:\s*\n- /u.test(text)) return text.trim();
  return fallbackSummary(index, context);
}

function normalizeExpected(expected, summary, context) {
  const summaryDecisions = extractSectionBullets(summary, "Decisions");
  const summaryActions = extractSectionBullets(summary, "Action items").map((item) => {
    const match = item.match(/^([^:]+):\s*(.+)$/u);
    return { owner: match?.[1]?.trim() || "unowned", text: match?.[2]?.trim() || item };
  });
  const expectedDecisions = Array.isArray(expected?.decisions) ? expected.decisions.filter((item) => isUsableExpectedText(item) && summary.includes(item)) : [];
  const expectedActions = Array.isArray(expected?.actions)
    ? expected.actions.filter((item) => item?.text && isUsableExpectedText(item.text) && summary.includes(item.text))
    : [];
  const decisions = expectedDecisions.length ? expectedDecisions : summaryDecisions;
  const actions = expectedActions.length ? expectedActions : summaryActions;
  const search = Array.isArray(expected?.search) && expected.search.length && expected.search.every((item) => isUsableSearchCheck(item, summary))
    ? expected.search
    : fallbackSearchChecks(decisions, actions, context);
  const expectedPrivacyMarkers = Array.isArray(expected?.expectedPrivacyMarkers) && expected.expectedPrivacyMarkers.length ? expected.expectedPrivacyMarkers : ["PRIVATE_SYNTHETIC_MARKER", "TRANSCRIPT_SYNTHETIC_MARKER"];
  return { decisions, actions, search, expectedPrivacyMarkers };
}

function fallbackSummary(index, context) {
  const title = String(context?.title || `Generated Scenario ${index + 1}`).replace(/\s+/gu, " ").trim();
  const folderName = String(context?.folderName || inferFolderName(title) || "Perry").replace(/\s+/gu, " ").trim();
  const owner = ownerForIndex(index);
  const reviewer = ownerForIndex(index + 3);
  return `Decisions:\n- ${title} remains tracked as a ${folderName} company-brain artifact.\n- ${owner} owns follow-through for ${title} in Perry.\n\nAction items:\n- ${owner}: Convert ${title} into searchable Perry documentation.\n- ${reviewer}: Review ${folderName} evidence quality for ${title}.`;
}

function fallbackSearchChecks(decisions, actions, context) {
  const checks = [];
  const title = String(context?.title || "").trim();
  if (isUsableExpectedText(title)) checks.push(searchCheckFromText(title));
  for (const decision of decisions) {
    if (checks.length >= 2) break;
    if (isGenericGeneratedText(decision)) continue;
    checks.push(searchCheckFromText(decision));
  }
  for (const action of actions) {
    if (checks.length >= 2) break;
    checks.push(searchCheckFromText(`${action.owner} ${action.text}`));
  }
  return checks.length ? checks : decisions.slice(0, 2).map(searchCheckFromText);
}

function searchCheckFromText(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  const words = text.split(/\s+/u).filter(Boolean);
  const query = words.slice(0, Math.min(words.length, 6)).join(" ");
  return { query, mustContain: salientMustContain(text) };
}

function salientMustContain(text) {
  const cleaned = String(text || "").replace(/\s+/gu, " ").trim();
  const withoutPunctuation = cleaned.replace(/[^\p{L}\p{N}\s/-]+/gu, "").trim();
  const words = withoutPunctuation.split(/\s+/u).filter(Boolean);
  if (words.length <= 4) return withoutPunctuation || cleaned.slice(0, 80);
  return words.slice(0, 5).join(" ");
}

function isUsableExpectedText(value) {
  const text = String(value || "").trim();
  return text.length >= 8 && !/^(decisions|action items?|search checks?)\s*:?$/iu.test(text);
}

function isUsableSearchCheck(item, summary) {
  const query = String(item?.query || "").trim();
  const mustContain = String(item?.mustContain || "").trim();
  if (!isUsableExpectedText(query) || !isUsableExpectedText(mustContain)) return false;
  if (isGenericGeneratedText(query) || isGenericGeneratedText(mustContain)) return false;
  if (mustContain.includes("/")) return false;
  return summary.toLowerCase().includes(mustContain.toLowerCase());
}

function normalizeHeadings(summary) {
  return String(summary || "")
    .replace(/\r\n?/gu, "\n")
    .replace(/^\s*Decision[s]?\s*:\s*$/gimu, "Decisions:")
    .replace(/^\s*Action\s+items?\s*:\s*$/gimu, "Action items:")
    .replace(/\n\s*-\s*Action\s+items?\s*:\s*\n/giu, "\n\nAction items:\n")
    .replace(/\n\s*-\s*Action\s+items?\s*:\s*/giu, "\n\nAction items:\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeActionBullets(summary) {
  const lines = String(summary || "").split(/\n/u);
  let inActions = false;
  return lines.map((line) => {
    if (/^Action items:\s*$/iu.test(line.trim())) {
      inActions = true;
      return "Action items:";
    }
    if (/^[A-Z][^:\n]{0,80}:\s*$/u.test(line.trim()) && !/^Action items:\s*$/iu.test(line.trim())) inActions = false;
    if (!inActions) return line;
    return line
      .replace(/^(\s*-\s*)Owner:\s*([A-Z][A-Za-z]+)\s*[-:]\s*(.+)$/u, "$1$2: $3")
      .replace(/^(\s*-\s*)Owner\s+([A-Z][A-Za-z]+)\s*[-:]\s*(.+)$/u, "$1$2: $3");
  }).join("\n").trim();
}

function isGenericGeneratedText(value) {
  return /\b(Graph Memory should preserve evidence|Perry generated scenario|generated scenario \d+ should remain structured)\b/iu.test(String(value || ""));
}

function inferFolderName(title) {
  const known = ["Perry", "Wallace", "Notion Wiki", "Discord Ops", "Graph Memory", "Atlas"];
  return known.find((name) => String(title || "").toLowerCase().includes(name.toLowerCase()));
}

function ownerForIndex(index) {
  const people = ["Ada", "Ben", "Mira", "Iris", "Kai", "Jules", "Sam", "Perry"];
  return people[Math.abs(seed + index) % people.length];
}

function uniquifyScenario(scenario, seenIds) {
  const base = slug(scenario.id || scenario.payload?.note_id || "scenario");
  const seen = seenIds.get(base) || 0;
  seenIds.set(base, seen + 1);
  if (seen === 0) return scenario;
  const id = `${base}-${seen + 1}`;
  return {
    ...scenario,
    id,
    payload: {
      ...scenario.payload,
      note_id: id,
      source_url: `https://granola.example/generated/${encodeURIComponent(id)}`,
    },
  };
}

function extractSectionBullets(summary, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = summary.match(new RegExp(`${escaped}:\\s*\\n([\\s\\S]*?)(?:\\n\\n[A-Z][^\\n]+:|$)`, "u"));
  if (!match) return [];
  return match[1].split(/\n/u).map((line) => line.trim()).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
}

function deterministicBatch(offset, size) {
  const projects = ["Perry", "Wallace", "Notion Wiki", "Discord Ops", "Graph Memory", "Atlas"];
  const people = ["Ada", "Ben", "Mira", "Iris", "Kai", "Jules", "Sam", "Perry"];
  const customers = ["Acme", "Northstar", "Helio", "Meridian", "ExampleCo"];
  const repos = ["doppel-labs/perry-discord-bot", "doppel-labs/wallace-webapp", "doppel-labs/graph-memory", "doppel-labs/notion-wiki"];
  const scenarios = [];
  for (let i = 0; i < size; i += 1) {
    const index = offset + i;
    const project = projects[(seed + index) % projects.length];
    const owner = people[(seed * 3 + index) % people.length];
    const reviewer = people[(seed * 5 + index + 1) % people.length];
    const customer = customers[(seed + index * 2) % customers.length];
    const repo = repos[(seed + index * 7) % repos.length];
    const title = `${project} ${["Planning", "Architecture", "Customer Escalation", "Incident Review", "Product Feedback"][index % 5]}`;
    const decision1 = `${owner} owns ${project} follow-through for customer ${customer}.`;
    const decision2 = `Repository ${repo} remains the implementation source for ${project}.`;
    const action1 = { owner, text: `Prepare ${project} update for ${customer} by 2026-06-${String((index % 20) + 1).padStart(2, "0")}.` };
    const action2 = { owner: reviewer, text: `Review policy SOC2 Evidence Retention for ${project}.` };
    scenarios.push({
      id: `${slug(project)}-${index + 1}`,
      title,
      folderName: project,
      startedAt: new Date(Date.UTC(2026, 4, 25, 14, index % 60, 0)).toISOString(),
      attendees: [
        { name: owner, email: `${owner.toLowerCase()}@doppel.example` },
        { name: reviewer, email: `${reviewer.toLowerCase()}@doppel.example` },
      ],
      summary: `Decisions:\n- ${decision1}\n- ${decision2}\n\nAction items:\n- ${action1.owner}: ${action1.text}\n- ${action2.owner}: ${action2.text}`,
      privateNotes: `PRIVATE_SYNTHETIC_MARKER ${project} has private operator-only details.`,
      transcript: `TRANSCRIPT_SYNTHETIC_MARKER ${owner} and ${reviewer} discussed ${project} in detail.`,
      expected: {
        decisions: [decision1, decision2],
        actions: [action1, action2],
        search: [
          { query: `${project} ${customer}`, mustContain: customer },
          { query: repo, mustContain: repo },
        ],
        expectedPrivacyMarkers: ["PRIVATE_SYNTHETIC_MARKER", "TRANSCRIPT_SYNTHETIC_MARKER"],
      },
    });
  }
  return scenarios;
}

function extractJson(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("response did not contain a JSON object");
  return trimmed.slice(start, end + 1);
}

function validIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80) || "scenario";
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
