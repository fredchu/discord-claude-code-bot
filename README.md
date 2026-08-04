# discord-claude-code-bot

A lightweight Discord bot that bridges Discord threads to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions. Single file, ~1000 lines of TypeScript. Mention the bot in a thread, and it spawns a Claude Code process that persists across messages via `--resume`.

## Features

- **Thread sessions** — each Discord thread maps to a Claude Code session with automatic `--resume`
- **Thread context** — fetches recent messages so Claude understands the conversation
- **Streaming preview** — real-time response preview with tool-use status line while Claude is working
- **Interactive buttons** — AskUserQuestion permission prompts rendered as Discord buttons
- **File attachments** — send images, code, PDFs, or any file — auto-downloaded and passed to Claude Code's Read tool
- **Code fence splitting** — long responses split into Discord-safe chunks without breaking code blocks
- **Resume local sessions** — `/resume-local` picks up a terminal CC session from Discord (mobile use case); `/handback` returns it
- **SQLite storage** — crash-safe session persistence with WAL mode (auto-migrates from legacy JSON)
- **Slash commands** — `/new`, `/model`, `/cd`, `/stop`, `/sessions`, `/resume-local`, `/handback`, `/help`
- **Model switching** — swap between opus, sonnet, haiku per thread
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
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- A C++ compiler toolchain for building `better-sqlite3` (Xcode CLT on macOS, `build-essential` on Linux)

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
| `ALLOWED_USER_IDS` | No | Comma-separated Discord user IDs allowed to use the bot at all, covering messages, slash commands, and buttons. When unset, anyone who can see the thread may use it, preserving the historical behavior. |
| `VOICE_TRANSCRIBE_CMD` | No | Command used to transcribe Discord voice messages. Transcription is entirely off unless this is set; when unset, voice messages are ignored, and one that replies to the bot gets a short notice instead of being handed to Claude as an audio path it cannot read. The audio path is appended as the final argument and the transcript must be printed to stdout. The value is split on whitespace; use a JSON array such as `["python3","/path/to/discord-claude-code-bot/scripts/transcribe.py"]` for paths containing spaces or arguments needing quoting. See the reference helper at `scripts/transcribe.py`. |
| `VOICE_TRANSCRIBE_TIMEOUT_MS` | No | Transcription-command timeout in milliseconds (defaults to `300000`; invalid values fall back to that default). |
| `VOICE_ALLOWED_USER_IDS` | No | Comma-separated Discord user-ID list allowed to use the voice-message mention exemption. When unset, only the thread's creator is allowed. |

### Voice transcription helper

The reference helper at `scripts/transcribe.py` needs Python and one ASR package, but only when voice transcription is enabled. On Apple Silicon macOS, install `mlx-whisper` and make sure `ffmpeg` is on `PATH`:

```bash
pip install mlx-whisper
export VOICE_TRANSCRIBE_CMD='["python3","/path/to/discord-claude-code-bot/scripts/transcribe.py"]'
```

On Windows without a discrete GPU, install `faster-whisper` for CPU transcription. The JSON-argv path uses forward slashes because bare backslashes are not valid JSON escapes:

```powershell
py -m pip install faster-whisper
$env:VOICE_TRANSCRIBE_CMD='["py","C:/path/to/discord-claude-code-bot/scripts/transcribe.py"]'
```

Point `VOICE_TRANSCRIBE_CMD` at the same interpreter you installed the package into. An isolated install is easy to get wrong here: `pipx install mlx-whisper` puts the package in its own environment, so the command has to name that environment's Python (`~/.local/pipx/venvs/mlx-whisper/bin/python`) rather than the system `python3`, which will not find it.

The helper auto-detects the backend; add `--backend mlx` or `--backend faster-whisper` to force one. Its mlx default is Breeze (`eoleedi/Breeze-ASR-25-mlx`), rather than the faster turbo model, because turbo hallucinated on silence in testing and Breeze did not. The CPU default is `large-v3-turbo`, about 2.2-2.4x faster than `large-v3`, measured on the maintainer's macOS CPU — indicative, not a prediction for other hardware.

