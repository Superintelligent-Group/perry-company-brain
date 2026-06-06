import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { AppSettingsSchema, getSettingsPath, loadAppSettings, saveAppSettings } from "@core";
import { getCompanyBrainInsights } from "@brain";
import { getBrainToolChangedSince, getBrainToolEvidence, getBrainToolProjectState } from "@brain";
import {
  getOntologyIndex,
  queryArtifacts,
  queryBenchmarkReports,
  queryBlockers,
  queryCapabilities,
  queryEvidenceFor,
  queryFeatures,
  queryGoals,
  queryMetrics,
  queryOntologyChangedSince,
  queryOpenQuestions,
  queryRisks,
  summarizeOntology,
  type CompanyOntologyEntityType,
} from "@brain";
import { getDiagnostics } from "./diagnostics";
import { getOntologyHealthReport } from "@brain";
import { enqueueGraphBackfillPage } from "@graph";
import { replayGraphChangeSet } from "@graph";
import {
  getGraphEntityContext,
  getGraphEvidence,
  getGraphMemoryStatus,
  getGraphTimeline,
  listGraphEntities,
  listGraphFacts,
  searchGraphMemory,
} from "@graph";
import { startGraphSyncWorker } from "@graph";
import {
  drainGraphSyncJobs,
  getFullGraphSyncQueueSnapshot,
  getGraphSyncQueueSnapshot,
} from "@graph";
import {
  drainGranolaIngestionJobs,
  enqueueGranolaIngestionJob,
  getFullIngestionQueueSnapshot,
  getIngestionQueueSnapshot,
} from "@ingestion";
import { startIngestionWorker } from "@ingestion";
import {
  countApprovals,
  countMeetingRecords,
  flushFtsQueue,
  listActionItems,
  listApprovalSummaries,
  listApprovals,
  listDecisions,
  listGraphChangeSets,
  getGraphChangeSet,
  listIssueEvents,
  listIssues,
  listPivots,
  listUsers,
  listMeetingRecords,
  searchBrain,
  updateIssue,
  upsertIssue,
} from "@store";
import { projectMultiplayerState } from "@graph";
import { startFtsWorker } from "@brain";
import {
  approvePendingMeeting,
  previewGranolaZapierPayload,
  processGranolaZapierPayload,
  rejectPendingMeeting,
} from "@ingestion";
import { sampleGranolaZapierPayload } from "@meetings";

const staticRoot = join(process.cwd(), "admin", "dist");
const pingBody = Buffer.from('{"ok":true}');
let ftsWorkerStarted = false;
let ingestionWorkerStarted = false;
let graphSyncWorkerStarted = false;

export function startAdminServer(port = Number(process.env.PORT ?? 8787)): void {
  if (!ftsWorkerStarted) {
    startFtsWorker();
    ftsWorkerStarted = true;
  }
  if (!ingestionWorkerStarted) {
    startIngestionWorker();
    ingestionWorkerStarted = true;
  }
  if (!graphSyncWorkerStarted) {
    startGraphSyncWorker();
    graphSyncWorkerStarted = true;
  }

  const server = createAdminHttpServer();
  server.listen(port, () => {
    console.log(`Perry admin server listening on http://localhost:${port}`);
  });
}

