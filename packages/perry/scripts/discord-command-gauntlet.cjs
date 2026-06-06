const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const args = parseArgs(process.argv.slice(2));
const reportPath = args.report || "";
const markdownPath = args.markdown || "";
const live = args.live === "true";
const register = args.register === "true";

const { REST, Routes } = require("discord.js");
const { slashCommandData } = require("../dist/discord/client.js");

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  const checks = [
    check("local_commands_present", slashCommandData.length >= 2, `${slashCommandData.length} commands`),
    ...validateLocalCommands(slashCommandData),
  ];

  let remote;
  if (live || register) {
    const config = readDiscordConfig();
    const rest = new REST({ version: "10" }).setToken(config.token);
    if (register) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: slashCommandData });
      checks.push(check("registered_commands", true, `guild ${config.guildId}`));
    }
    remote = await rest.get(Routes.applicationGuildCommands(config.clientId, config.guildId));
    checks.push(...compareRemoteCommands(slashCommandData, Array.isArray(remote) ? remote : []));
  }

  const output = {
    ok: checks.every((item) => item.passed),
    mode: register ? "register" : live ? "live-compare" : "local",
    commandCount: slashCommandData.length,
    brainSubcommands: commandByName(slashCommandData, "brain")?.options?.map((item) => item.name) ?? [],
    checks,
  };
  console.log(JSON.stringify(output, null, 2));
  if (reportPath) writeJson(reportPath, output);
  if (markdownPath) writeMarkdown(markdownPath, output);
  if (!output.ok) process.exitCode = 2;
}

function validateLocalCommands(commands) {
  const checks = [];
  const standup = commandByName(commands, "standup");
  const brain = commandByName(commands, "brain");
  checks.push(check("standup_command_present", Boolean(standup), "standup"));
  checks.push(check("brain_command_present", Boolean(brain), "brain"));
  checks.push(checkSubcommands("standup_subcommands", standup, ["link", "missing", "remind", "summary"]));
  checks.push(
    checkSubcommands("brain_subcommands", brain, [
      "changed",
      "evidence",
      "my-actions",
      "owner",
      "project",
      "recent-pivots",
      "state",
      "why",
    ])
  );
  const state = subcommandByName(brain, "state");
  const typeOption = state?.options?.find((option) => option.name === "type");
  const choices = typeOption?.choices?.map((choice) => choice.value).sort() ?? [];
  checks.push(
    check(
      "brain_state_type_choices",
      sameList(choices, ["artifact", "benchmark_report", "blocker", "capability", "feature", "goal", "metric", "open_question", "risk"]),
      choices.join(", ")
    )
  );
  checks.push(check("brain_changed_since_required", requiredOption(subcommandByName(brain, "changed"), "since"), "since"));
  checks.push(check("brain_evidence_entity_required", requiredOption(subcommandByName(brain, "evidence"), "entity"), "entity"));
  return checks;
}

function compareRemoteCommands(local, remote) {
  const checks = [];
  for (const localCommand of local) {
    const remoteCommand = commandByName(remote, localCommand.name);
    checks.push(check(`remote_${localCommand.name}_present`, Boolean(remoteCommand), localCommand.name));
    checks.push(
      checkSubcommands(
        `remote_${localCommand.name}_subcommands`,
        remoteCommand,
        (localCommand.options ?? []).map((option) => option.name).sort()
      )
    );
  }
  return checks;
}

function checkSubcommands(name, command, expected) {
  const actual = (command?.options ?? []).map((option) => option.name).sort();
  return check(name, sameList(actual, expected), actual.join(", "));
}

function requiredOption(command, optionName) {
  return Boolean(command?.options?.find((option) => option.name === optionName && option.required === true));
}

function commandByName(commands, name) {
  return commands.find((command) => command.name === name);
}

function subcommandByName(command, name) {
  return command?.options?.find((option) => option.name === name);
}

function sameList(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function check(name, passed, detail) {
  return { name, passed, detail };
}

function readDiscordConfig() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const missing = [
    ["DISCORD_TOKEN", token],
    ["DISCORD_CLIENT_ID", clientId],
    ["DISCORD_GUILD_ID", guildId],
  ].filter(([, value]) => !value);
  if (missing.length) throw new Error(`Missing Discord env for live command gauntlet: ${missing.map(([key]) => key).join(", ")}`);
  return { token, clientId, guildId };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    parsed[key] = inline ?? values[index + 1] ?? "true";
    if (inline === undefined && values[index + 1] && !values[index + 1].startsWith("--")) index += 1;
  }
  return parsed;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# Discord Command Gauntlet",
    "",
    `- OK: ${value.ok}`,
    `- Mode: ${value.mode}`,
    `- Commands: ${value.commandCount}`,
    `- Brain subcommands: ${value.brainSubcommands.join(", ")}`,
    "",
    "## Checks",
    "",
    ...value.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.name}: ${item.detail ?? ""}`),
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}
