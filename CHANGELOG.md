# Changelog

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