export function createAdminHttpServer(): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/api/ping") {
        sendJsonBuffer(res, 200, pingBody);
        return;
      }
      await route(req, res);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      if (status >= 500) console.error(error);
      sendJson(res, status, { error: error instanceof Error ? error.message : "Internal server error" });
    }
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      configPath: getSettingsPath(),
      adminBuilt: existsSync(staticRoot),
      diagnostics: getDiagnostics(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/counts") {
    const status = url.searchParams.get("status");
    const approvalStatus =
      status === "pending" || status === "approved" || status === "rejected" || status === "posted" ? status : undefined;
    sendJson(res, 200, {
      approvals: countApprovals(approvalStatus),
      processedMeetings: countMeetingRecords("processed"),
      ingestionQueue: getIngestionQueueSnapshot({ limit: 0 }).stats,
      graphSyncQueue: getGraphSyncQueueSnapshot({ limit: 0 }).stats,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent/status") {
    sendJson(res, 200, {
      ok: true,
      approvals: countApprovals("pending"),
      processedMeetings: countMeetingRecords("processed"),
      ingestionQueue: getIngestionQueueSnapshot({ limit: 5 }),
      graphSyncQueue: getGraphSyncQueueSnapshot({ limit: 5 }),
      graphMemory: getGraphMemoryStatus(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    sendJson(res, 200, getDiagnostics());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      settings: loadAppSettings(),
      secrets: {
        discordToken: Boolean(process.env.DISCORD_TOKEN),
        notionToken: Boolean(process.env.NOTION_TOKEN),
        granolaApiKey: Boolean(process.env.GRANOLA_API_KEY),
        adminApiToken: Boolean(process.env.ADMIN_API_TOKEN),
        graphitiBridgeUrl: Boolean(process.env.PERRY_GRAPHITI_BRIDGE_URL),
      },
      graphMemory: getGraphMemoryStatus(),
      configPath: getSettingsPath(),
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    requireAdmin(req);
    const body = await readJson(req);
    const settings = AppSettingsSchema.parse(isRecord(body) && "settings" in body ? body.settings : body);
    sendJson(res, 200, { settings: saveAppSettings(settings), configPath: getSettingsPath() });
    return;
  }

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
      return;
    }
    const result = await processGranolaZapierPayload(await readJson(req), {
      dryRun: url.searchParams.get("dryRun") === "true",
      force: url.searchParams.get("force") === "true",
    });
    sendJson(res, 202, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ingestion/jobs") {
    const includeFullPayload = url.searchParams.get("detail") === "true";
    if (includeFullPayload) requireAdmin(req);
    const snapshot =
      includeFullPayload ? getFullIngestionQueueSnapshot(pageFromUrl(url)) : getIngestionQueueSnapshot(pageFromUrl(url));
    sendJson(res, 200, snapshot);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingestion/drain") {
    requireAdmin(req);
    sendJson(res, 200, await drainGranolaIngestionJobs(Number(url.searchParams.get("limit") ?? 10)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/graph-sync/jobs") {
    const includeFullPayload = url.searchParams.get("detail") === "true";
    if (includeFullPayload) requireAdmin(req);
    const snapshot =
      includeFullPayload ? getFullGraphSyncQueueSnapshot(pageFromUrl(url)) : getGraphSyncQueueSnapshot(pageFromUrl(url));
    sendJson(res, 200, snapshot);
    return;
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
    return;
  }

  const graphChangeSetMatch = url.pathname.match(/^\/api\/graph-sync\/change-sets\/([^/]+)$/u);
  if (req.method === "GET" && graphChangeSetMatch) {
    requireAdmin(req);
    const record = getGraphChangeSet(decodeURIComponent(graphChangeSetMatch[1]));
    if (!record) throw httpError(404, "Graph change set not found.");
    sendJson(res, 200, { record });
    return;
  }
  const graphChangeSetReplayMatch = url.pathname.match(/^\/api\/graph-sync\/change-sets\/([^/]+)\/replay$/u);
  if (req.method === "POST" && graphChangeSetReplayMatch) {
    requireAdmin(req);
    sendJson(res, 200, { replay: await replayGraphChangeSet(decodeURIComponent(graphChangeSetReplayMatch[1])) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/graph-sync/drain") {
    requireAdmin(req);
    sendJson(res, 200, await drainGraphSyncJobs(Number(url.searchParams.get("limit") ?? 10)));
    return;
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
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/granola/preview") {
    const result = previewGranolaZapierPayload(await readJson(req));
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/granola/sample") {
    sendJson(res, 200, sampleGranolaZapierPayload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/meetings/history") {
    sendJson(res, 200, { records: listMeetingRecords(pageFromUrl(url)) });
    return;
  }

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
    return;
  }

  const approvalAction = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/u);
  if (req.method === "POST" && approvalAction) {
    requireAdmin(req);
    const [, approvalId, action] = approvalAction;
    const decodedApprovalId = decodeURIComponent(approvalId);
    const result =
      action === "approve" ? await approvePendingMeeting(decodedApprovalId) : rejectPendingMeeting(decodedApprovalId);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/search") {
    const types = (url.searchParams.get("types") ?? "")
      .split(",")
      .map((type) => type.trim())
      .filter((type): type is "meeting" | "decision" | "action" =>
        type === "meeting" || type === "decision" || type === "action"
      );
    sendJson(res, 200, {
      results: searchBrain(url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 20), {
        types,
      }),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/search") {
    sendJson(res, 200, await searchGraphMemory(url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 10)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/entities") {
    sendJson(
      res,
      200,
      await listGraphEntities({
        query: url.searchParams.get("q") ?? undefined,
        type: url.searchParams.get("type") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 25),
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/facts") {
    const activeParam = url.searchParams.get("active");
    sendJson(
      res,
      200,
      await listGraphFacts({
        subject: url.searchParams.get("subject") ?? undefined,
        object: url.searchParams.get("object") ?? undefined,
        relation: url.searchParams.get("relation") ?? undefined,
        active: activeParam === null ? undefined : activeParam === "true",
        limit: Number(url.searchParams.get("limit") ?? 25),
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/evidence") {
    sendJson(res, 200, await getGraphEvidence(url.searchParams.get("evidenceId") ?? ""));
    return;
  }

  const graphContextMatch = url.pathname.match(/^\/api\/brain\/graph\/entities\/([^/]+)\/context$/u);
  if (req.method === "GET" && graphContextMatch) {
    sendJson(
      res,
      200,
      await getGraphEntityContext(decodeURIComponent(graphContextMatch[1]), Number(url.searchParams.get("limit") ?? 25))
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/timeline") {
    sendJson(
      res,
      200,
      await getGraphTimeline(
        url.searchParams.get("stableKey") ?? url.searchParams.get("entity") ?? "",
        Number(url.searchParams.get("limit") ?? 50)
      )
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/decisions") {
    sendJson(res, 200, {
      records: listDecisions(Number(url.searchParams.get("limit") ?? 50), Number(url.searchParams.get("offset") ?? 0)),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/actions") {
    sendJson(res, 200, {
      records: listActionItems(Number(url.searchParams.get("limit") ?? 50), Number(url.searchParams.get("offset") ?? 0)),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/insights") {
    sendJson(res, 200, getCompanyBrainInsights(Number(url.searchParams.get("limit") ?? 10_000)));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/brain/ontology") {
    const index = getOntologyIndex(Number(url.searchParams.get("changeSetLimit") ?? 1000));
    const type = parseOntologyType(url.searchParams.get("type"));
    const options = {
      project: url.searchParams.get("project") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 25),
    };
    sendJson(res, 200, type ? runOntologyQuery(type, options, index) : { summary: summarizeOntology(index) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/ontology/changed-since") {
    const since = url.searchParams.get("since");
    if (!since) throw httpError(400, "Missing required since parameter.");
    sendJson(res, 200, queryOntologyChangedSince(since, {
      project: url.searchParams.get("project") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/brain/ontology/evidence") {
    const index = getOntologyIndex(Number(url.searchParams.get("changeSetLimit") ?? 1000));
    sendJson(res, 200, queryEvidenceFor(url.searchParams.get("stableKey") ?? "", index));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/ontology/health") {
    sendJson(
      res,
      200,
      getOntologyHealthReport({
        changeSetLimit: Number(url.searchParams.get("changeSetLimit") ?? 200),
        entityLimit: Number(url.searchParams.get("entityLimit") ?? 1000),
        relationLimit: Number(url.searchParams.get("relationLimit") ?? 2000),
        evidenceLimit: Number(url.searchParams.get("evidenceLimit") ?? 1000),
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/tools/project-state") {
    sendJson(
      res,
      200,
      getBrainToolProjectState({
        project: url.searchParams.get("project") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 10),
        types: parseOntologyTypes(url.searchParams.get("types")),
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/tools/changed-since") {
    const since = url.searchParams.get("since");
    if (!since) throw httpError(400, "Missing required since parameter.");
    sendJson(
      res,
      200,
      getBrainToolChangedSince({
        since,
        project: url.searchParams.get("project") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 50),
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/tools/evidence") {
    const stableKey = url.searchParams.get("stableKey") ?? "";
    if (!stableKey.trim()) throw httpError(400, "Missing required stableKey parameter.");
    sendJson(res, 200, getBrainToolEvidence({ stableKey }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/brain/project-multiplayer") {
    requireAdmin(req);
    sendJson(res, 200, projectMultiplayerState(Number(url.searchParams.get("limit") ?? 10_000)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, { records: listUsers(pageFromUrl(url)) });
    return;
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
    return;
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
    return;
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
    return;
  }

  const issueEventsMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/events$/u);
  if (req.method === "GET" && issueEventsMatch) {
    sendJson(res, 200, { records: listIssueEvents(decodeURIComponent(issueEventsMatch[1]), pageFromUrl(url)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pivots") {
    sendJson(res, 200, { records: listPivots(pageFromUrl(url)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/brain/fts/flush") {
    requireAdmin(req);
    sendJson(res, 200, { flushed: flushFtsQueue(Number(url.searchParams.get("limit") ?? 1000)) });
    return;
  }

  serveStatic(url.pathname, res);
}

function requireAdmin(req: IncomingMessage): void {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return;
  const provided = req.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? req.headers["x-admin-token"];
  if (provided !== token) {
    throw httpError(401, "Unauthorized");
  }
}

function requireWebhook(req: IncomingMessage): void {
  const token = process.env.GRANOLA_WEBHOOK_TOKEN;
  if (!token) return;
  if (req.headers["x-perry-webhook-token"] !== token) {
    throw httpError(401, "Unauthorized webhook");
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendJsonBuffer(res: ServerResponse, status: number, body: Buffer): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  res.end(body);
}

function serveStatic(pathname: string, res: ServerResponse): void {
  if (!existsSync(staticRoot)) {
    sendJson(res, 404, { error: "Admin app has not been built yet. Run pnpm admin:build." });
    return;
  }

  const cleanPath = normalize(pathname === "/" ? "index.html" : pathname)
    .replace(/^[/\\]/u, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = join(staticRoot, cleanPath);
  if (!filePath.startsWith(staticRoot) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    serveFile(join(staticRoot, "index.html"), res);
    return;
  }
  serveFile(filePath, res);
}

function serveFile(path: string, res: ServerResponse): void {
  res.writeHead(200, { "content-type": contentType(path) });
  res.end(readFileSync(path));
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asIssueBody(value: unknown): {
  id?: string;
  project?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  owner?: string;
  dueDate?: string;
  actor?: string;
  comment?: string;
} {
  if (!isRecord(value)) return {};
  return {
    id: optionalBodyString(value.id),
    project: bodyString(value.project),
    title: optionalBodyString(value.title),
    description: bodyString(value.description),
    status: optionalBodyString(value.status),
    priority: optionalBodyString(value.priority),
    owner: bodyString(value.owner),
    dueDate: bodyString(value.dueDate),
    actor: optionalBodyString(value.actor),
    comment: optionalBodyString(value.comment),
  };
}

function parseOntologyType(value: string | null): CompanyOntologyEntityType | undefined {
  return value === "goal" ||
    value === "metric" ||
    value === "risk" ||
    value === "blocker" ||
    value === "open_question" ||
    value === "capability" ||
    value === "feature" ||
    value === "artifact" ||
    value === "benchmark_report"
    ? value
    : undefined;
}

function parseOntologyTypes(value: string | null): CompanyOntologyEntityType[] | undefined {
  const types = (value ?? "")
    .split(",")
    .map((item) => parseOntologyType(item.trim()))
    .filter((item): item is CompanyOntologyEntityType => Boolean(item));
  return types.length ? types : undefined;
}

function runOntologyQuery(
  type: CompanyOntologyEntityType,
  options: { project?: string; q?: string; limit?: number },
  index: ReturnType<typeof getOntologyIndex>
): unknown {
  switch (type) {
    case "goal":
      return queryGoals(options, index);
    case "metric":
      return queryMetrics(options, index);
    case "risk":
      return queryRisks(options, index);
    case "blocker":
      return queryBlockers(options, index);
    case "open_question":
      return queryOpenQuestions(options, index);
    case "capability":
      return queryCapabilities(options, index);
    case "feature":
      return queryFeatures(options, index);
    case "artifact":
      return queryArtifacts(options, index);
    case "benchmark_report":
      return queryBenchmarkReports(options, index);
  }
}
function parseIssueStatus(value: string | undefined): "open" | "in_progress" | "blocked" | "done" | "canceled" | undefined {
  return value === "open" || value === "in_progress" || value === "blocked" || value === "done" || value === "canceled"
    ? value
    : undefined;
}

function parseIssuePriority(value: string | undefined): "low" | "normal" | "high" | "urgent" | undefined {
  return value === "low" || value === "normal" || value === "high" || value === "urgent" ? value : undefined;
}

function parseGraphChangeSetStatus(value: string | null): "queued" | "applied" | "failed" | undefined {
  return value === "queued" || value === "applied" || value === "failed" ? value : undefined;
}

function safeJsonArrayLength(value: string): number {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function optionalBodyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bodyString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function slugKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function pageFromUrl(url: URL): { limit: number; offset: number } {
  return {
    limit: Number(url.searchParams.get("limit") ?? 100),
    offset: Number(url.searchParams.get("offset") ?? 0),
  };
}









