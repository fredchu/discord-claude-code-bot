import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  Client, GatewayIntentBits, Events,
  REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Message, type Collection, type Snowflake,
} from "discord.js";

// --- ThreadMap ---

type ThreadEntry = {
  sessionId: string;
  cwd: string;
  model: string;
  createdAt: number;
  started: boolean;
  lastBotMessageId?: string;
};

type ThreadMap = Record<string, ThreadEntry>;

const MAP_PATH = path.join(import.meta.dirname, "..", "thread-map.json");

function loadMap(): ThreadMap {
  try {
    return JSON.parse(fs.readFileSync(MAP_PATH, "utf8")) as ThreadMap;
  } catch {
    return {};
  }
}

function saveMap(map: ThreadMap): void {
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
}

function getOrCreate(map: ThreadMap, threadId: string, defaultCwd: string): ThreadEntry {
  if (!map[threadId]) {
    map[threadId] = {
      sessionId: crypto.randomUUID(),
      cwd: defaultCwd,
      model: "opus",
      createdAt: Date.now(),
      started: false,
    };
    saveMap(map);
  }
  return map[threadId];
}

// --- Thread History ---

const SYSTEM_PROMPT = [
  "You are a Discord bot running inside a thread.",
  "Multiple users may be talking in the same thread.",
  "When thread history is provided, use it as context to understand the conversation so far.",
  "Reply naturally as a participant in the group conversation.",
  "IMPORTANT: Do NOT output any session handoff summaries, session recaps, bullet-point preambles, or any meta-commentary about previous sessions at the start of your reply.",
  "Respond directly and immediately to the user's message.",
].join(" ");

const HISTORY_FETCH_LIMIT = 30;

async function fetchThreadHistory(
  channel: Message["channel"],
  entry: ThreadEntry,
  botUserId: string,
): Promise<string> {
  const fetchOpts: { limit: number; after?: string } = { limit: HISTORY_FETCH_LIMIT };
  if (entry.started && entry.lastBotMessageId) {
    fetchOpts.after = entry.lastBotMessageId;
  }

  let messages: Collection<Snowflake, Message>;
  try {
    messages = await channel.messages.fetch(fetchOpts);
  } catch {
    return "";
  }

  if (messages.size === 0) return "";

  const sorted = [...messages.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .filter((m) => m.author.id !== botUserId);

  if (sorted.length === 0) return "";

  const lines = sorted.map((m) => {
    const name = m.member?.displayName ?? m.author.displayName ?? m.author.username;
    const text = m.content.replace(/<@!?\d+>/g, "").trim();
    return text ? `[${name}] ${text}` : null;
  }).filter(Boolean);

  if (lines.length === 0) return "";

  const label = entry.started
    ? "Messages from other users since your last reply"
    : "Recent thread history for context";

  return `[${label}]\n${lines.join("\n")}\n[End]\n\n`;
}

// --- Streaming Runner ---

const running = new Map<string, ChildProcess>();

type StreamCallbacks = {
  onText?: (fullText: string) => void;
  onToolUse?: (toolName: string) => void;
};

type AskQuestion = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};

type PermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: { questions: AskQuestion[] };
};

type RunResult = { text: string; exitCode: number; costUsd?: number; permissionDenials?: PermissionDenial[] };