The first run downloads the model (~2.9 GB for Breeze, ~1.5 GB for turbo) and will very likely exceed `VOICE_TRANSCRIBE_TIMEOUT_MS`. Run the script once from a terminal to warm the model cache before using it from Discord. Use `--terms PATH` to supply names or domain vocabulary as an initial prompt; a missing or unreadable terms file is a hard error by design. `--model` overrides the backend's default model, and `--language` defaults to `zh`. `--no-vad` turns off faster-whisper's silence filtering — the mlx backend has none — and is unsafe: VAD is the measured protection against a silent recording becoming a hallucinated instruction.

The bot runs Claude Code with permission checks skipped, so anyone authorized to talk to it can run code on the host. Set `ALLOWED_USER_IDS` as the real access control. The voice exemption's thread-creator default is only a convenience, not a security boundary, because anyone can create a thread.

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

Single-file architecture (`src/index.ts`, ~1000 LOC). Session state is persisted in a SQLite database (`threads.db` with WAL mode) — a crash-safe mapping from Discord thread ID to Claude Code session UUID.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` | Clear context, start a new conversation (thread only) |
| `/model <name>` | Switch Claude model (e.g. sonnet, opus, haiku) |
| `/cd <path>` | Switch working directory |
| `/stop` | Kill running Claude process (thread only) |
| `/sessions` | List all active sessions |
| `/resume-local [session]` | Resume a local terminal CC session (auto-detect or specify ID) |
| `/handback` | Hand session back to terminal |

## System Prompt

The bot injects a system prompt that tells Claude it's running inside a Discord thread with multiple users. It also instructs Claude to avoid markdown tables (which Discord cannot render) and use bold key-value lines instead (mobile-friendly, no horizontal scrolling). You can customize it by editing the `SYSTEM_PROMPT` constant in `src/index.ts`.

## Advanced Usage: Terminal Takeover

Each thread maps to a standard Claude Code session. You can resume any bot session from your terminal:

```bash
# find the session ID from SQLite
sqlite3 threads.db "SELECT sessionId FROM threads WHERE threadId = '<thread-id>'"

