import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import { loadAppSettings, loadConfig } from "@core";
import { fetchStandupEntries, findMissingStandups } from "@notion";
import { getActiveRoster } from "@core";
import { formatMissing, formatSummary } from "./format";
import { getGraphEntityContext, listGraphEntities } from "@graph";
import { listActionItems, listPivots } from "@store";
import {
  discordOntologyTypes,
  formatOntologyChangedSince,
  formatOntologyEvidence,
  formatOntologyState,
} from "@brain";
import type { CompanyOntologyEntityType } from "@core";

/**
 * Defines each slash command along with its execution handler.  When adding new
 * commands you must update both the `commands` array and the switch in
 * `handleInteraction`.
 */
const commands = [
  new SlashCommandBuilder()
    .setName("standup")
    .setDescription("Standup commands")
    .addSubcommand((sub) =>
      sub
        .setName("missing")
        .setDescription("List people who have not submitted their standup today")
    )
    .addSubcommand((sub) =>
      sub
        .setName("summary")
        .setDescription("Post a summary of todayâ€™s standups")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remind")
        .setDescription("Send a standup reminder to the standup channel")
    )
    .addSubcommand((sub) =>
      sub.setName("link").setDescription("Get the link to the standup form")),
  new SlashCommandBuilder()
    .setName("brain")
    .setDescription("Query Perry company brain")
    .addSubcommand((sub) =>
      sub
        .setName("project")
        .setDescription("Show bounded graph context for a project")
        .addStringOption((option) => option.setName("name").setDescription("Project name").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("owner")
        .setDescription("Show bounded graph context for a person")
        .addStringOption((option) => option.setName("name").setDescription("Owner name").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("state")
        .setDescription("Show indexed ontology state for a project")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Ontology object type")
            .setRequired(true)
            .addChoices(...discordOntologyTypes.map((type) => ({ name: type.replace(/_/gu, " "), value: type })))
        )
        .addStringOption((option) => option.setName("project").setDescription("Project name"))
        .addStringOption((option) => option.setName("q").setDescription("Filter text"))
        .addIntegerOption((option) => option.setName("limit").setDescription("Rows to return, max 10"))
    )
    .addSubcommand((sub) =>
      sub
        .setName("changed")
        .setDescription("Show ontology objects changed since an ISO timestamp")
        .addStringOption((option) => option.setName("since").setDescription("ISO timestamp").setRequired(true))
        .addStringOption((option) => option.setName("project").setDescription("Project name"))
        .addIntegerOption((option) => option.setName("limit").setDescription("Rows to return, max 10"))
    )
    .addSubcommand((sub) =>
      sub
        .setName("evidence")
        .setDescription("Show bounded ontology evidence for a stable key")
        .addStringOption((option) => option.setName("entity").setDescription("Ontology stable key").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("my-actions").setDescription("List open actions that appear to belong to you"))
    .addSubcommand((sub) => sub.setName("recent-pivots").setDescription("List recent ownership pivots"))
    .addSubcommand((sub) =>
      sub
        .setName("why")
        .setDescription("Explain a graph entity by stable key")
        .addStringOption((option) => option.setName("entity").setDescription("Graph stable key").setRequired(true))
    ),
];

/** Expose the slash command data to register with Discord. */
export const slashCommandData = commands.map((c) => c.toJSON());

/** Discord client instance.  Only initialised once. */
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

function getConfig() {
  return loadConfig();
}

/**
 * Registers the defined slash commands with a specific guild.  This function
 * should be called at startup to ensure command definitions are in sync.
 */
export async function registerSlashCommands(): Promise<void> {
  const config = getConfig();
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body: slashCommandData }
  );
}

/**
 * Retrieves the standup channel as a TextChannel.  Throws if the channel
 * cannot be found or is not a text channel.
 */
