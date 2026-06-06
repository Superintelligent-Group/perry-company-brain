import { drainGraphSyncJobs } from "./queue";

export function startGraphSyncWorker(): void {
  const enabled = process.env.PERRY_GRAPH_SYNC_WORKER === "true";
  if (!enabled) return;

  const intervalMs = Number(process.env.PERRY_GRAPH_SYNC_INTERVAL_MS ?? 3000);
  const batchSize = Number(process.env.PERRY_GRAPH_SYNC_BATCH_SIZE ?? 10);
  setInterval(() => {
    drainGraphSyncJobs(batchSize).catch((error) => {
      console.error("Graph sync worker failed", error);
    });
  }, intervalMs).unref();
}
