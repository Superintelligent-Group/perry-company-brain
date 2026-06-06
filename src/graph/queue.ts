import {
  claimGraphSyncJobs,
  completeGraphSyncJob,
  enqueueGraphSyncJob,
  failGraphSyncJob,
  getGraphSyncQueueStats,
  listGraphSyncJobs,
  type GraphSyncJobRecord,
  type GraphSyncQueueStats,
  type PageOptions,
} from "@store";
import {
  buildGraphitiMeetingEpisode,
  getGraphMemoryStatus,
  postGraphitiEpisode,
  type GraphMemorySyncInput,
  type GraphitiEpisodePayload,
} from "./memory";

export interface GraphSyncQueueSnapshot {
  stats: GraphSyncQueueStats;
  recent: GraphSyncJobSummary[];
}

export type GraphSyncJobSummary = Omit<GraphSyncJobRecord, "payloadJson" | "resultJson"> & {
  hasPayload: boolean;
  hasResult: boolean;
};

export function enqueueMeetingGraphSync(input: GraphMemorySyncInput): GraphSyncJobRecord | undefined {
  const status = getGraphMemoryStatus();
  if (!status.enabled) return undefined;
  const episode = buildGraphitiMeetingEpisode(input, status.groupId);
  const body = JSON.parse(episode.body) as {
    graphChangeSet?: unknown;
    graphValidation?: { valid?: boolean; errors?: unknown[]; warnings?: unknown[] };
  };
  return enqueueGraphSyncJob({
    id: `graph-sync:meeting:${input.record.id}`,
    entityType: "meeting",
    entityId: input.record.id,
    payloadJson: JSON.stringify(episode),
    graphChangeSet: body.graphChangeSet
      ? {
          id: `graph-change-set:meeting:${input.record.id}`,
          groupId: episode.groupId,
          validationStatus: body.graphValidation?.valid === false ? "invalid" : "valid",
          validationErrors: body.graphValidation?.errors ?? [],
          validationWarnings: body.graphValidation?.warnings ?? [],
          changeSet: body.graphChangeSet,
        }
      : undefined,
  });
}

export async function drainGraphSyncJobs(limit = 10): Promise<{ processed: number; failed: number; skipped: number }> {
  const status = getGraphMemoryStatus();
  if (!status.enabled) return { processed: 0, failed: 0, skipped: 0 };

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const target = Math.max(Math.trunc(limit), 0);

  while (processed + failed + skipped < target) {
    const jobs = claimGraphSyncJobs(target - processed - failed - skipped);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payloadJson) as GraphitiEpisodePayload;
        await postGraphitiEpisode(payload, status);
        completeGraphSyncJob(job.id, { posted: true, name: payload.name, groupId: payload.groupId });
        processed += 1;
      } catch (error) {
        failGraphSyncJob(job.id, error);
        failed += 1;
      }
    }
  }

  return { processed, failed, skipped };
}

export function getGraphSyncQueueSnapshot(options: PageOptions = {}): GraphSyncQueueSnapshot {
  return {
    stats: getGraphSyncQueueStats(),
    recent: listGraphSyncJobs(options).map(summarizeJob),
  };
}

export function getFullGraphSyncQueueSnapshot(options: PageOptions = {}): {
  stats: GraphSyncQueueStats;
  recent: GraphSyncJobRecord[];
} {
  return {
    stats: getGraphSyncQueueStats(),
    recent: listGraphSyncJobs(options),
  };
}

function summarizeJob(job: GraphSyncJobRecord): GraphSyncJobSummary {
  const { payloadJson, resultJson, ...summary } = job;
  return {
    ...summary,
    hasPayload: Boolean(payloadJson),
    hasResult: Boolean(resultJson),
  };
}
