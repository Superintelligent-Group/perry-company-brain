import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { drainGranolaIngestionJobs, enqueueGranolaIngestionJob, getIngestionQueueSnapshot } from "@ingestion";
import { closeBrainStore, countApprovals, listApprovals } from "@store";

test("deduplicates queued Granola ingestion jobs and drains them", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ingestion-queue-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const payload = {
      note_id: "queue-note-1",
      title: "Queued Review",
      summary: "Decision: queue first.\n\nAction items:\n- Ada: Review the queue",
    };

    const first = enqueueGranolaIngestionJob(payload);
    const second = enqueueGranolaIngestionJob(payload);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.job.id, second.job.id);
    assert.equal(getIngestionQueueSnapshot().stats.queued, 1);
    const summary = getIngestionQueueSnapshot({ limit: 1 }).recent[0];
    assert.equal(summary.hasPayload, true);
    assert.equal("payloadJson" in summary, false);

    const drained = await drainGranolaIngestionJobs(5);
    assert.equal(drained.processed, 1);
    assert.equal(drained.failed, 0);
    assert.equal(getIngestionQueueSnapshot().stats.completed, 1);
    assert.equal(listApprovals("pending").length, 1);
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

test("drains more jobs than one claim page", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ingestion-queue-page-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const count = 1005;
    for (let index = 0; index < count; index += 1) {
      enqueueGranolaIngestionJob({
        note_id: `queue-page-note-${index}`,
        title: `Queued Page Review ${index}`,
        summary: "Decision: drain every page.\n\nAction items:\n- Perry: Finish the batch",
      });
    }

    const drained = await drainGranolaIngestionJobs(count);
    assert.equal(drained.processed, count);
    assert.equal(drained.failed, 0);
    assert.equal(getIngestionQueueSnapshot({ limit: 0 }).stats.completed, count);
    assert.equal(countApprovals("pending"), count);
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
