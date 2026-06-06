import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { closeBrainStore, listApprovals } from "@store";
import { processGranolaZapierPayload } from "@ingestion";

test("creates a pending approval by default instead of posting", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-approval-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const result = await processGranolaZapierPayload({
      note_id: "approval-note",
      title: "Approval Review",
      summary: "Decisions:\n- Keep Perry quiet by default.\n\nAction items:\n- Ada: Review the approval queue",
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.approval?.status, "pending");
    assert.equal(listApprovals("pending").length, 1);
    assert.equal(result.knowledge?.decisions.length, 1);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
