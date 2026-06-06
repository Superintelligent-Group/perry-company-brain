// http-util — shared helpers for the admin HTTP server
import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { type CompanyOntologyEntityType, getOntologyIndex, queryArtifacts, queryBenchmarkReports, queryBlockers, queryCapabilities, queryFeatures, queryGoals, queryMetrics, queryOpenQuestions, queryRisks } from "@brain";

export const staticRoot = join(process.cwd(), "admin", "dist");

export function requireAdmin(req: IncomingMessage): void {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return;
  const provided = req.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? req.headers["x-admin-token"];
  if (provided !== token) {
    throw httpError(401, "Unauthorized");
  }
}

export function requireWebhook(req: IncomingMessage): void {
  const token = process.env.GRANOLA_WEBHOOK_TOKEN;
  if (!token) return;
  if (req.headers["x-perry-webhook-token"] !== token) {
    throw httpError(401, "Unauthorized webhook");
  }
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export function sendJsonBuffer(res: ServerResponse, status: number, body: Buffer): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  res.end(body);
}

export function serveStatic(pathname: string, res: ServerResponse): void {
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

export function serveFile(path: string, res: ServerResponse): void {
  res.writeHead(200, { "content-type": contentType(path) });
  res.end(readFileSync(path));
}

export function contentType(path: string): string {
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

export function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asIssueBody(value: unknown): {
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

export function parseOntologyType(value: string | null): CompanyOntologyEntityType | undefined {
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

export function parseOntologyTypes(value: string | null): CompanyOntologyEntityType[] | undefined {
  const types = (value ?? "")
    .split(",")
    .map((item) => parseOntologyType(item.trim()))
    .filter((item): item is CompanyOntologyEntityType => Boolean(item));
  return types.length ? types : undefined;
}

export function runOntologyQuery(
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

export function parseIssueStatus(value: string | undefined): "open" | "in_progress" | "blocked" | "done" | "canceled" | undefined {
  return value === "open" || value === "in_progress" || value === "blocked" || value === "done" || value === "canceled"
    ? value
    : undefined;
}

export function parseIssuePriority(value: string | undefined): "low" | "normal" | "high" | "urgent" | undefined {
  return value === "low" || value === "normal" || value === "high" || value === "urgent" ? value : undefined;
}

export function parseGraphChangeSetStatus(value: string | null): "queued" | "applied" | "failed" | undefined {
  return value === "queued" || value === "applied" || value === "failed" ? value : undefined;
}

export function safeJsonArrayLength(value: string): number {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function optionalBodyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function bodyString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

export function slugKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

export function pageFromUrl(url: URL): { limit: number; offset: number } {
  return {
    limit: Number(url.searchParams.get("limit") ?? 100),
    offset: Number(url.searchParams.get("offset") ?? 0),
  };
}