function runClaudeStreaming(opts: {
  sessionId: string;
  prompt: string;
  cwd: string;
  model: string;
  claudeBin: string;
  resume: boolean;
  systemPrompt?: string;
  timeoutMs?: number;
  callbacks?: StreamCallbacks;
}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", opts.prompt,
      ...(opts.resume ? ["--resume", opts.sessionId] : ["--session-id", opts.sessionId]),
      "--model", opts.model,
      "--dangerously-skip-permissions",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...(opts.systemPrompt ? ["--system-prompt", opts.systemPrompt] : []),
    ];

    const child = spawn(opts.claudeBin, args, {
      cwd: opts.cwd,
      env: { ...process.env, CLAUDECODE: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });

    running.set(opts.sessionId, child);

    let buffer = "";
    let lastSeenText = "";
    let resultText = "";
    let costUsd: number | undefined;
    let permissionDenials: PermissionDenial[] | undefined;
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === "assistant" && event.message?.content) {
            let messageText = "";
            for (const block of event.message.content) {
              if (block.type === "text") {
                messageText += block.text || "";
              } else if (block.type === "tool_use" && block.name) {
                opts.callbacks?.onToolUse?.(block.name);
              }
            }
            if (messageText && messageText !== lastSeenText) {
              lastSeenText = messageText;
              opts.callbacks?.onText?.(messageText);
            }
          }

          if (event.type === "result") {
            resultText = event.result || "";
            costUsd = event.total_cost_usd;
            if (event.permission_denials?.length > 0) {
              permissionDenials = event.permission_denials;
            }
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    });

    const timeout = opts.timeoutMs ?? 1_800_000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      running.delete(opts.sessionId);
      child.kill("SIGTERM");
      const partial = resultText || lastSeenText || "";
      if (partial) {
        resolve({
          text: partial + "\n\n⚠️ *Task timed out after 30 min — partial result above.*",
          exitCode: 124,
          costUsd,
        });
      } else {
        reject(new Error(`Timeout after ${timeout}ms with no output`));
      }
    }, timeout);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(opts.sessionId);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(opts.sessionId);
      const text = resultText || lastSeenText || "(no output)";
      resolve({ text, exitCode: code ?? 1, costUsd, permissionDenials });
    });
  });
}

// --- AskUserQuestion button rendering ---

async function sendAskButtons(
  channel: { send: (opts: any) => Promise<Message> },
  entry: ThreadEntry,
  denial: PermissionDenial,
): Promise<void> {
  for (const q of denial.tool_input.questions) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const opt of q.options.slice(0, 4)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ask_${entry.sessionId}_${opt.label}`.slice(0, 100))
          .setLabel(opt.label)
          .setStyle(ButtonStyle.Primary),
      );
    }
    if (q.options.length <= 3) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ask_${entry.sessionId}_OTHER`)
          .setLabel("Other...")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    const botReply = await channel.send({
      content: `❓ **${q.question}**`,
      components: [row],
    });
    entry.lastBotMessageId = botReply.id;
  }
  saveMap(threadMap);
}

// --- Streaming tool-use callback ---

function createToolUseHandler(ps: PreviewState): (toolName: string) => void {
  return (toolName) => {
    console.log(`[discord-cc-bot] tool: ${toolName}`);
    ps.toolsUsed.push(toolName);
    if (ps.msg) {
      const text = (ps.pendingText || "").slice(0, PREVIEW_MAX_LEN);
      ps.msg.edit(text + buildStatusLine(ps)).catch(() => {});
    }
  };
}

// --- Chunked message sending ---

const DISCORD_MAX_LEN = 2000;
const CHUNK_LEN = 1900;

async function sendChunked(
  channel: { send: (content: string) => Promise<Message> },
  text: string,
  replyTo?: Message,
): Promise<Message> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_LEN) {
    chunks.push(text.slice(i, i + CHUNK_LEN));
  }

  let firstMsg: Message | undefined;
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0 && replyTo) {
      firstMsg = await replyTo.reply(chunks[i]);
    } else {
      const msg = await channel.send(chunks[i]);
      if (i === 0) firstMsg = msg;
    }
  }
  return firstMsg!;
}

// --- Streaming preview throttle ---

const STREAM_THROTTLE_MS = 1500;
const STREAM_MIN_DELTA = 40;
const PREVIEW_MAX_LEN = 1900;

type PreviewState = {
  msg: Message | null;
  lastText: string;
  lastEditTime: number;
  timer: NodeJS.Timeout | null;
  pendingText: string;
  startTime: number;
  toolsUsed: string[];
};

