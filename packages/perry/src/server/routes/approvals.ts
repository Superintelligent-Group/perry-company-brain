// routes/approvals — approvals endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { approvePendingMeeting, rejectPendingMeeting } from "@ingestion";
import { listApprovals, listApprovalSummaries } from "@store";
import { pageFromUrl, requireAdmin, sendJson } from "../http-util";

export async function handleApprovals(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/approvals") {
    const status = url.searchParams.get("status");
    const includeFullPayload = url.searchParams.get("detail") === "true";
    const list = includeFullPayload ? listApprovals : listApprovalSummaries;
    sendJson(res, 200, {
      records:
        status === "pending" || status === "approved" || status === "rejected" || status === "posted"
          ? list(status, pageFromUrl(url))
          : list(undefined, pageFromUrl(url)),
    });
    return true;
  }

  const approvalAction = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/u);
  if (req.method === "POST" && approvalAction) {
    requireAdmin(req);
    const [, approvalId, action] = approvalAction;
    const decodedApprovalId = decodeURIComponent(approvalId);
    const result =
      action === "approve" ? await approvePendingMeeting(decodedApprovalId) : rejectPendingMeeting(decodedApprovalId);
    sendJson(res, 200, result);
    return true;
  }
  return false;
}
