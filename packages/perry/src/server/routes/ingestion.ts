// routes/ingestion — ingestion endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { drainGranolaIngestionJobs, getFullIngestionQueueSnapshot, getIngestionQueueSnapshot } from "@ingestion";
import { pageFromUrl, requireAdmin, sendJson } from "../http-util";

export async function handleIngestion(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/ingestion/jobs") {
    const includeFullPayload = url.searchParams.get("detail") === "true";
    if (includeFullPayload) requireAdmin(req);
    const snapshot =
      includeFullPayload ? getFullIngestionQueueSnapshot(pageFromUrl(url)) : getIngestionQueueSnapshot(pageFromUrl(url));
    sendJson(res, 200, snapshot);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ingestion/drain") {
    requireAdmin(req);
    sendJson(res, 200, await drainGranolaIngestionJobs(Number(url.searchParams.get("limit") ?? 10)));
    return true;
  }
  return false;
}