function createPreviewState(): PreviewState {
  return { msg: null, lastText: "", lastEditTime: 0, timer: null, pendingText: "", startTime: Date.now(), toolsUsed: [] };
}

function formatElapsed(startTime: number): string {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
}

function buildStatusLine(ps: PreviewState): string {
  const time = formatElapsed(ps.startTime);
  const toolLine = ps.toolsUsed.length > 0
    ? `🔧 ${ps.toolsUsed.slice(-3).join(" → ")}\n` : "";
  return `\n\n${toolLine}⏳ *working... (${time})*`;
}

function flushPreview(ps: PreviewState): void {
  if (!ps.msg || !ps.pendingText) return;
  const display = ps.pendingText.slice(0, PREVIEW_MAX_LEN) + buildStatusLine(ps);
  ps.msg.edit(display).catch(() => {});
  ps.lastText = ps.pendingText;
  ps.lastEditTime = Date.now();
}

function handleStreamText(ps: PreviewState, fullText: string): void {
  ps.pendingText = fullText;

  const delta = fullText.length - ps.lastText.length;
  const elapsed = Date.now() - ps.lastEditTime;

  // Not enough new content
  if (delta < STREAM_MIN_DELTA && ps.lastEditTime > 0) {
    if (!ps.timer) {
      ps.timer = setTimeout(() => {
        ps.timer = null;
        flushPreview(ps);
      }, STREAM_THROTTLE_MS);
    }
    return;
  }

  // Too soon since last edit
  if (elapsed < STREAM_THROTTLE_MS && ps.lastEditTime > 0) {
    if (!ps.timer) {
      ps.timer = setTimeout(() => {
        ps.timer = null;
        flushPreview(ps);
      }, STREAM_THROTTLE_MS - elapsed);
    }
    return;
  }

  // Enough content & time — flush immediately
  if (ps.timer) clearTimeout(ps.timer);
  flushPreview(ps);
}

// --- Discord ---

const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const DEFAULT_CWD = process.env.DEFAULT_CWD ?? process.cwd();
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const GUILD_ID = process.env.GUILD_ID;

const slashCommands = [
  new SlashCommandBuilder().setName("help").setDescription("Show available commands"),
  new SlashCommandBuilder().setName("new").setDescription("Clear context — start a new conversation (thread only)"),
  new SlashCommandBuilder().setName("model").setDescription("Switch Claude model")
    .addStringOption(o => o.setName("name").setDescription("Model name (e.g. sonnet, opus, haiku)").setRequired(true)),
  new SlashCommandBuilder().setName("cd").setDescription("Switch working directory")
    .addStringOption(o => o.setName("path").setDescription("Absolute path to directory").setRequired(true)),
  new SlashCommandBuilder().setName("stop").setDescription("Kill running Claude process (thread only)"),
  new SlashCommandBuilder().setName("sessions").setDescription("List all active sessions"),
];

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

