const { slashCommandData } = require("../dist/discord/client.js");
const { createMeetingNotePage } = require("../dist/notion/meetings.js");
const {
  syncActionItemRecordToNotion,
  syncDecisionRecordToNotion,
  syncProjectRecordToNotion,
} = require("../dist/notion/wiki-sync.js");

const args = new Set(process.argv.slice(2));
const realNotion = args.has("--real-notion");
const realDiscord = args.has("--real-discord");
const strict = args.has("--strict");
const postDiscord = realDiscord && (args.has("--post-discord") || args.has("--post"));
const registerDiscord = realDiscord && args.has("--register-discord");

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const checks = [];
  process.env.PERRY_NOTION_DRY_RUN = realNotion ? "false" : "true";
  process.env.PERRY_DISCORD_DRY_RUN = realDiscord ? "false" : "true";

  checks.push(checkSlashCommands());
  checks.push(await checkNotionWikiWrites());
  checks.push(await checkNotionMeetingWrite());
  checks.push(await checkDiscordSandbox());

  for (const check of checks) console.log(`${check.ok ? "PASS" : "WARN"} ${check.name}: ${check.detail}`);
  if (strict && checks.some((check) => !check.ok)) process.exit(1);
}

function checkSlashCommands() {
  const names = slashCommandData.map((command) => command.name).sort();
  const brain = slashCommandData.find((command) => command.name === "brain");
  const brainSubcommands = (brain?.options ?? []).map((option) => option.name).sort();
  const expectedBrain = ["my-actions", "owner", "project", "recent-pivots", "why"];
  const ok = names.includes("brain") && names.includes("standup") && expectedBrain.every((name) => brainSubcommands.includes(name));
  return { name: "discord slash command contract", ok, detail: ok ? `${names.join(", ")} / brain:${brainSubcommands.join(",")}` : "missing expected command definitions" };
}

async function checkNotionWikiWrites() {
  try {
    if (realNotion) {
      const missing = requiredEnv(["NOTION_TOKEN", "NOTION_DECISIONS_DATA_SOURCE_ID", "NOTION_ACTION_ITEMS_DATA_SOURCE_ID", "NOTION_PROJECTS_DATA_SOURCE_ID"]);
      if (missing.length) return warn("notion wiki writes", `missing ${missing.join(", ")}`);
    }

    const decision = await syncDecisionRecordToNotion({
      id: `sandbox-decision-${Date.now()}`,
      meetingId: "sandbox-meeting",
      text: "Perry sandbox verification confirms Notion wiki write contracts.",
      status: "accepted",
      createdAt: new Date().toISOString(),
    });
    const action = await syncActionItemRecordToNotion({
      id: `sandbox-action-${Date.now()}`,
      meetingId: "sandbox-meeting",
      text: "Verify the Perry Discord sandbox command surface.",
      owner: "Perry",
      status: "open",
      createdAt: new Date().toISOString(),
    });
    const project = await syncProjectRecordToNotion({ project: "Perry Sandbox", owner: "Perry", status: "open" });
    const records = [decision, action, project].filter(Boolean);
    const ok = records.length === 3 && records.every((record) => Boolean(record.id));
    return {
      name: realNotion ? "notion wiki real writes" : "notion wiki dry-run writes",
      ok,
      detail: records.map((record) => `${record.kind}:${record.id}`).join(", ") || "no records returned",
    };
  } catch (error) {
    return warn(realNotion ? "notion wiki real writes" : "notion wiki dry-run writes", errorMessage(error));
  }
}

async function checkNotionMeetingWrite() {
  try {
    if (realNotion) {
      const missing = requiredEnv(["NOTION_TOKEN", "NOTION_MEETING_NOTES_DATA_SOURCE_ID"]);
      if (missing.length) return warn("notion meeting write", `missing ${missing.join(", ")}`);
    }

    const page = await createMeetingNotePage(sampleMeetingNote());
    return {
      name: realNotion ? "notion meeting real write" : "notion meeting dry-run write",
      ok: Boolean(page?.id),
      detail: page?.url ?? page?.id ?? "no page returned",
    };
  } catch (error) {
    return warn(realNotion ? "notion meeting real write" : "notion meeting dry-run write", errorMessage(error));
  }
}

async function checkDiscordSandbox() {
  try {
    if (!realDiscord) {
      const digest = Buffer.from(sampleDiscordMessage()).toString("base64url").slice(0, 16);
      return { name: "discord dry-run post", ok: true, detail: `https://discord.example/perry-dry-run/sandbox/${digest}` };
    }

    const missing = requiredEnv(["DISCORD_TOKEN"]);
    if (missing.length) return warn("discord sandbox", `missing ${missing.join(", ")}`);
    const bot = await discordFetch("/users/@me");
    const results = [`bot:${bot.username ?? bot.id}`];

    if (registerDiscord) {
      const registrationMissing = requiredEnv(["DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]);
      if (registrationMissing.length) return warn("discord command registration", `missing ${registrationMissing.join(", ")}`);
      await discordFetch(`/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`, {
        method: "PUT",
        body: JSON.stringify(slashCommandData),
      });
      results.push("registered:guild-commands");
    }

    if (postDiscord) {
      const channelId = process.env.DISCORD_SANDBOX_CHANNEL_ID ?? process.env.DISCORD_MEETING_CHANNEL_ID ?? process.env.DISCORD_STANDUP_CHANNEL_ID;
      if (!channelId) return warn("discord sandbox post", "missing DISCORD_SANDBOX_CHANNEL_ID or meeting/standup channel id");
      const message = await discordFetch(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: sampleDiscordMessage() }),
      });
      results.push(`message:${message.id}`);
    }

    return { name: "discord real sandbox", ok: true, detail: results.join(", ") };
  } catch (error) {
    return warn(realDiscord ? "discord real sandbox" : "discord dry-run post", errorMessage(error));
  }
}

async function discordFetch(path, init = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function sampleMeetingNote() {
  return {
    source: "granola",
    sourceId: `sandbox-${Date.now()}`,
    title: "Perry Sandbox Integration Check",
    creatorName: "Perry",
    attendees: [{ name: "Perry" }],
    calendarTitle: "Perry Sandbox Integration Check",
    folderName: "Perry",
    startedAt: new Date().toISOString(),
    summaryMarkdown: "Decisions:\n- Perry sandbox verification should stay safe by default.\n\nAction items:\n- Perry: Confirm Notion and Discord sandbox wiring.",
    sourceUrl: "https://granola.example/perry-sandbox",
  };
}

function sampleDiscordMessage() {
  return "Perry sandbox verification: dry-run safe by default; real posts require --real-discord --post-discord.";
}

function requiredEnv(keys) {
  return keys.filter((key) => !process.env[key]);
}

function warn(name, detail) {
  return { name, ok: false, detail };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
