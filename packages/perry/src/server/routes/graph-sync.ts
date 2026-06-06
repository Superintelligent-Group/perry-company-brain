// routes/graph-sync — graph-sync endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { drainGraphSyncJobs, enqueueGraphBackfillPage, getFullGraphSyncQueueSnapshot, getGraphSyncQueueSnapshot, replayGraphChangeSet } from "@graph";
import { getGraphChangeSet, listGraphChangeSets } from "@store";
import { httpError, pageFromUrl, parseGraphChangeSetStatus, requireAdmin, safeJsonArrayLength, sendJson } from "../http-util";

export async function handleGraphSync(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/graph-sync/jobs") {
    const includeFullPayload = url.searchParams.get("detail") === "true";
    if (includeFullPayload) requireAdmin(req);
    const snapshot =
      includeFullPayload ? getFullGraphSyncQueueSnapshot(pageFromUrl(url)) : getGraphSyncQueueSnapshot(pageFromUrl(url));
    sendJson(res, 200, snapshot);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/graph-sync/change-sets") {
    const status = parseGraphChangeSetStatus(url.searchParams.get("status"));
    const includeFullPayload = url.searchParams.get("detail") === "true";
    if (includeFullPayload) requireAdmin(req);
    const records = listGraphChangeSets({ ...pageFromUrl(url), status }).map((record) =>
      includeFullPayload
        ? record
        : {
            id: record.id,
            meetingId: record.meetingId,
            graphSyncJobId: record.graphSyncJobId,
            groupId: record.groupId,
            validationStatus: record.validationStatus,
            validationErrorCount: safeJsonArrayLength(record.validationErrorsJson),
            validationWarningCount: safeJsonArrayLength(record.validationWarningsJson),
            applyStatus: record.applyStatus,
            appliedAt: record.appliedAt,
            lastError: record.lastError,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          }
    );
    sendJson(res, 200, { records });
    return true;
  }

  const graphChangeSetMatch = url.pathname.match(/^\/api\/graph-sync\/change-sets\/([^/]+)$/u);
  if (req.method === "GET" && graphChangeSetMatch) {
    requireAdmin(req);
    const record = getGraphChangeSet(decodeURIComponent(graphChangeSetMatch[1]));
    if (!record) throw httpError(404, "Graph change set not found.");
    sendJson(res, 200, { record });
    return true;
  }
  const graphChangeSetReplayMatch = url.pathname.match(/^\/api\/graph-sync\/change-sets\/([^/]+)\/replay$/u);
  if (req.method === "POST" && graphChangeSetReplayMatch) {
    requireAdmin(req);
    sendJson(res, 200, { replay: await replayGraphChangeSet(decodeURIComponent(graphChangeSetReplayMatch[1])) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/graph-sync/drain") {
    requireAdmin(req);
    sendJson(res, 200, await drainGraphSyncJobs(Number(url.searchParams.get("limit") ?? 10)));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/graph-sync/backfill") {
    requireAdmin(req);
    sendJson(
      res,
      200,
      enqueueGraphBackfillPage({
        limit: Number(url.searchParams.get("limit") ?? 100),
        offset: Number(url.searchParams.get("offset") ?? 0),
      })
    );
    return true;
  }
  return false;
}
