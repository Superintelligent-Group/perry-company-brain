import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, {
  message: "Must be in HH:MM 24-hour format",
});
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const optionalEmail = z.preprocess((value) => (value === "" ? undefined : value), z.string().email().optional());

const PersonSchema = z.object({
  name: z.string().min(1),
  discordUserId: z.string().min(1),
  notionName: z.string().optional(),
  notionUserId: z.string().optional(),
  granolaEmail: optionalEmail,
  githubUsername: z.string().optional(),
  team: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type PersonConfig = z.infer<typeof PersonSchema>;

const RoutingRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  project: z.string().optional(),
  titleKeywords: z.array(z.string()).default([]),
  attendeeEmails: z.array(z.string()).default([]),
  granolaFolderName: z.string().optional(),
  discordChannelId: z.string().optional(),
  notionDataSourceId: z.string().optional(),
  publishMode: z.enum(["approval", "auto", "draft"]).default("approval"),
  isActive: z.boolean().default(true),
});

export type RoutingRuleConfig = z.infer<typeof RoutingRuleSchema>;

export const AppSettingsSchema = z.object({
  discord: z.object({
    clientId: z.string().optional(),
    guildId: z.string().optional(),
    standupChannelId: z.string().optional(),
    meetingChannelId: z.string().optional(),
    adminRoleIds: z.array(z.string()).default([]),
  }),
  notion: z.object({
    standupDataSourceId: z.string().optional(),
    meetingNotesDataSourceId: z.string().optional(),
    meetingNotesDatabaseUrl: optionalUrl,
  }),
  standup: z.object({
    enabled: z.boolean().default(true),
    standupTime: hhmm.default("11:45"),
    reminderTime: hhmm.default("09:30"),
    preStandupReminderTime: hhmm.default("11:15"),
    timezone: z.string().min(1).default("America/New_York"),
    formUrl: optionalUrl,
  }),
  granola: z.object({
    mode: z.enum(["manual", "zapier-webhook", "api-poll"]).default("manual"),
    folderName: z.string().optional(),
    pollIntervalMinutes: z.number().int().min(1).max(1440).default(15),
    defaultPublishMode: z.enum(["approval", "auto", "draft"]).default("approval"),
  }),
  roster: z.array(PersonSchema).default([]),
  routingRules: z.array(RoutingRuleSchema).default([]),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export interface Config {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
  DISCORD_STANDUP_CHANNEL_ID: string;
  DISCORD_MEETING_CHANNEL_ID?: string;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  NOTION_MEETING_NOTES_DATA_SOURCE_ID?: string;
  STANDUP_TIME: string;
  REMINDER_TIME: string;
  PRE_STANDUP_REMINDER_TIME: string;
  STANDUP_FORM_URL?: string;
  TIMEZONE: string;
}

const defaultRoster: PersonConfig[] = [
  {
    name: "Example Engineer",
    discordUserId: "000000000000000000",
    notionName: "Example Engineer",
    team: "Engineering",
    isActive: true,
  },
];

function settingsPath(): string {
  return process.env.PERRY_CONFIG_PATH ?? join(process.cwd(), "data", "perry.config.json");
}

function defaultsFromEnv(): AppSettings {
  return AppSettingsSchema.parse({
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID,
      guildId: process.env.DISCORD_GUILD_ID,
      standupChannelId: process.env.DISCORD_STANDUP_CHANNEL_ID,
      meetingChannelId: process.env.DISCORD_MEETING_CHANNEL_ID,
      adminRoleIds: parseList(process.env.DISCORD_ADMIN_ROLE_IDS),
    },
    notion: {
      standupDataSourceId: process.env.NOTION_STANDUP_DATA_SOURCE_ID ?? process.env.NOTION_DATABASE_ID,
      meetingNotesDataSourceId: process.env.NOTION_MEETING_NOTES_DATA_SOURCE_ID,
      meetingNotesDatabaseUrl: process.env.NOTION_MEETING_NOTES_DATABASE_URL,
    },
    standup: {
      enabled: process.env.STANDUP_ENABLED === "false" ? false : true,
      standupTime: process.env.STANDUP_TIME ?? "11:45",
      reminderTime: process.env.REMINDER_TIME ?? "09:30",
      preStandupReminderTime: process.env.PRE_STANDUP_REMINDER_TIME ?? "11:15",
      timezone: process.env.TIMEZONE ?? "America/New_York",
      formUrl: process.env.STANDUP_FORM_URL,
    },
      granola: {
        mode: parseGranolaMode(process.env.GRANOLA_MODE),
        folderName: process.env.GRANOLA_FOLDER_NAME,
        pollIntervalMinutes: Number(process.env.GRANOLA_POLL_INTERVAL_MINUTES ?? 15),
        defaultPublishMode: parsePublishMode(process.env.PERRY_DEFAULT_PUBLISH_MODE),
      },
      roster: defaultRoster,
      routingRules: [],
  });
}

export function loadAppSettings(): AppSettings {
  const defaults = defaultsFromEnv();
  const path = settingsPath();
  if (!existsSync(path)) return defaults;

  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppSettings>;
  return AppSettingsSchema.parse(mergeSettings(defaults, raw));
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const parsed = AppSettingsSchema.parse(settings);
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

export function getSettingsPath(): string {
  return settingsPath();
}

export function loadConfig(): Config {
  const settings = loadAppSettings();
  const required = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? settings.discord.clientId,
    DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID ?? settings.discord.guildId,
    DISCORD_STANDUP_CHANNEL_ID:
      process.env.DISCORD_STANDUP_CHANNEL_ID ?? settings.discord.standupChannelId,
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    NOTION_DATABASE_ID:
      process.env.NOTION_STANDUP_DATA_SOURCE_ID ??
      process.env.NOTION_DATABASE_ID ??
      settings.notion.standupDataSourceId,
  };

  const result = z
    .object({
      DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
      DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
      DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
      DISCORD_STANDUP_CHANNEL_ID: z.string().min(1, "DISCORD_STANDUP_CHANNEL_ID is required"),
      NOTION_TOKEN: z.string().min(1, "NOTION_TOKEN is required"),
      NOTION_DATABASE_ID: z.string().min(1, "NOTION_STANDUP_DATA_SOURCE_ID is required"),
    })
    .safeParse(required);

  if (!result.success) {
    const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return {
    ...result.data,
    DISCORD_MEETING_CHANNEL_ID:
      process.env.DISCORD_MEETING_CHANNEL_ID ?? settings.discord.meetingChannelId,
    NOTION_MEETING_NOTES_DATA_SOURCE_ID:
      process.env.NOTION_MEETING_NOTES_DATA_SOURCE_ID ?? settings.notion.meetingNotesDataSourceId,
    STANDUP_TIME: process.env.STANDUP_TIME ?? settings.standup.standupTime,
    REMINDER_TIME: process.env.REMINDER_TIME ?? settings.standup.reminderTime,
    PRE_STANDUP_REMINDER_TIME:
      process.env.PRE_STANDUP_REMINDER_TIME ?? settings.standup.preStandupReminderTime,
    STANDUP_FORM_URL: process.env.STANDUP_FORM_URL ?? settings.standup.formUrl,
    TIMEZONE: process.env.TIMEZONE ?? settings.standup.timezone,
  };
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseGranolaMode(value: string | undefined): AppSettings["granola"]["mode"] {
  if (value === "zapier-webhook" || value === "api-poll") return value;
  return "manual";
}

function mergeSettings(defaults: AppSettings, override: Partial<AppSettings>): AppSettings {
  return {
    discord: { ...defaults.discord, ...override.discord },
    notion: { ...defaults.notion, ...override.notion },
    standup: { ...defaults.standup, ...override.standup },
    granola: { ...defaults.granola, ...override.granola },
    roster: override.roster ?? defaults.roster,
    routingRules: override.routingRules ?? defaults.routingRules,
  };
}

function parsePublishMode(value: string | undefined): AppSettings["granola"]["defaultPublishMode"] {
  if (value === "auto" || value === "draft") return value;
  return "approval";
}
