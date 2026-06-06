// routes/content — content endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { enqueueGranolaIngestionJob, previewGranolaZapierPayload, processGranolaZapierPayload } from "@ingestion";
import { sampleGranolaZapierPayload } from "@meetings";
import { listMeetingRecords } from "@store";
import { httpError, pageFromUrl, readJson, requireWebhook, sendJson } from "../http-util";

export async function handleContent(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/granola/zapier") {
    requireWebhook(req);
    const enqueue = url.searchParams.get("enqueue") === "true" || process.env.PERRY_WEBHOOK_MODE === "queue";
    if (enqueue) {
      if (url.searchParams.get("dryRun") === "true") {
        throw httpError(400, "Queued webhook ingestion does not support dryRun; use /api/granola/preview instead.");
      }
      const job = enqueueGranolaIngestionJob(await readJson(req), {
        force: url.searchParams.get("force") === "true",
      });
      sendJson(res, job.created ? 202 : 200, job);
      return true;
    }
    const result = await processGranolaZapierPayload(await readJson(req), {
      dryRun: url.searchParams.get("dryRun") === "true",
      force: url.searchParams.get("force") === "true",
    });
    sendJson(res, 202, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/granola/preview") {
    const result = previewGranolaZapierPayload(await readJson(req));
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/granola/sample") {
    sendJson(res, 200, sampleGranolaZapierPayload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/meetings/history") {
    sendJson(res, 200, { records: listMeetingRecords(pageFromUrl(url)) });
    return true;
  }
  return false;
}
