/**
 * The discord.js gateway adapter for the `/standup` slash command.
 *
 * Thin glue: open a gateway connection, and on each `/standup` interaction adapt
 * the real ChatInputCommandInteraction to the transport-agnostic
 * StandupInteraction the (tested) handler in commands.ts expects. No public URL
 * is needed — the bot connects outbound, so it runs anywhere `serve` runs.
 *
 * Slash-command interactions arrive over the gateway with no privileged intents,
 * so we request only `Guilds`.
 */
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import type { Config, Secrets } from './config.js';
import { handleStandupCommand, STANDUP_COMMAND_NAME, type StandupInteraction } from './commands.js';
import { EMBEDS_PER_MESSAGE } from './discord.js';

export interface BotOptions {
  log?: (msg: string) => void;
}

export interface BotHandle {
  stop: () => Promise<void>;
}

/** Connect the gateway bot and start answering `/standup`. */
export async function startBot(
  config: Config,
  secrets: Secrets,
  opts: BotOptions = {},
): Promise<BotHandle> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
  const token = secrets.discordBotToken;
  if (!token) throw new Error('inky: no DISCORD_BOT_TOKEN set for the /standup bot.');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    log(`inky: bot online as ${c.user.tag}. /${STANDUP_COMMAND_NAME} is ready.`);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== STANDUP_COMMAND_NAME) return;
    // This listener is fire-and-forget: an unhandled rejection here would crash
    // the process (Node's default), so contain everything.
    try {
      await handleStandupCommand(adapt(interaction, log), config, secrets, { log });
    } catch (err) {
      log(`inky: /${STANDUP_COMMAND_NAME} handler error: ${(err as Error).message}`);
    }
  });

  client.on(Events.Error, (err) => log(`inky: bot error: ${err.message}`));

  await client.login(token);
  return {
    stop: async () => {
      await client.destroy();
      log('inky: bot stopped.');
    },
  };
}

/** Adapt a real discord.js interaction to the handler's narrow view. */
function adapt(interaction: ChatInputCommandInteraction, log: (msg: string) => void): StandupInteraction {
  // Set at defer time and reused for follow-ups: the deferred reply (and its
  // editReply) is already ephemeral, but each follow-up must opt in explicitly.
  let ephemeral = false;
  return {
    getString: (name) => interaction.options.getString(name),
    getInteger: (name) => interaction.options.getInteger(name),
    getBoolean: (name) => interaction.options.getBoolean(name),
    user: interaction.user.username,
    defer: async (eph) => {
      ephemeral = eph;
      await interaction.deferReply(eph ? { flags: MessageFlags.Ephemeral } : {});
    },
    respond: async (embeds) => {
      // editReply takes the first batch; the rest go as follow-ups (10/message).
      // A follow-up failure shouldn't unwind into the build-error path and post
      // "couldn't build the standup" on top of an already-delivered standup.
      await interaction.editReply({ embeds: embeds.slice(0, EMBEDS_PER_MESSAGE) });
      for (let i = EMBEDS_PER_MESSAGE; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
        try {
          await interaction.followUp({
            embeds: embeds.slice(i, i + EMBEDS_PER_MESSAGE),
            ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
          });
        } catch (err) {
          log(`inky: follow-up embed batch failed: ${(err as Error).message}`);
        }
      }
    },
    respondError: async (message) => {
      await interaction.editReply({ content: message });
    },
  };
}
