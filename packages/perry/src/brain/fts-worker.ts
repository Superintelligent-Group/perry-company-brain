import { flushFtsQueue, pendingFtsCount } from "@store";

export interface FtsWorkerHandle {
  stop(): void;
}

export function startFtsWorker(): FtsWorkerHandle {
  const enabled = process.env.PERRY_FTS_WORKER !== "false";
  if (!enabled) {
    return { stop() {} };
  }

  const intervalMs = Number(process.env.PERRY_FTS_INTERVAL_MS ?? 1000);
  const batchSize = Number(process.env.PERRY_FTS_BATCH_SIZE ?? 1000);
  let running = false;

  const tick = () => {
    if (running) return;
    running = true;
    try {
      if (pendingFtsCount() > 0) {
        flushFtsQueue(batchSize);
      }
    } catch (error) {
      console.error("FTS worker failed:", error);
    } finally {
      running = false;
    }
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
