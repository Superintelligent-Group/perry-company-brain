// routes/issues — issues endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { listIssueEvents, listIssues, listPivots, listUsers, updateIssue, upsertIssue } from "@store";
import { asIssueBody, httpError, pageFromUrl, parseIssuePriority, parseIssueStatus, readJson, requireAdmin, sendJson, slugKey } from "../http-util";

export async function handleIssues(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, { records: listUsers(pageFromUrl(url)) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/issues") {
    const status = url.searchParams.get("status");
    sendJson(res, 200, {
      records: listIssues({
        ...pageFromUrl(url),
        owner: url.searchParams.get("owner") ?? undefined,
        project: url.searchParams.get("project") ?? undefined,
        status:
          status === "open" || status === "in_progress" || status === "blocked" || status === "done" || status === "canceled"
            ? status
            : undefined,
      }),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/issues") {
    requireAdmin(req);
    const body = asIssueBody(await readJson(req));
    if (!body.title) throw httpError(400, "Issue title is required.");
    const issue = upsertIssue({
      id: body.id ?? `issue:manual:${Date.now()}:${slugKey(body.title)}`,
      project: body.project,
      title: body.title,
      description: body.description,
      status: parseIssueStatus(body.status) ?? "open",
      priority: parseIssuePriority(body.priority) ?? "normal",
      owner: body.owner,
      dueDate: body.dueDate,
    });
    sendJson(res, 201, { issue });
    return true;
  }

  const issueMutationMatch = url.pathname.match(/^\/api\/issues\/([^/]+)$/u);
  if ((req.method === "PATCH" || req.method === "PUT") && issueMutationMatch) {
    requireAdmin(req);
    const body = asIssueBody(await readJson(req));
    const issue = updateIssue({
      id: decodeURIComponent(issueMutationMatch[1]),
      project: body.project,
      title: body.title,
      description: body.description,
      status: parseIssueStatus(body.status),
      priority: parseIssuePriority(body.priority),
      owner: body.owner,
      dueDate: body.dueDate,
      actor: body.actor,
      comment: body.comment,
    });
    if (!issue) throw httpError(404, "Issue not found.");
    sendJson(res, 200, { issue, events: listIssueEvents(issue.id, { limit: 100 }) });
    return true;
  }

  const issueEventsMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/events$/u);
  if (req.method === "GET" && issueEventsMatch) {
    sendJson(res, 200, { records: listIssueEvents(decodeURIComponent(issueEventsMatch[1]), pageFromUrl(url)) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/pivots") {
    sendJson(res, 200, { records: listPivots(pageFromUrl(url)) });
    return true;
  }
  return false;
}
