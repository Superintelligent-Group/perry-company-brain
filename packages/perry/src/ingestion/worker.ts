import { processNextGranolaIngestionJob } from "./queue";

export interface IngestionWorkerHandle {
  stop(): void;
}

export function startIngestionWorker(): IngestionWorkerHandle {
  const enabled = process.env.PERRY_INGESTION_WORKER === "true";
  if (!enabled) return { stop() {} };

  const intervalMs = Number(process.env.PERRY_INGESTION_INTERVAL_MS ?? 1000);
  let running = false;

  const tick = () => {
    if (running) return;
    running = true;
    void processNextGranolaIngestionJob()
      .catch((error) => {
        console.error("Ingestion worker failed:", error);
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
