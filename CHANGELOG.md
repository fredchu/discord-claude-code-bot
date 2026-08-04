# Changelog

## 0.9.0 - 2026-08-04

### Features
- Discord voice messages in threads now reach Claude — mention exemption inside threads only, plus optional transcription via `VOICE_TRANSCRIBE_CMD` (by @bockybocky)
- `ALLOWED_USER_IDS` authorization gate — comma-separated allowlist enforced on messages, slash commands, buttons, and select menus; unset preserves the previous open behaviour
- `VOICE_ALLOWED_USER_IDS` for the mentionless voice path, defaulting to the thread's creator
- Reference transcription helper `scripts/transcribe.py` — auto-detects mlx-whisper (Apple Silicon GPU) or faster-whisper (CPU), `--terms` for domain vocabulary, VAD on by default because silence otherwise produces fluent hallucinations

### Improvements
- Task timeout raised from 90 minutes to 2.5 hours
- README states plainly that skipped permission checks mean any authorized user can run code on the host

### Fixes
- Voice messages are handled on the `IsVoiceMessage` flag alone — a voice message sent as a reply satisfied the ordinary mention path and reached Claude as an unreadable `.ogg` path
- Transcription failure reports and stops instead of falling back to passing the `.ogg` path to Claude
- Validate `VOICE_TRANSCRIBE_TIMEOUT_MS` — `NaN` threw synchronously, fractions below 1 disabled the timeout, and values above 2^31-1 silently became 1 ms
- `VOICE_TRANSCRIBE_CMD` also accepts a JSON argv array, so binary paths containing spaces work; whitespace-only values no longer call `execFile(undefined)`
- Oversized or failed attachment downloads no longer invoke Claude with an empty prompt, and early returns no longer strand the "Thinking..." preview

## 0.8.2 - 2026-04-02

### Fixes
- Fix bot sessions not appearing in CC's `/resume` picker (CC 2.1.90+ filters `entrypoint:"sdk-cli"`)
- Patch session files after each run to rewrite entrypoint, making bot sessions discoverable

## 0.8.1 - 2026-04-02

### Improvements
- Increase task timeout from 30 to 90 minutes for long-running operations

## 0.8.0 - 2026-03-26

### Improvements
- System prompt now instructs Claude to avoid markdown tables (Discord cannot render them)
- Bold key-value line format for comparisons (mobile-friendly, no horizontal scrolling)
- Applied to both `SYSTEM_PROMPT` and `RESUME_SYSTEM_PROMPT`

## 0.7.0 - 2026-03-25

### Features
- File attachment support — images, code, PDFs, or any file sent in Discord are auto-downloaded and passed to Claude Code via the Read tool
- Type-agnostic design: no per-format handling, Claude Code decides how to read each file
- 10 MB per-file size limit, temp files auto-cleaned after response

## 0.6.0 - 2026-03-25

### Features
- `/resume-local` command — resume a local terminal Claude Code session from Discord (mobile use case)
  - Auto-discover active sessions from `~/.claude/sessions/` PID files
  - Fallback to recent sessions from `~/.claude/history.jsonl` with last prompt display
  - Select menu for multiple sessions, showing last prompt + project path
  - Blocks resume of still-running sessions (must `/quit` in terminal first)
- `/handback` command — hand session back to terminal, reset thread to fresh bot session
- Dedicated `RESUME_SYSTEM_PROMPT` for resumed sessions (lighter than bot system prompt)
- `isLocalResume` flag in DB to distinguish bot-created vs resumed sessions
- Capture stderr from Claude CLI — show error details instead of bare `(no output)`

## 0.5.0 - 2026-03-23

### Features
- Replace `thread-map.json` with SQLite (`better-sqlite3` + WAL mode) for crash-safe session storage
- Auto-migrate existing JSON data to SQLite on first startup (rename `.bak` after success)
- Per-entry upsert via `saveEntry()` instead of full-file overwrite
- Graceful shutdown on both SIGINT and SIGTERM (closes DB properly)

## 0.4.2 - 2026-03-23

### Fixes
- Rewrite `splitMessage` with segment-based approach — code blocks are never broken across Discord message chunks
- Oversized code blocks (>2000 chars) are split and re-wrapped with proper fences on each chunk
- Long AskUserQuestion replies now use `sendChunked` instead of truncating at 2000 chars

## 0.4.1 - 2026-03-23

### Fixes
- Fix duplicate message in thread history — current trigger message was included in the history block and appended again as prompt content

## 0.4.0 - 2026-03-23

### Features
- Interactive Discord buttons for AskUserQuestion permission prompts (replaces plain text)
- Button click resumes Claude session with user's choice
- Chained AskUserQuestion support (button → resume → another question → buttons again)
- "Other..." button option for free-text answers

### Improvements
- Extract `sendAskButtons` helper to deduplicate button rendering logic
- Extract `createToolUseHandler` helper to deduplicate streaming callbacks
- Add Discord customId length guard (`.slice(0, 100)`)
- Simplify redundant try/catch in button handler reply flow

## 0.3.0 - 2026-03-19

### Features
- Increase task timeout from 10 to 30 minutes for long-running operations
- Return partial results on timeout instead of empty error
- Show elapsed time in streaming preview (e.g. "working... (2m34s)")
- Display recent tool names in preview (e.g. "🔧 Read → Grep → Edit")

## 0.2.1 - 2026-03-19

### Fixes
- Send final reply as new message instead of editing preview, ensuring Discord push notifications are triggered

## 0.2.0 - 2026-03-16

### Features
- Streaming response with real-time Discord message updates (stream-json mode, 1.5s throttle, 40-char minimum delta)
- Long message auto-splitting for streaming output

### Fixes
- Correct ACP repository link in README

## 0.1.0 - 2026-03-09

### Features
- Discord thread ↔ Claude Code CLI session bridging with automatic `--resume`
- Thread context awareness (fetches last 30 messages)
- 6 slash commands: `/help`, `/new`, `/model`, `/cd`, `/stop`, `/sessions`
- Model switching per thread (opus, sonnet, haiku)
- Long responses sent as `.txt` attachments
- Typing indicator during Claude execution
- AI disclosure on first reply per session
