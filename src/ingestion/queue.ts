import { createHash } from "node:crypto";
import {
  claimIngestionJobs,
  claimNextIngestionJob,
  completeIngestionJob,
  enqueueIngestionJob,
  failIngestionJob,
  getIngestionQueueStats,
  listIngestionJobs,
  type IngestionJobRecord,
  type IngestionQueueStats,
  type PageOptions,
  withBrainTransaction,
} from "@store";
import { loadAppSettings } from "@core";
import { normalizeGranolaZapierPayload } from "@meetings";
import {
  processGranolaZapierPayload,
  tryProcessGranolaApprovalPayloadSync,
  type MeetingWorkflowResult,
} from "./workflow";

export interface EnqueuedIngestionJob {
  job: IngestionJobRecord;
  created: boolean;
}

export interface IngestionQueueSnapshot {
  stats: IngestionQueueStats;
  recent: IngestionJobSummary[];
}

export type IngestionJobSummary = Omit<IngestionJobRecord, "payloadJson" | "resultJson"> & {
  hasPayload: boolean;
  hasResult: boolean;
};

interface QueuedGranolaPayload {
  payload: unknown;
  options: {
    force?: boolean;
    bypassApproval?: boolean;
  };
}

export function enqueueGranolaIngestionJob(
  payload: unknown,
  options: { force?: boolean; bypassApproval?: boolean } = {}
): EnqueuedIngestionJob {
  const note = normalizeGranolaZapierPayload(payload);
  const sourceKey = note.sourceId ? `${note.source}:${note.sourceId}` : stableHash(payload);
  const optionKey = options.force ? "force" : "normal";
  const idempotencyKey = `granola.ingest:${sourceKey}:${optionKey}`;
  const id = `job:${stableHash(idempotencyKey)}`;
  return enqueueIngestionJob({
    id,
    idempotencyKey,
    payloadJson: JSON.stringify({ payload, options } satisfies QueuedGranolaPayload),
  });
}

export async function processNextGranolaIngestionJob(): Promise<{
  processed: boolean;
  job?: IngestionJobRecord;
  result?: MeetingWorkflowResult;
}> {
  const job = claimNextIngestionJob();
  if (!job) return { processed: false };
  return processClaimedGranolaIngestionJob(job);
}

async function processClaimedGranolaIngestionJob(job: IngestionJobRecord): Promise<{
  processed: boolean;
  job: IngestionJobRecord;
  result: MeetingWorkflowResult;
}> {
  try {
    const queued = JSON.parse(job.payloadJson) as QueuedGranolaPayload;
    const result = await processGranolaZapierPayload(queued.payload, {
      force: queued.options.force,
      bypassApproval: queued.options.bypassApproval,
    });
    completeIngestionJob(job.id, {
      duplicate: result.duplicate,
      dryRun: result.dryRun,
      recordId: result.record.id,
      approvalId: result.approval?.id,
      notionPageId: result.notionPageId,
      discordMessageUrl: result.discordMessageUrl,
    });
    return { processed: true, job, result };
  } catch (error) {
    failIngestionJob(job.id, error);
    throw error;
  }
}

export async function drainGranolaIngestionJobs(limit = 10): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  const target = Math.max(Math.trunc(limit), 0);

  while (processed + failed < target) {
    const jobs = claimIngestionJobs(target - processed - failed);
    if (jobs.length === 0) break;

    const fallbackJobs: IngestionJobRecord[] = [];
    const settings = loadAppSettings();
    withBrainTransaction(() => {
      for (const job of jobs) {
        try {
          const queued = JSON.parse(job.payloadJson) as QueuedGranolaPayload;
          const result = tryProcessGranolaApprovalPayloadSync(queued.payload, {
            force: queued.options.force,
            bypassApproval: queued.options.bypassApproval,
            settings,
          });
          if (!result) {
            fallbackJobs.push(job);
            continue;
          }
          completeIngestionJob(job.id, workflowResultSummary(result));
          processed += 1;
        } catch (error) {
          failIngestionJob(job.id, error);
          failed += 1;
        }
      }
    });

    for (const job of fallbackJobs) {
      try {
        await processClaimedGranolaIngestionJob(job);
        processed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { processed, failed };
}

export function getIngestionQueueSnapshot(options: PageOptions = {}): IngestionQueueSnapshot {
  return {
    stats: getIngestionQueueStats(),
    recent: listIngestionJobs(options).map(summarizeJob),
  };
}

export function getFullIngestionQueueSnapshot(options: PageOptions = {}): {
  stats: IngestionQueueStats;
  recent: IngestionJobRecord[];
} {
  return {
    stats: getIngestionQueueStats(),
    recent: listIngestionJobs(options),
  };
}

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function summarizeJob(job: IngestionJobRecord): IngestionJobSummary {
  const { payloadJson, resultJson, ...summary } = job;
  return {
    ...summary,
    hasPayload: Boolean(payloadJson),
    hasResult: Boolean(resultJson),
  };
}

function workflowResultSummary(result: MeetingWorkflowResult): {
  duplicate: boolean;
  dryRun: boolean;
  recordId: string;
  approvalId?: string;
  notionPageId?: string;
  discordMessageUrl?: string;
} {
  return {
    duplicate: result.duplicate,
    dryRun: result.dryRun,
    recordId: result.record.id,
    approvalId: result.approval?.id,
    notionPageId: result.notionPageId,
    discordMessageUrl: result.discordMessageUrl,
  };
}