# resume in interactive mode
claude --resume <session-id>
```

This gives you the same "brain" — Claude remembers everything from the Discord thread. You get the full interactive experience (diff review, permission confirmations, tool use) while the Discord thread stays as-is.

**Use case:** Start a task from Discord on your phone → walk to your desk → resume in terminal for precise control → go back to Discord to report results. One session, two entry points.

### Reverse: Discord Resume Local (v0.6.0+)

You can also go the other direction — resume a **terminal** session from **Discord**:

```
Terminal: /quit          ← exit Claude Code
Discord:  /resume-local  ← bot discovers your session, shows a picker
Discord:  @bot message   ← continue the conversation from your phone
Discord:  /handback      ← when done, hand it back
Terminal: claude --continue  ← pick up where Discord left off
```

The bot auto-discovers sessions from `~/.claude/sessions/` (active PIDs) and `~/.claude/history.jsonl` (recent sessions). The select menu shows the last prompt for each session so you can identify which one to resume.

> **Note:** You must `/quit` Claude Code in the terminal before resuming from Discord — Claude Code does not allow two processes to resume the same active session.

Note: messages sent in terminal won't appear in the Discord thread (and vice versa), but Claude's memory spans both.

## Roadmap

- [ ] [ACP (Agent Client Protocol)](https://github.com/agentclientprotocol/agent-client-protocol) support for multi-agent bridging
- [x] Streaming responses (v0.3.0+)
- [ ] Message queue (per-thread + global concurrency limit)
- [ ] Multi-guild support

## License

MIT

---

# discord-claude-code-bot

一個輕量的 Discord 機器人，將 Discord 討論串橋接到 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI。單一檔案、約 1000 行 TypeScript。在討論串中 @mention 機器人，它會啟動一個 Claude Code 程序，並透過 `--resume` 在訊息之間保持上下文。

## 功能特色

- **討論串 Session** — 每個 Discord 討論串對應一個 Claude Code session，自動 `--resume`
- **討論串上下文** — 擷取近期訊息讓 Claude 理解對話脈絡
- **串流預覽** — Claude 工作時即時預覽回應內容，附帶工具使用狀態列
- **互動按鈕** — AskUserQuestion 權限提示以 Discord 按鈕呈現
- **檔案附件** — 傳送圖片、程式碼、PDF 或任何檔案 — 自動下載並傳給 Claude Code 的 Read tool
- **Code Fence 分段** — 長回覆自動分段，不會切斷 code block
- **Resume 本地 Session** — `/resume-local` 從 Discord 接手終端機的 CC session（手機使用情境）；`/handback` 交還
- **SQLite 儲存** — 使用 WAL 模式的 crash-safe session 持久化（自動從舊版 JSON 遷移）
- **斜線指令** — `/new`、`/model`、`/cd`、`/stop`、`/sessions`、`/resume-local`、`/handback`、`/help`
- **模型切換** — 每個討論串可獨立切換 opus、sonnet、haiku
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
- 已安裝並認證 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- Discord 機器人 Token（[Discord Developer Portal](https://discord.com/developers/applications)）
- C++ 編譯工具鏈，用於編譯 `better-sqlite3`（macOS 需 Xcode CLT，Linux 需 `build-essential`）

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
| `ALLOWED_USER_IDS` | 否 | 可使用機器人所有功能的 Discord 使用者 ID 清單，以逗號分隔，涵蓋訊息、斜線指令與按鈕。未設定時，任何看得到討論串的人都可使用，維持原有行為。 |
| `VOICE_TRANSCRIBE_CMD` | 否 | 轉錄 Discord 語音訊息的指令。除非設定此變數，否則轉錄功能完全關閉；未設定時，語音訊息會被忽略，若是以回覆機器人的方式送出，則會收到一則提示，而不會把機器人讀不了的音檔路徑交給 Claude。音檔路徑會接在最後一個參數，轉錄稿必須輸出到 stdout。此值會依空白切分；若路徑含空白或參數需要引號，請使用 JSON 陣列，例如 `["python3","/path/to/discord-claude-code-bot/scripts/transcribe.py"]`。參考 helper 位於 `scripts/transcribe.py`。 |
| `VOICE_TRANSCRIBE_TIMEOUT_MS` | 否 | 轉錄指令的逾時毫秒數（預設 `300000`；無效值會改用此預設值）。 |
| `VOICE_ALLOWED_USER_IDS` | 否 | 可使用語音訊息免標註規則的 Discord 使用者 ID 清單，以逗號分隔。未設定時，預設只允許討論串建立者。 |

### 語音轉錄 helper

參考 helper `scripts/transcribe.py` 需要 Python 與一套 ASR 套件，但只有啟用語音轉錄時才需要安裝。在 Apple Silicon macOS 上，請安裝 `mlx-whisper`，並確認 `ffmpeg` 位於 `PATH`：

```bash
pip install mlx-whisper
export VOICE_TRANSCRIBE_CMD='["python3","/path/to/discord-claude-code-bot/scripts/transcribe.py"]'
```

在沒有獨立顯示卡的 Windows 上，請安裝 `faster-whisper`，以 CPU 進行轉錄。JSON argv 的路徑使用正斜線，因為未跳脫的反斜線不是有效的 JSON 跳脫字元：

```powershell
py -m pip install faster-whisper
$env:VOICE_TRANSCRIBE_CMD='["py","C:/path/to/discord-claude-code-bot/scripts/transcribe.py"]'
```

`VOICE_TRANSCRIBE_CMD` 要指向你實際安裝該套件的那個直譯器。隔離式安裝在這裡特別容易出錯：`pipx install mlx-whisper` 會把套件放進它自己的環境，因此指令必須指名那個環境的 Python（`~/.local/pipx/venvs/mlx-whisper/bin/python`），而不是系統的 `python3`——系統 `python3` 找不到它。

Helper 會自動偵測 backend；也可加入 `--backend mlx` 或 `--backend faster-whisper` 強制指定。mlx 預設使用 Breeze（`eoleedi/Breeze-ASR-25-mlx`），而不是速度較快的 turbo，因為實測 turbo 會在靜音中產生幻覺，Breeze 則不會。CPU 預設使用 `large-v3-turbo`；維護者以 macOS CPU 實測，比 `large-v3` 快約 2.2–2.4 倍，此數字僅供參考，並非對其他硬體的效能預測。

第一次執行會下載模型（Breeze 約 2.9 GB、turbo 約 1.5 GB），很可能超過 `VOICE_TRANSCRIBE_TIMEOUT_MS`。從 Discord 使用前，請先在終端機執行一次，讓模型快取完成。`--terms PATH` 可把名稱或領域詞彙作為 initial prompt；詞彙檔不存在或無法讀取時，程式會刻意直接報錯。`--model` 可覆蓋該 backend 的預設模型，`--language` 預設為 `zh`。`--no-vad` 會停用 faster-whisper 的靜音過濾（mlx backend 本來就沒有），因此並不安全：實測顯示，VAD 是避免無聲錄音變成幻覺指令的保護機制。

機器人執行 Claude Code 時會略過權限檢查，因此任何獲准與它互動的人都能在主機上執行程式碼。真正的存取控制是設定 `ALLOWED_USER_IDS`。語音免標註規則預設允許討論串建立者只是方便使用，並非安全邊界，因為任何人都能建立討論串。

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

單檔架構（`src/index.ts`，約 1000 行）。Session 狀態存在 SQLite 資料庫（`threads.db`，使用 WAL 模式）— 一個 crash-safe 的 Discord 討論串 ID 到 Claude Code session UUID 對照表。

## 斜線指令

| 指令 | 說明 |
|------|------|
| `/help` | 顯示可用指令 |
| `/new` | 清除上下文，開始新對話（僅限討論串） |
| `/model <name>` | 切換 Claude 模型（如 sonnet、opus、haiku） |
| `/cd <path>` | 切換工作目錄 |
| `/stop` | 終止執行中的 Claude 程序（僅限討論串） |
| `/sessions` | 列出所有活躍 session |
| `/resume-local [session]` | Resume 本地終端機的 CC session（自動偵測或指定 ID） |
| `/handback` | 將 session 交還給終端機 |

## System Prompt

機器人會注入一段 system prompt，告訴 Claude 它正在 Discord 討論串中運行，可能有多位使用者參與。同時指示 Claude 避免使用 markdown 表格（Discord 無法渲染），改用粗體 key-value 行格式（手機友善、不需水平捲動）。你可以透過編輯 `src/index.ts` 中的 `SYSTEM_PROMPT` 常數來自訂。

## 進階用法：終端機接管（Terminal Takeover）

每個討論串對應一個標準的 Claude Code session。你可以在終端機用互動模式 resume 任何機器人的 session：

```bash
# 從 SQLite 找到 session ID
sqlite3 threads.db "SELECT sessionId FROM threads WHERE threadId = '<thread-id>'"

