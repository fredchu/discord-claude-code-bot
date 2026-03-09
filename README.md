# discord-claude-code-bot

A lightweight Discord bot that bridges Discord threads to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions. Single file, ~400 lines of TypeScript. Mention the bot in a thread, and it spawns a Claude Code process that persists across messages via `--resume`.

## Features

- **Thread sessions** — each Discord thread maps to a Claude Code session with automatic `--resume`
- **Thread context** — fetches recent messages so Claude understands the conversation
- **Slash commands** — `/new`, `/model`, `/cd`, `/stop`, `/sessions`, `/help`
- **Model switching** — swap between opus, sonnet, haiku per thread
- **Long responses** — replies over 1500 chars are sent as `.txt` attachments
- **Typing indicator** — shows "typing..." while Claude is working
- **AI disclosure** — first reply in each session includes an AI disclosure message

## Quick Start

```bash
git clone https://github.com/fredchu/discord-claude-code-bot.git
cd discord-claude-code-bot
cp .env.example .env   # fill in your values
npm install
npm start
```

### Prerequisites

- Node.js 22+ (uses `--env-file` flag)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Discord Bot Setup

1. Create a new application in the Discord Developer Portal
2. Go to **Bot** → enable **Message Content Intent**
3. Go to **OAuth2** → URL Generator → select `bot` + `applications.commands`
4. Required bot permissions: Send Messages, Read Message History, Attach Files, Use Slash Commands
5. Use the generated URL to invite the bot to your server

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `GUILD_ID` | No | Server ID for instant slash command registration. Without it, global commands can take up to 1 hour to propagate. |
| `DEFAULT_CWD` | No | Default working directory for Claude Code (defaults to `process.cwd()`) |
| `CLAUDE_BIN` | No | Path to Claude Code binary (defaults to `claude`) |

## Architecture

```
Discord Thread          Bot (this repo)           Claude Code CLI
─────────────          ────────────────           ───────────────
@mention msg  ────►  fetch thread history
                     build prompt
                     spawn claude -p ──────────►  --session-id UUID
                                                  (or --resume UUID)
              ◄────  collect stdout
reply / .txt         send to thread     ◄────────  response
```

Single-file architecture (`src/index.ts`, ~400 LOC). Session state is persisted in `thread-map.json` — a simple mapping from Discord thread ID to Claude Code session UUID.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` | Clear context, start a new conversation (thread only) |
| `/model <name>` | Switch Claude model (e.g. sonnet, opus, haiku) |
| `/cd <path>` | Switch working directory |
| `/stop` | Kill running Claude process (thread only) |
| `/sessions` | List all active sessions |

## System Prompt

The bot injects a system prompt that tells Claude it's running inside a Discord thread with multiple users. You can customize it by editing the `SYSTEM_PROMPT` constant in `src/index.ts`.

## Advanced Usage: Terminal Takeover

Each thread maps to a standard Claude Code session. You can resume any bot session from your terminal:

```bash
# find the session ID from thread-map.json
cat thread-map.json | jq '."<thread-id>".sessionId'