function getTextChannel(channelId: string): TextChannel {
  const channel = client.channels.cache.get(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Discord channel ${channelId} not found or is not a text channel`);
  }
  return channel;
}

/** Sends a message to the configured standup channel. */
export async function sendToStandupChannel(content: string): Promise<void> {
  const config = getConfig();
  const channel = getTextChannel(config.DISCORD_STANDUP_CHANNEL_ID);
  await channel.send(content);
}

export async function sendToMeetingChannel(content: string): Promise<string> {
  if (isDiscordDryRun()) {
    return dryRunMessageUrl("meeting", content);
  }
  const settings = loadAppSettings();
  const channelId =
    process.env.DISCORD_MEETING_CHANNEL_ID ??
    settings.discord.meetingChannelId ??
    process.env.DISCORD_STANDUP_CHANNEL_ID ??
    settings.discord.standupChannelId;
  if (!channelId) {
    throw new Error("No Discord meeting or standup channel is configured");
  }
  const channel = getTextChannel(channelId);
  const message = await channel.send(content);
  return message.url;
}

export async function sendToChannel(channelId: string, content: string): Promise<string> {
  if (isDiscordDryRun()) {
    return dryRunMessageUrl(channelId, content);
  }
  const channel = getTextChannel(channelId);
  const message = await channel.send(content);
  return message.url;
}

function isDiscordDryRun(): boolean {
  return process.env.PERRY_DISCORD_DRY_RUN === "true";
}

function dryRunMessageUrl(channelId: string, content: string): string {
  const digest = Buffer.from(content).toString("base64url").slice(0, 16);
  return `https://discord.example/perry-dry-run/${encodeURIComponent(channelId)}/${digest}`;
}

export async function fetchTextChannelName(channelId: string): Promise<string> {
  const channel = getTextChannel(channelId);
  return channel.name;
}

export async function ensureDiscordReady(): Promise<void> {
  if (client.isReady()) return;
  await new Promise<void>((resolve) => {
    client.once("ready", () => resolve());
  });
}

/** Sends a raw message to the configured standup channel. */
export async function sendRawToStandupChannel(content: string): Promise<void> {
  const config = getConfig();
  const channel = getTextChannel(config.DISCORD_STANDUP_CHANNEL_ID);
  await channel.send(content);
}

/**
 * Handles slash command interactions dispatched from Discord.  Routes each
 * subcommand to the appropriate handler function.
 */
async function handleBrainInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = loadAppSettings();
  if (!hasBrainCommandAccess({ roleIds: interactionRoleIds(interaction), adminRoleIds: settings.discord.adminRoleIds })) {
    await interaction.reply({ content: "You do not have access to Perry brain commands.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case "project": {
      const name = interaction.options.getString("name", true);
      await interaction.reply({ content: await formatEntityContext(`project:${slugKey(name)}`, name), ephemeral: true });
      break;
    }
    case "owner": {
      const name = interaction.options.getString("name", true);
      const entities = await listGraphEntities({ query: name, type: "person", limit: 1 });
      const stableKey = entities.entities[0]?.stableKey ?? `person:${slugKey(name)}`;
      await interaction.reply({ content: await formatEntityContext(stableKey, name), ephemeral: true });
      break;
    }
    case "state": {
      const type = interaction.options.getString("type", true) as CompanyOntologyEntityType;
      await interaction.reply({
        content: formatOntologyState({
          type,
          project: interaction.options.getString("project") ?? undefined,
          q: interaction.options.getString("q") ?? undefined,
          limit: interaction.options.getInteger("limit") ?? undefined,
        }),
        ephemeral: true,
      });
      break;
    }
    case "changed": {
      await interaction.reply({
        content: formatOntologyChangedSince({
          since: interaction.options.getString("since", true),
          project: interaction.options.getString("project") ?? undefined,
          limit: interaction.options.getInteger("limit") ?? undefined,
        }),
        ephemeral: true,
      });
      break;
    }
    case "evidence": {
      await interaction.reply({ content: formatOntologyEvidence(interaction.options.getString("entity", true)), ephemeral: true });
      break;
    }
    case "my-actions": {
      const displayName = interaction.user.globalName ?? interaction.user.username;
      const actions = listActionItems(50).filter(
        (action) => action.status === "open" && action.owner?.toLowerCase().includes(displayName.toLowerCase())
      );
      const lines = actions.slice(0, 8).map((action) => `- ${action.text}${action.dueDate ? ` due ${action.dueDate}` : ""}`);
      await interaction.reply({ content: lines.length ? `Open actions for ${displayName}:\n${lines.join("\n")}` : `No open actions found for ${displayName}.`, ephemeral: true });
      break;
    }
    case "recent-pivots": {
      const pivots = listPivots({ limit: 8 });
      const lines = pivots.map((pivot) => `- ${pivot.subject}: ${pivot.previousOwner ?? "unassigned"} -> ${pivot.newOwner ?? "unassigned"} (${pivot.project ?? "no project"})`);
      await interaction.reply({ content: lines.length ? `Recent pivots:\n${lines.join("\n")}` : "No recent pivots found.", ephemeral: true });
      break;
    }
    case "why": {
      const stableKey = interaction.options.getString("entity", true);
      await interaction.reply({ content: await formatEntityContext(stableKey, stableKey), ephemeral: true });
      break;
    }
    default:
      await interaction.reply({ content: "Unknown brain command", ephemeral: true });
  }
}

async function formatEntityContext(stableKey: string, label: string): Promise<string> {
  const context = await getGraphEntityContext(stableKey, 8);
  if (!context.enabled) return "Graph memory is not enabled.";
  if (context.error) return `Graph read failed: ${context.error}`;
  if (!context.entity) return `No graph entity found for ${label} (${stableKey}).`;
  const facts = context.facts.slice(0, 6).map((row) => {
    const fact = row.fact;
    return `- ${fact?.subjectKey ?? stableKey} ${fact?.relation ?? "RELATES_TO"} ${fact?.objectKey ?? "unknown"}${row.evidence?.excerpt ? `: ${truncate(row.evidence.excerpt, 120)}` : ""}`;
  });
  const retired = context.retirements.length ? `\nRetired facts: ${context.retirements.length}` : "";
  return truncate(`**${context.entity.name ?? stableKey}**\n${facts.length ? facts.join("\n") : "No active facts found."}${retired}`, 1800);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
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

export function hasBrainCommandAccess(input: { roleIds: string[]; adminRoleIds: string[] }): boolean {
  if (input.adminRoleIds.length === 0) return true;
  return input.roleIds.some((roleId) => input.adminRoleIds.includes(roleId));
}

function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member as { roles?: string[] | { cache?: { keys(): IterableIterator<string> } } } | null;
  const roles = member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  return roles.cache ? [...roles.cache.keys()] : [];
}

async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const today = new Date();
  switch (sub) {
    case "missing": {
      const entries = await fetchStandupEntries(today);
      const missing = findMissingStandups(entries, getActiveRoster());
      const content = formatMissing(missing, today);
      await interaction.reply({ content, ephemeral: true });
      break;
    }
    case "summary": {
      const entries = await fetchStandupEntries(today);
      const content = formatSummary(entries, today);
      await interaction.reply({ content });
      break;
    }
    case "remind": {
      const entries = await fetchStandupEntries(today);
      const missing = findMissingStandups(entries, getActiveRoster());
      const content = formatMissing(missing, today);
      await sendToStandupChannel(content);
      await interaction.reply({ content: "Reminder sent.", ephemeral: true });
      break;
    }
    case "link": {
      // Provide a link to the standup form or database.  This should be
      // customised by editing this message or adding a configuration option.
      const config = getConfig();
      await interaction.reply({
        content: config.STANDUP_FORM_URL
          ? `Please submit your standup in Notion: ${config.STANDUP_FORM_URL}`
          : "No standup form URL is configured yet.",
        ephemeral: true,
      });
      break;
    }
    default:
      await interaction.reply({ content: "Unknown subcommand", ephemeral: true });
  }
}

/**
 * Sets up the Discord client event listeners and logs in.  This function
 * returns a promise that resolves once the client is ready.
 */
export async function startDiscord(): Promise<void> {
  const config = getConfig();
  client.once("ready", () => {
    console.log(`Logged in as ${client.user?.tag}`);
  });
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "standup" && interaction.commandName !== "brain") return;
    try {
      if (interaction.commandName === "brain") await handleBrainInteraction(interaction);
      else await handleInteraction(interaction);
    } catch (err) {
      console.error(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "An error occurred.", ephemeral: true });
      }
    }
  });
  await client.login(config.DISCORD_TOKEN);
}