const threadMap = loadMap();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[discord-cc-bot] ready as ${c.user.tag}`);
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(c.user.id, GUILD_ID)
      : Routes.applicationCommands(c.user.id);
    await rest.put(route, {
      body: slashCommands.map(cmd => cmd.toJSON()),
    });
    console.log(`[discord-cc-bot] registered ${slashCommands.length} slash commands`);
  } catch (err) {
    console.error("[discord-cc-bot] failed to register commands:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // --- Button handler ---
  if (interaction.isButton()) {
    const id = interaction.customId;
    console.log(`[discord-cc-bot] button: ${id} by ${interaction.user.username}`);

    // AskUserQuestion buttons: ask_<sessionId>_<answer>
    if (id.startsWith("ask_")) {
      const parts = id.split("_");
      const sessionId = parts[1];
      const answer = parts.slice(2).join("_");
      const threadId = interaction.channelId;
      const entry = threadMap[threadId];

      if (answer === "OTHER") {
        await interaction.reply({ content: "Type your answer as a regular message:", ephemeral: true });
        return;
      }

      await interaction.update({ content: `✅ **${answer}**`, components: [] });

      // Resume claude with the answer
      if (entry && !running.has(entry.sessionId)) {
        const ch = interaction.channel!;
        if (!("send" in ch)) return;
        const previewState = createPreviewState();
        previewState.msg = await ch.send("⏳ *Continuing...*");

        try {
          const result = await runClaudeStreaming({
            sessionId: entry.sessionId,
            prompt: `I choose: ${answer}`,
            cwd: entry.cwd,
            model: entry.model,
            claudeBin: CLAUDE_BIN,
            resume: true,
            systemPrompt: SYSTEM_PROMPT,
            callbacks: {
              onText: (fullText) => handleStreamText(previewState, fullText),
              onToolUse: createToolUseHandler(previewState),
            },
          });

          if (previewState.timer) clearTimeout(previewState.timer);

          // Check for AskUserQuestion denials — render as Discord buttons
          const askDenial = result.permissionDenials?.find(d => d.tool_name === "AskUserQuestion");
          if (askDenial) {
            await previewState.msg!.delete().catch(() => {});
            await sendAskButtons(ch, entry, askDenial);
            return;
          }

          await previewState.msg!.delete().catch(() => {});
          let botReply: Message = await ch.send(result.text.slice(0, DISCORD_MAX_LEN));
          entry.lastBotMessageId = botReply.id;
          saveMap(threadMap);
        } catch (err) {
          if (previewState.timer) clearTimeout(previewState.timer);
          if (previewState.msg) await previewState.msg.edit(`Error: ${(err as Error).message}`).catch(() => {});
        }
      }
      return;
    }

    // Test buttons (temporary)
    if (id.startsWith("test_")) {
      const choice = id.replace("test_", "");
      console.log(`[discord-cc-bot] test button: ${choice}`);
      await interaction.update({
        content: `✅ **你選了：${choice}**\n\nBot 收到了你的選擇！按鈕互動成功。`,
        components: [],
      });
      return;
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === "help") {
      await interaction.reply({
        content: [
          "`/new` — clear context, start new conversation (thread only)",
          "`/model <name>` — switch model (e.g. sonnet, opus, haiku)",
          "`/cd <path>` — switch working directory",
          "`/stop` — kill running task (thread only)",
          "`/sessions` — list all sessions",
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (commandName === "new") {
      if (!interaction.channel?.isThread()) {
        await interaction.reply({ content: "This command only works in threads.", ephemeral: true });
        return;
      }
      const threadId = interaction.channelId;
      const entry = getOrCreate(threadMap, threadId, DEFAULT_CWD);
      entry.sessionId = crypto.randomUUID();
      entry.started = false;
      saveMap(threadMap);
      await interaction.reply({ content: "Context cleared. Next message starts a new conversation.", ephemeral: true });
      return;
    }

    if (commandName === "model") {
      const name = interaction.options.getString("name", true);
      if (!interaction.channel?.isThread()) {
        await interaction.reply({ content: "This command only works in threads.", ephemeral: true });
        return;
      }
      const threadId = interaction.channelId;
      const entry = getOrCreate(threadMap, threadId, DEFAULT_CWD);
      entry.model = name;
      saveMap(threadMap);
      await interaction.reply({ content: `Model -> \`${name}\``, ephemeral: true });
      return;
    }

    if (commandName === "cd") {
      const dir = interaction.options.getString("path", true);
      if (!fs.existsSync(dir)) {
        await interaction.reply({ content: `Path not found: \`${dir}\``, ephemeral: true });
        return;
      }
      if (!interaction.channel?.isThread()) {
        await interaction.reply({ content: "This command only works in threads.", ephemeral: true });
        return;
      }
      const threadId = interaction.channelId;
      const entry = getOrCreate(threadMap, threadId, DEFAULT_CWD);
      entry.cwd = dir;
      saveMap(threadMap);
      await interaction.reply({ content: `cwd -> \`${dir}\``, ephemeral: true });
      return;
    }

    if (commandName === "stop") {
      if (!interaction.channel?.isThread()) {
        await interaction.reply({ content: "This command only works in threads.", ephemeral: true });
        return;
      }
      const threadId = interaction.channelId;
      const entry = threadMap[threadId];
      if (entry && running.has(entry.sessionId)) {
        running.get(entry.sessionId)!.kill("SIGTERM");
        await interaction.reply({ content: "Stopped.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Nothing running.", ephemeral: true });
      }
      return;
    }

    if (commandName === "sessions") {
      const lines = Object.entries(threadMap).map(
        ([tid, e]) => `<#${tid}> | ${e.model} | \`${e.cwd}\``,
      );
      await interaction.reply({
        content: lines.length ? lines.join("\n") : "No sessions.",
        ephemeral: true,
      });
      return;
    }
  } catch (err) {
    console.error("[discord-cc-bot] interaction error:", (err as Error).message);
    if (!interaction.replied) {
      await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    // Only respond in threads, and only when mentioned
    if (!message.channel.isThread()) return;
    if (!message.mentions.has(client.user!.id)) return;

    const content = message.content.replace(/<@!?\d+>/g, "").trim();
    if (!content) return;

    const threadId = message.channelId;
    const entry = getOrCreate(threadMap, threadId, DEFAULT_CWD);

    if (running.has(entry.sessionId)) {
      await message.reply("Previous task still running. Use `/stop` first.");
      return;
    }

    // Send initial preview message
    const previewState = createPreviewState();
    previewState.msg = await message.reply("⏳ *Thinking...*");

    try {
      const history = await fetchThreadHistory(message.channel, entry, client.user!.id);
      const prompt = history ? `${history}${content}` : content;

      const result = await runClaudeStreaming({
        sessionId: entry.sessionId,
        prompt,
        cwd: entry.cwd,
        model: entry.model,
        claudeBin: CLAUDE_BIN,
        resume: entry.started,
        systemPrompt: SYSTEM_PROMPT,
        callbacks: {
          onText: (fullText) => handleStreamText(previewState, fullText),
          onToolUse: createToolUseHandler(previewState),
        },
      });

      // Cancel any pending throttle timer
      if (previewState.timer) clearTimeout(previewState.timer);

      // Check for AskUserQuestion denials — render as Discord buttons
      const askDenial = result.permissionDenials?.find(d => d.tool_name === "AskUserQuestion");
      if (askDenial) {
        await previewState.msg!.delete().catch(() => {});
        entry.started = true;
        await sendAskButtons(message.channel, entry, askDenial);
        return; // Wait for button click — handler will resume
      }

      const isFirstReply = !entry.started;
      if (isFirstReply) {
        entry.started = true;
      }

      const disclosure = isFirstReply
        ? "*I'm Claude, an AI assistant by Anthropic.*\n\n"
        : "";
      const responseText = `${disclosure}${result.text}`;

      // Final delivery — always delete preview and send new message
      // so Discord sends a push notification for the completed reply.
      let botReply: Message;
      try {
        await previewState.msg!.delete().catch(() => {});
        if (responseText.length <= DISCORD_MAX_LEN) {
          botReply = await message.reply(responseText);
        } else {
          botReply = await sendChunked(message.channel, responseText, message);
        }
      } catch (replyErr) {
        console.error("[discord-cc-bot] reply failed, trying fallback:", (replyErr as Error).message);
        botReply = await message.channel.send(responseText.slice(0, DISCORD_MAX_LEN));
      }

      entry.lastBotMessageId = botReply.id;
      saveMap(threadMap);
    } catch (err) {
      if (previewState.timer) clearTimeout(previewState.timer);
      if (previewState.msg) {
        await previewState.msg.edit(`Error: ${(err as Error).message}`).catch(() => {});
      } else {
        await message.reply(`Error: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error("[discord-cc-bot] handler error:", (err as Error).message);
  }
});

process.on("SIGINT", () => {
  for (const child of running.values()) child.kill("SIGTERM");
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
