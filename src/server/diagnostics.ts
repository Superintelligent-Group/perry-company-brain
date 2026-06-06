import { dirname } from "node:path";
import { existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { countApprovals, countMeetingRecords, getMeetingStorePath, pendingFtsCount } from "@store";
import { getSettingsPath, loadAppSettings } from "@core";
import { getGraphMemoryStatus } from "@graph";

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ready" | "missing" | "warning";
  detail: string;
}

export interface Diagnostics {
  checks: DiagnosticCheck[];
  ready: boolean;
  configPath: string;
  meetingStorePath: string;
  processedMeetingCount: number;
  pendingApprovalCount: number;
  pendingFtsCount: number;
  dbHealth: {
    path: string;
    parentWritable: boolean;
    note?: string;
  };
}

export function getDiagnostics(): Diagnostics {
  const settings = loadAppSettings();
  const checks: DiagnosticCheck[] = [
    secretCheck("discord-token", "Discord token", "DISCORD_TOKEN"),
    secretCheck("notion-token", "Notion token", "NOTION_TOKEN"),
    valueCheck("discord-client", "Discord client", settings.discord.clientId, "Client ID configured"),
    valueCheck("discord-guild", "Discord guild", settings.discord.guildId, "Guild ID configured"),
    valueCheck(
      "standup-channel",
      "Standup channel",
      settings.discord.standupChannelId,
      "Standup channel configured"
    ),
    valueCheck(
      "meeting-channel",
      "Meeting channel",
      settings.discord.meetingChannelId,
      "Meeting notes channel configured"
    ),
    valueCheck(
      "standup-source",
      "Standup data source",
      settings.notion.standupDataSourceId,
      "Standup Notion data source configured"
    ),
    valueCheck(
      "meeting-source",
      "Meeting notes data source",
      settings.notion.meetingNotesDataSourceId,
      "Meeting notes Notion data source configured"
    ),
    {
      id: "granola-mode",
      label: "Granola mode",
      status: settings.granola.mode === "manual" ? "warning" : "ready",
      detail:
        settings.granola.mode === "manual"
          ? "Manual mode is useful for setup, but it will not ingest notes automatically"
          : `${settings.granola.mode} configured`,
    },
    {
      id: "roster",
      label: "Roster",
      status: settings.roster.some((person) => person.isActive !== false) ? "ready" : "warning",
      detail: `${settings.roster.filter((person) => person.isActive !== false).length} active people`,
    },
    {
      id: "routing",
      label: "Routing rules",
      status: settings.routingRules.some((rule) => rule.isActive !== false) ? "ready" : "warning",
      detail: `${settings.routingRules.filter((rule) => rule.isActive !== false).length} active routes`,
    },
    graphMemoryCheck(),
    {
      id: "config-file",
      label: "Config file",
      status: existsSync(getSettingsPath()) ? "ready" : "warning",
      detail: existsSync(getSettingsPath()) ? "Saved config exists" : "Using defaults until settings are saved",
    },
    dbCheck(),
  ];

  const dbHealth = getDbHealth();
  return {
    checks,
    ready: checks.every((check) => check.status === "ready"),
    configPath: getSettingsPath(),
    meetingStorePath: getMeetingStorePath(),
    processedMeetingCount: countMeetingRecords("processed"),
    pendingApprovalCount: countApprovals("pending"),
    pendingFtsCount: pendingFtsCount(),
    dbHealth,
  };
}

function graphMemoryCheck(): DiagnosticCheck {
  const status = getGraphMemoryStatus();
  if (!process.env.PERRY_GRAPHITI_ENABLED || process.env.PERRY_GRAPHITI_ENABLED === "false") {
    return {
      id: "graphiti",
      label: "Graphiti memory",
      status: "warning",
      detail: "Optional temporal graph memory is disabled",
    };
  }
  return {
    id: "graphiti",
    label: "Graphiti memory",
    status: status.enabled ? "ready" : "missing",
    detail: status.enabled
      ? `Bridge configured for group ${status.groupId}`
      : "Set PERRY_GRAPHITI_BRIDGE_URL or disable PERRY_GRAPHITI_ENABLED",
  };
}

function secretCheck(id: string, label: string, envName: string): DiagnosticCheck {
  const hasValue = Boolean(process.env[envName]);
  return {
    id,
    label,
    status: hasValue ? "ready" : "missing",
    detail: hasValue ? `${envName} is set` : `${envName} is missing`,
  };
}

function valueCheck(id: string, label: string, value: unknown, readyDetail: string): DiagnosticCheck {
  return {
    id,
    label,
    status: value ? "ready" : "missing",
    detail: value ? readyDetail : "Not configured",
  };
}

function dbCheck(): DiagnosticCheck {
  const health = getDbHealth();
  return {
    id: "db-path",
    label: "Brain database path",
    status: health.parentWritable ? "ready" : "missing",
    detail: health.parentWritable ? `Writable: ${health.path}` : health.note ?? `Not writable: ${health.path}`,
  };
}

function getDbHealth(): Diagnostics["dbHealth"] {
  const path = getMeetingStorePath();
  if (path === ":memory:") {
    return {
      path,
      parentWritable: true,
      note: "In-memory database is suitable for smoke tests only",
    };
  }

  const parent = dirname(path);
  const probe = `${path}.probe`;
  try {
    mkdirSync(parent, { recursive: true });
    writeFileSync(probe, "ok", "utf8");
    rmSync(probe, { force: true });
    const parentStats = statSync(parent);
    return {
      path,
      parentWritable: parentStats.isDirectory(),
    };
  } catch (error) {
    return {
      path,
      parentWritable: false,
      note: error instanceof Error ? error.message : "Unable to verify DB path",
    };
  }
}
