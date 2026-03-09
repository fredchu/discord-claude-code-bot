# Changelog

## 0.1.0 - 2026-03-09

### Features
- Discord thread ↔ Claude Code CLI session bridging with automatic `--resume`
- Thread context awareness (fetches last 30 messages)
- 6 slash commands: `/help`, `/new`, `/model`, `/cd`, `/stop`, `/sessions`
- Model switching per thread (opus, sonnet, haiku)
- Long responses sent as `.txt` attachments
- Typing indicator during Claude execution
- AI disclosure on first reply per session