# resume in interactive mode
claude --resume <session-id>
```

This gives you the same "brain" — Claude remembers everything from the Discord thread. You get the full interactive experience (diff review, permission confirmations, tool use) while the Discord thread stays as-is.

**Use case:** Start a task from Discord on your phone → walk to your desk → resume in terminal for precise control → go back to Discord to report results. One session, two entry points.

Note: messages sent in terminal won't appear in the Discord thread (and vice versa), but Claude's memory spans both.

## Roadmap

- [ ] [ACP (Agent Client Protocol)](https://github.com/agentclientprotocol/agent-client-protocol) support for multi-agent bridging
- [ ] Streaming responses
- [ ] Multi-guild support

## License

MIT

---

# discord-claude-code-bot

一個輕量的 Discord 機器人，將 Discord 討論串橋接到 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI。單一檔案、約 400 行 TypeScript。在討論串中 @mention 機器人，它會啟動一個 Claude Code 程序，並透過 `--resume` 在訊息之間保持上下文。

## 功能特色

- **討論串 Session** — 每個 Discord 討論串對應一個 Claude Code session，自動 `--resume`
- **討論串上下文** — 擷取近期訊息讓 Claude 理解對話脈絡
- **斜線指令** — `/new`、`/model`、`/cd`、`/stop`、`/sessions`、`/help`
- **模型切換** — 每個討論串可獨立切換 opus、sonnet、haiku
- **長回覆處理** — 超過 1500 字的回覆以 `.txt` 附件發送
- **輸入指示器** — Claude 處理時顯示「正在輸入...」
- **AI 揭露聲明** — 每個 session 的第一則回覆包含 AI 身份說明

## 快速開始

```bash
git clone https://github.com/fredchu/discord-claude-code-bot.git
cd discord-claude-code-bot
cp .env.example .env   # 填入你的設定值
npm install
npm start
```

### 前置需求

- Node.js 22+（使用 `--env-file` 旗標）
- 已安裝 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- Discord 機器人 Token（[Discord Developer Portal](https://discord.com/developers/applications)）

### Discord 機器人設定

1. 在 Discord Developer Portal 建立新應用程式
2. 前往 **Bot** → 啟用 **Message Content Intent**
3. 前往 **OAuth2** → URL Generator → 勾選 `bot` + `applications.commands`
4. 所需機器人權限：Send Messages、Read Message History、Attach Files、Use Slash Commands
5. 用產生的連結邀請機器人加入你的伺服器

## 環境變數

| 變數 | 必填 | 說明 |
|------|------|------|
| `DISCORD_TOKEN` | 是 | Discord Developer Portal 的 Bot Token |
| `GUILD_ID` | 否 | 伺服器 ID，用於即時註冊斜線指令。不設的話全域指令最多需 1 小時生效。 |
| `DEFAULT_CWD` | 否 | Claude Code 的預設工作目錄（預設為 `process.cwd()`） |
| `CLAUDE_BIN` | 否 | Claude Code 執行檔路徑（預設為 `claude`） |

## 架構

```
Discord 討論串          Bot（本 repo）            Claude Code CLI
──────────────          ──────────────            ───────────────
@mention 訊息  ────►  擷取討論串歷史
                      組裝 prompt
                      spawn claude -p ──────────►  --session-id UUID
                                                   (或 --resume UUID)
               ◄────  收集 stdout
回覆 / .txt          送回討論串       ◄────────  回應內容
```

單檔架構（`src/index.ts`，約 400 行）。Session 狀態存在 `thread-map.json` — 一個簡單的 Discord 討論串 ID 到 Claude Code session UUID 的對照表。

## 斜線指令

| 指令 | 說明 |
|------|------|
| `/help` | 顯示可用指令 |
| `/new` | 清除上下文，開始新對話（僅限討論串） |
| `/model <name>` | 切換 Claude 模型（如 sonnet、opus、haiku） |
| `/cd <path>` | 切換工作目錄 |
| `/stop` | 終止執行中的 Claude 程序（僅限討論串） |
| `/sessions` | 列出所有活躍 session |

## System Prompt

機器人會注入一段 system prompt，告訴 Claude 它正在 Discord 討論串中運行，可能有多位使用者參與。你可以透過編輯 `src/index.ts` 中的 `SYSTEM_PROMPT` 常數來自訂。

## 進階用法：終端機接管（Terminal Takeover）

每個討論串對應一個標準的 Claude Code session。你可以在終端機用互動模式 resume 任何機器人的 session：

```bash
# 從 thread-map.json 找到 session ID
cat thread-map.json | jq '."<thread-id>".sessionId'

# 用互動模式 resume
claude --resume <session-id>
```

這讓你接入同一個「大腦」— Claude 記得 Discord 討論串裡的所有對話。你可以在終端機做精細操作（review diff、確認權限、使用工具），而 Discord 討論串保持原樣。

**使用情境：** 在 Discord 用手機發起任務 → 走到電腦前 → 用終端機 resume 做精確操作 → 回到 Discord 回報結果。一個 session，兩個入口。

注意：在終端機發送的訊息不會出現在 Discord 討論串中（反之亦然），但 Claude 的記憶橫跨兩邊。

## Roadmap

- [ ] [ACP (Agent Client Protocol)](https://github.com/agentclientprotocol/agent-client-protocol) 支援，實現多代理人橋接
- [ ] 串流回應
- [ ] 多伺服器支援

## 授權

MIT
