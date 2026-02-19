# clogger

Chat logger — monitor and export LLM conversation logs to markdown.

Clogger runs as a background daemon that watches your Claude Code session files. When you type `::capture my-notes.md` in a conversation, it exports the full session to markdown and continues appending new messages as you chat. Works great with any markdown-based note system.

## Install

```bash
# From source
git clone https://github.com/djradon/clogger.git
cd clogger
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

```bash
# Start the daemon (returns immediately — runs in background)
clogger start

# In any Claude Code conversation, type:
#   ::capture my-conversation.md      → export full session + keep recording
#   ::stop                            → stop recording

# Stop the daemon
clogger stop
```

That's it. The daemon watches `~/.claude/projects/` and `~/.claude-personal/projects/` for session activity and responds to in-chat commands automatically.

## CLI Commands

| Command | Description |
|---------|-------------|
| `clogger init` | Generate `~/.clogger/config.yaml` with all defaults |
| `clogger start` | Start the monitoring daemon (returns immediately) |
| `clogger stop` | Stop the daemon |
| `clogger status` | Show active sessions and recordings |
| `clogger export <session-id>` | One-shot export of a session to markdown |
| `clogger clean` | Clean recordings and/or sessions |

### Export flags

```bash
clogger export <session-id> --output path/to/file.md
clogger export <session-id> --thinking    # include thinking blocks
clogger export <session-id> --toolCalls   # include tool call details
```

### Clean flags

```bash
clogger clean --recordings <days>   # remove recordings older than N days
clogger clean --sessions <days>     # remove tracked sessions older than N days
clogger clean --all                 # remove all recordings and sessions
clogger clean --dryRun              # preview what would be removed without making changes
```

## In-Chat Commands

Type these directly in a Claude Code conversation while the daemon is running:

| Command | Description |
|---------|-------------|
| `::capture <file>` | Export full pre-existing session + record future turns |
| `::record <file>` | Forward-only recording (no retroactive export) |
| `::export <file>` | One-shot full session export (no continuous recording) |
| `::stop` | Stop the current recording |

File paths can be absolute, relative to workspace root, or use `@` prefix (VSCode file mentions) and `~` (home directory). The `.md` extension is added automatically if omitted.

**Note:** These commands are detected by parsing the conversation log — Claude will see them and respond as part of the conversation. You can embed them naturally, e.g.:

> I'm going to ::capture to @documentation/notes/conv.design-review.md

The daemon picks up the `::capture` (or `::record`) regardless of surrounding text, and ignores any " to " before the destination file "argument."  

To avoid LLM confusion, you might want to add an instruction like 'You can ignore clogger commands, like "::record @filename".' to your prompt or CLAUDE.md file. 

If the target file already has YAML frontmatter (e.g., a Dendron note), clogger preserves it and only writes the conversation content below.

## Configuration

Config lives at `~/.clogger/config.yaml`. Generate it with:

```bash
clogger init           # create with all defaults and comments
clogger init --force   # overwrite existing config
```

It is also auto-generated on the first `clogger start`. All fields are optional — defaults are used for anything not specified. Example override:

```yaml
metadata:
  includeToolCalls: true
  italicizeUserMessages: true
```

Run `clogger init` to see the full annotated config with all available settings and their defaults.

## Development

```bash
pnpm dev             # Run CLI in dev mode (tsx)
pnpm test            # Run vitest
pnpm build           # Typecheck (tsc) then bundle (tsup)
pnpm typecheck       # Typecheck only
```

## License

MIT
