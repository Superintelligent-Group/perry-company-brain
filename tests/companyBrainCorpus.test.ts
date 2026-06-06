import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrainStore,
  flushFtsQueue,
  listActionItems,
  listDecisions,
  searchBrain,
} from "@store";
import { processGranolaZapierPayload } from "@ingestion";

interface CorpusCase {
  id: string;
  payload: Record<string, unknown>;
  expected: {
    decisions: string[];
    actions: Array<{ owner?: string; text: string }>;
    search: Array<{ query: string; mustContain: string }>;
  };
}

test("redacted company-brain corpus preserves expected decisions, actions, and search hits", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-company-brain-corpus-"));
  const env = preserveEnv([
    "PERRY_DB_PATH",
    "PERRY_CONFIG_PATH",
    "PERRY_DEFAULT_PUBLISH_MODE",
    "PERRY_DISCORD_DRY_RUN",
    "PERRY_NOTION_DRY_RUN",
    "PERRY_GRAPHITI_ENABLED",
  ]);

  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  process.env.PERRY_DEFAULT_PUBLISH_MODE = "auto";
  process.env.PERRY_DISCORD_DRY_RUN = "true";
  process.env.PERRY_NOTION_DRY_RUN = "true";
  process.env.PERRY_GRAPHITI_ENABLED = "false";

  try {
    const corpus = loadCorpus();
    for (const item of corpus) {
      const result = await processGranolaZapierPayload(item.payload, { force: true });
      assert.equal(result.record.status, "processed", item.id);
      assert.match(result.discordMessageUrl ?? "", /^https:\/\/discord\.example\/perry-dry-run\//u, item.id);
    }
    flushFtsQueue(10_000);

    const decisions = listDecisions(100).map((item) => item.text);
    const actions = listActionItems(100).map((item) => ({ owner: item.owner, text: item.text }));

    for (const item of corpus) {
      for (const expected of item.expected.decisions) {
        assert(decisions.includes(expected), `${item.id} missing decision: ${expected}`);
      }
      for (const expected of item.expected.actions) {
        assert(
          actions.some((action) => action.owner === expected.owner && action.text === expected.text),
          `${item.id} missing action: ${expected.owner ?? "unowned"} ${expected.text}`
        );
      }
      for (const expected of item.expected.search) {
        const haystack = searchBrain(expected.query, 10)
          .map((result) => `${result.title}\n${result.snippet}`)
          .join("\n");
        assert(
          haystack.includes(expected.mustContain),
          `${item.id} search '${expected.query}' missing '${expected.mustContain}'`
        );
      }
    }
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function loadCorpus(): CorpusCase[] {
  return JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "company-brain-corpus.json"), "utf8")) as CorpusCase[];
}

function preserveEnv(keys: string[]): { restore: () => void } {
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  return {
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