# 用互動模式 resume
claude --resume <session-id>
```

這讓你接入同一個「大腦」— Claude 記得 Discord 討論串裡的所有對話。你可以在終端機做精細操作（review diff、確認權限、使用工具），而 Discord 討論串保持原樣。

**使用情境：** 在 Discord 用手機發起任務 → 走到電腦前 → 用終端機 resume 做精確操作 → 回到 Discord 回報結果。一個 session，兩個入口。

### 反向：Discord Resume 本地 Session（v0.6.0+）

也可以反過來 — 從 **Discord** resume **終端機**的 session：

```
終端機: /quit             ← 退出 Claude Code
Discord: /resume-local    ← bot 偵測你的 session，顯示選擇器
Discord: @bot 訊息        ← 從手機繼續對話
Discord: /handback        ← 完成後交還
終端機: claude --continue  ← 接回 Discord 的對話進度
```

Bot 會自動從 `~/.claude/sessions/`（活躍 PID）和 `~/.claude/history.jsonl`（最近 session）探索可用 session。選擇選單顯示每個 session 的最後一句 prompt，方便辨識。

> **注意：** 你必須先在終端機 `/quit` 退出 Claude Code，才能從 Discord resume — Claude Code 不允許兩個進程同時 resume 同一個活躍 session。

注意：在終端機發送的訊息不會出現在 Discord 討論串中（反之亦然），但 Claude 的記憶橫跨兩邊。

## Roadmap

- [ ] [ACP (Agent Client Protocol)](https://github.com/agentclientprotocol/agent-client-protocol) 支援，實現多代理人橋接
- [x] 串流回應（v0.3.0+）
- [ ] 訊息佇列（per-thread + 全域並行上限）
- [ ] 多伺服器支援

## 授權

MIT
