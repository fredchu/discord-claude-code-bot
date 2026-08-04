import fs from "node:fs/promises";
import process from "node:process";
import { Client, GatewayIntentBits } from "discord.js";

function usage() {
  console.error("Usage: node --env-file=.env scripts/send-message.mjs <channelId> [--dry] [--text <content> | --file <path>]");
}

function parseArgs(argv) {
  const options = {
    channelId: undefined,
    dry: false,
    text: undefined,
    file: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry") {
      options.dry = true;
    } else if (arg === "--text") {
      i += 1;
      if (i >= argv.length) throw new Error("Missing value for --text");
      options.text = argv[i];
    } else if (arg.startsWith("--text=")) {
      options.text = arg.slice("--text=".length);
    } else if (arg === "--file") {
      i += 1;
      if (i >= argv.length) throw new Error("Missing value for --file");
      options.file = argv[i];
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.channelId) {
      options.channelId = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.channelId) {
    usage();
    process.exit(1);
  }

  if (options.text !== undefined && options.file !== undefined) {
    throw new Error("Use only one message source: --text or --file");
  }

  return options;
}

async function readStdin() {
  let content = "";
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    content += chunk;
  }

  return content;
}

function describeChannel(channel) {
  const isThread = typeof channel.isThread === "function" && channel.isThread();
  const name = "name" in channel ? channel.name : "(unnamed)";
  const parentId = isThread ? channel.parentId ?? "(none)" : "(n/a)";

  console.log(`Channel: type=${channel.type} thread=${isThread} name=${name} id=${channel.id} parentId=${parentId}`);
}

let client;

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("Missing DISCORD_TOKEN");
    process.exit(1);
  }

  const options = parseArgs(process.argv.slice(2));
  let content = "";

  if (!options.dry) {
    if (options.text !== undefined) {
      content = options.text;
    } else if (options.file !== undefined) {
      content = await fs.readFile(options.file, "utf8");
    } else {
      content = await readStdin();
    }

    if (!content) {
      throw new Error("Message content is empty");
    }
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);

  const channel = await client.channels.fetch(options.channelId);
  if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased() || typeof channel.send !== "function") {
    throw new Error(`Channel ${options.channelId} was not found or is not text-based`);
  }

  describeChannel(channel);

  if (options.dry) {
    client.destroy();
    return;
  }

  const sent = await channel.send(content);
  const guildId = channel.guildId ?? channel.guild?.id;

  if (guildId) {
    console.log(`Sent message ${sent.id}`);
    console.log(`Jump URL: https://discord.com/channels/${guildId}/${channel.id}/${sent.id}`);
  } else {
    console.log(`Sent message ${sent.id}`);
  }

  client.destroy();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (client) client.destroy();
  process.exit(1);
}
