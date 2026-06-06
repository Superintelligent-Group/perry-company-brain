// routes/system — system endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { AppSettingsSchema, getSettingsPath, loadAppSettings, saveAppSettings } from "@core";
import { getGraphMemoryStatus, getGraphSyncQueueSnapshot } from "@graph";
import { getIngestionQueueSnapshot } from "@ingestion";
import { countApprovals, countMeetingRecords } from "@store";
import { getDiagnostics } from "../diagnostics";
import { isRecord, readJson, requireAdmin, sendJson, staticRoot } from "../http-util";

export async function handleSystem(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      configPath: getSettingsPath(),
      adminBuilt: existsSync(staticRoot),
      diagnostics: getDiagnostics(),
    });
    return true;
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
    return true;
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
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    sendJson(res, 200, getDiagnostics());
    return true;
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
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    requireAdmin(req);
    const body = await readJson(req);
    const settings = AppSettingsSchema.parse(isRecord(body) && "settings" in body ? body.settings : body);
    sendJson(res, 200, { settings: saveAppSettings(settings), configPath: getSettingsPath() });
    return true;
  }
  return false;
}
