---
id: z7ldlik96o7yudpaq2p91po
title: 2026 02 19 Codex Support
desc: ''
updated: 1771517301140
created: 1771517301140
---

## Goal

Add a `codex` provider to stenobot so it can monitor and export OpenAI Codex (VSCode extension and CLI) conversation logs.

## Codex Session Format

Sessions live at: `~/.codex/sessions/YYYY/MM/DD/<name>-<uuid>.jsonl`

### Session sources (`session_meta.payload.source`)

| `source` | `originator`      | Description                                      |
|----------|-------------------|--------------------------------------------------|
| `vscode` | `codex_vscode`    | VSCode extension — **primary conversation sessions** |
| `cli`    | `codex_cli_rs`    | CLI (`codex` terminal command) — conversation sessions |
| `exec`   | `codex_vscode`    | Sub-agent execution context — **skip these** (typically very short files, no real conversation) |

VSCode sessions are often paired with a `source=exec` sibling (a sandboxed sub-process stub). CLI sessions are typically standalone. Neither pairing nor stub-length is guaranteed, so filter on `source === "exec"` exclusively.

### Entry types

| `type`          | Purpose                                             |
|-----------------|-----------------------------------------------------|
| `session_meta`  | First line; `payload.cwd`, `payload.id`, `payload.source`, `payload.cli_version` |
| `turn_context`  | **LLM API round-trip boundary** (not conversation turn!) — appears after each tool execution |
| `event_msg`     | Human-readable events (see table below)             |
| `response_item` | Full content: messages, tool calls, reasoning       |

### `event_msg` payload types (version-dependent)

| `payload.type`   | Versions       | Notes                                       |
|------------------|----------------|---------------------------------------------|
| `user_message`   | All            | Always present; marks conversation turn start |
| `agent_message`  | All (varies)   | Old: 1 per turn (= final response). New VSCode: many per turn (= streaming commentary) |
| `agent_reasoning`| All            | Streaming reasoning summary text             |
| `token_count`    | All            | Usage stats — skip                           |
| `task_started`   | Feb 2026+      | Marks turn start, carries `turn_id`          |
| `task_complete`  | ≥0.104.0 (all sources) | Has `last_agent_message`; absent in ≤0.98.0; **gate on presence, not source** |
| `turn_aborted`   | Rare           | User cancelled a turn                        |

### User messages

VSCode format (includes IDE preamble):
```
# Context from my IDE setup:
## Active file: some/file.ts
## My request for Codex:
<actual user text here>
```
CLI format: plain text only, no preamble.

Extract: everything after `## My request for Codex:\n` if present, else full `message` field.

### Assistant responses

Canonical precedence (first match wins, per turn):

1. **`response_item` with `phase: "final_answer"`** — most complete text; present in all sources at ≥0.104.0
2. **`event_msg task_complete` → `payload.last_agent_message`** — same content; present in same builds as above
3. **Last `event_msg agent_message` before next `user_message` or EOF** — universal fallback

`final_answer` and `task_complete` carry identical text. Both are listed because they appear at different positions in the file and the parser may encounter either first. Once an assistant message is yielded from any of these sources, a **per-turn "finalized" flag** must prevent re-emission — specifically, if `final_answer` fires (step 1), `task_complete` (step 2) must be ignored for the same turn. Gate on **signal presence in the file**, not on `source` or version string.

### Tool calls

`response_item` with `payload.type: "function_call"`:
```json
{ "payload": { "type": "function_call", "name": "exec_command",
  "arguments": "{\"cmd\":\"rg ...\"}",  "call_id": "call_..." } }
```
Output: `function_call_output` with matching `call_id`. Note `arguments` is a **JSON string**, not an object.

### Reasoning

`response_item` with `payload.type: "reasoning"` — `payload.summary` array of `{type:"summary_text", text:string}` is readable; `payload.encrypted_content` is opaque (skip).

### Workspace root

`session_meta.payload.cwd` — available directly, no path decoding needed.

### Model

`turn_context.payload.model` (e.g., `"gpt-5.3-codex"`) — first `turn_context` in the file.

## Implementation Plan

### 1. `src/providers/codex/discovery.ts`

Scan `~/.codex/sessions/YYYY/MM/DD/` recursively. Default path: `~/.codex/sessions`.

For each `.jsonl` file:
- Read the first line (`session_meta`) to check `payload.source` — **skip `source === "exec"`** sessions
- Use `payload.cwd` as `workspaceRoot` and `payload.id` as session ID
- Yield a `Session` object

Directory walk: `YYYY/` → `MM/` → `DD/` → `*.jsonl` (3 levels deep).

### 2. `src/providers/codex/parser.ts`

Strategy: yield user messages **immediately** (so command detection fires without delay), yield assistant messages only when finalized.

**Why this matters**: `monitor.ts:165` runs `detectAllCommands()` inline as each message is yielded. A `::record` or `::capture` command must be detected before the assistant responds — which can take minutes. Bundling user + assistant into a pair and waiting for the assistant would break command timing.

**Parsing approach** (mirrors Claude Code's EOF-flush pattern):

1. On `event_msg user_message`:
   - Flush any buffered assistant message from the previous turn
   - Yield the user message **immediately** at its own byte offset
   - Strip IDE preamble (extract after `## My request for Codex:\n`, else use full text)
2. On `event_msg agent_message`: overwrite a "pending assistant" buffer (keep only the last seen — earlier ones are streaming commentary)
3. On `response_item` with `phase: "final_answer"`: if **`turnFinalized`** is false, yield assistant message immediately, set `turnFinalized = true`, clear buffer, offset advances past this line; otherwise skip (symmetric deduplication guard — guards against duplicate `final_answer` entries)
4. On `event_msg task_complete`: if **`turnFinalized`** is false, yield assistant from `payload.last_agent_message`, set `turnFinalized = true`, clear buffer; otherwise skip (deduplication guard)
5. At EOF: if assistant buffer is non-empty **and `turnFinalized` is false**, yield it (handles old-style 1-agent_message-per-turn sessions and sessions that end without `task_complete`)
6. Message ID: `task_started.turn_id` when present; fall back to `session_meta.id + "-" + <byte-offset>` (offset-based, stable across resume boundaries)
7. Model: `turn_context.payload.model` from the first `turn_context`

**Incremental offset behavior**:
- User message → yielded immediately → offset advances → next poll starts after it ✓
- Intermediate `agent_message`s with no end signal → NOT yielded → offset stays put → re-scanned each poll (accepted cost; avoids polluting recordings with commentary)
- `final_answer` / `task_complete` → yielded immediately → offset advances ✓
- EOF flush → yield buffered assistant message → offset advances to end of file ✓

**`turnFinalized` reset**: set to `false` on each new `user_message`; set to `true` when any assistant message is emitted.

**Why last `agent_message` as fallback**: When neither `final_answer` nor `task_complete` appears (builds ≤0.98.0, aborted sessions), the last buffered `agent_message` is the best available content. For aborted turns (`turn_aborted` event or no agent content at all), yield nothing — do not emit an empty assistant message.

**Tool calls** (optional enrichment):
- Track `response_item` with `payload.type: "function_call"` between user turns
- Match `call_id` in `function_call_output` entries for results
- `JSON.parse(payload.arguments)` to get structured input (handle malformed JSON gracefully)
- Normalize to `ToolCall` with `name`, description derived from tool name + first arg

**Reasoning** (optional):
- `response_item` with `payload.type: "reasoning"` and non-empty `payload.summary` → join summary texts into `ThinkingBlock.content`

**User message stripping**:
- If message contains `## My request for Codex:\n`, take everything after that heading
- Otherwise use the full message text
- Trim whitespace

**Byte offset tracking**: Same approach as Claude Code — accumulate `Buffer.byteLength(line) + 1` per line.

### 3. `src/providers/codex/workspace.ts`

Much simpler than Claude Code's version — the cwd is embedded in `session_meta`. Read first line of the session file, parse JSON, return `payload.cwd`.

### 4. `src/providers/codex/index.ts`

Standard `Provider` implementation wiring discovery, parser, and workspace resolver.

### 5. `src/providers/registry.ts`

Register `CodexProvider` in constructor (behind `config?.providers["codex"]`).

### 6. Config / types

No schema changes needed — `StenobotConfig.providers` is already `Record<string, ...>`.

**Required** changes to `src/config.ts`:
- Add `"codex"` to `DEFAULT_CONFIG.providers` with `enabled: true` and `sessionPaths: ["~/.codex/sessions"]`
- Add a `codex:` block to `buildConfigTemplate()` documenting the default session path (same style as `claude-code` block)

This is required for discoverability — users who never touch their config should get Codex monitoring automatically.

### 7. Provider-abstracted UX refactor (in scope)

Two locations hard-code Claude-specific JSONL schema and path structure, producing silent degraded output for Codex sessions. Rather than adding a third ad-hoc Codex reader in each, do the full provider-abstracted fix now — marginal cost is small and every future provider benefits automatically.

**7a. `src/types/index.ts` — add `provider` to session state**

Add `provider: string` to the `AppState.sessions` record (alongside `filePath`).

Migration: no migration path needed (no existing users to support). State records without `provider` fall back to displaying raw file path — acceptable degradation for the empty case.

**7b. `src/providers/base.ts` — add `getSessionLabel` to Provider interface**

```ts
/** Scan a session file and return a short human-readable label (first user message, ≤60 chars).
 *  Returns null if unreadable or no user message found. Lightweight — first N lines only. */
getSessionLabel?(filePath: string): Promise<string | null>;
```

This is a fast ad-hoc scan (NOT via `parseMessages`) — it only needs the first user message text.

**7c. `src/providers/claude-code/index.ts` — implement `getSessionLabel`**

Port the existing logic from `monitor.ts:getFirstUserMessage` here: scan for `type === "user"` entries, strip `<system-reminder>` / `<ide_*>` XML tags, return first non-empty text up to 60 chars.

**7d. `src/providers/codex/index.ts` — implement `getSessionLabel`**

Scan for first `event_msg` with `payload.type: "user_message"`, strip IDE preamble (extract after `## My request for Codex:\n`), return up to 60 chars.

**7e. `src/core/monitor.ts`**

- In `processSession`, add `provider: provider.name` to the `state.updateSession()` call (provider is already in scope)
- Replace `getFirstUserMessage` body with `return provider.getSessionLabel?.(filePath) ?? null`
- Delete the now-inlined Claude-specific JSONL parsing from `monitor.ts`

**7f. `src/cli/commands/status.impl.ts`**

- In `statusImpl`, construct a `ProviderRegistry` after loading config (config is already loaded)
- Pass the registry into `formatSessionLabel`
- In `formatSessionLabel`: get `provider` name from state record (with path-inference fallback), look up in registry, call `provider.getSessionLabel?.(filePath)` for label text
- Use provider name as display prefix: `"claude-code: ..."`, `"codex: ..."` — replacing the `"projects"` path-segment extraction
- Delete the now-redundant `getSessionMetadata` function

### 8. Tests

Three fixture files (covering format variants):

- `tests/fixtures/codex-session-vscode-new.jsonl` — VSCode ≥0.104.0-alpha.1:
  - `session_meta` with `source: "vscode"`, cwd
  - `turn_context` with model
  - `event_msg task_started` + `user_message` with IDE preamble (including `::record @path` command)
  - `response_item function_call` + `function_call_output`
  - `response_item reasoning` with summary
  - Multiple `event_msg agent_message` (commentary)
  - `response_item message role=assistant phase=final_answer`
  - `event_msg task_complete`
  - Second turn (plain user message, verifies multi-turn)
- `tests/fixtures/codex-session-legacy.jsonl` — legacy format (pre-0.104.0, no `task_complete`/`final_answer`):
  - `session_meta` with `source: "cli"`, cwd (CLI is convenient; any source at old version exhibits this)
  - `event_msg user_message` (plain text, no preamble)
  - Tool calls, reasoning
  - Single `event_msg agent_message` (= final response, EOF flush)
- `tests/fixtures/codex-session-exec.jsonl` — exec stub (verify skipped by discovery)

`tests/codex-parser.test.ts` must cover:
- [ ] VSCode fixture: user message extracted correctly (preamble stripped, `::record` args preserved)
- [ ] VSCode fixture: assistant message taken from `final_answer`, not intermediate `agent_message`
- [ ] VSCode fixture: exactly ONE assistant message emitted when both `final_answer` and `task_complete` are present (deduplication guard)
- [ ] Legacy fixture: assistant message taken from EOF-flushed `agent_message`
- [ ] Legacy fixture: user message with no preamble passed through unchanged
- [ ] Aborted turn: `turn_aborted` event (or user message with no following agent content) → user message yielded, NO assistant message emitted, offsets stable
- [ ] Mid-turn resume: parse from non-zero `fromOffset` (past the user message), yields only the assistant message
- [ ] Multi-turn: correct number of user + assistant messages yielded
- [ ] Tool call: `function_call` + `function_call_output` linked by `call_id`, arguments parsed from JSON string
- [ ] Reasoning: summary text mapped to `ThinkingBlock`

`tests/codex-discovery.test.ts` must cover:
- [ ] Walks 3 levels (YYYY/MM/DD) and finds `.jsonl` files
- [ ] Skips `source === "exec"` sessions
- [ ] Reads `workspaceRoot` from `session_meta.payload.cwd`
- [ ] Session ID comes from `session_meta.payload.id`

`tests/codex-provider.test.ts` (getSessionLabel) must cover:
- [ ] VSCode fixture: returns stripped user message text (preamble removed)
- [ ] Legacy fixture: returns plain user message text unchanged
- [ ] exec fixture or empty file: returns null
- [ ] ClaudeCodeProvider.getSessionLabel: returns stripped text from existing Claude fixture (regression: `monitor.ts` logic is now in the provider)

`tests/status.test.ts` / integration — verify `formatSessionLabel` produces:
- [ ] `"claude-code: ..."` prefix for Claude sessions
- [ ] `"codex: ..."` prefix for Codex sessions
- [ ] Raw file path fallback for unknown provider or missing state `provider` field

## Challenges & Notes

### 1. `task_complete` / `final_answer` are version-gated, not source-gated
Both signals appear in **all** `source` values (vscode, cli) at version ≥0.104.0. They are absent in all sessions from versions ≤0.98.0. Observed cutoff across available local sessions:

| Version          | source  | task_complete | final_answer |
|------------------|---------|---------------|--------------|
| ≤0.89.0          | vscode  | ✗             | ✗            |
| 0.98.0           | vscode  | ✗             | ✗            |
| 0.104.0-alpha.1  | vscode  | ✓             | ✓            |
| 0.104.0          | cli     | ✓             | ✓            |

**Gate on signal presence in the file, not on `source` or version string.** The parser must degrade gracefully to the `agent_message` EOF-flush fallback whenever these signals are absent, regardless of client type.

### 2. `exec` sessions must be filtered
Sessions with `source === "exec"` are sandboxed sub-agent execution contexts (typically very short, no real conversation). Discovery must skip them by reading `session_meta.payload.source` from line 1 of each file.

### 3. `turn_context` is NOT a conversation turn boundary
Despite the name, `turn_context` fires on every LLM API round-trip (i.e., after each tool execution). A single user turn can produce dozens of `turn_context` entries. Do not use it for turn demarcation — use `user_message` events instead.

### 4. Directory structure: date-based, not project-based
Claude Code organizes by **project path** (`~/.claude/projects/<encoded-path>/`). Codex organizes by **date** (`~/.codex/sessions/YYYY/MM/DD/`). A single date directory contains sessions from multiple different projects. `workspaceRoot` must come from file content, not the path.

### 5. User message format varies by source
- VSCode: Includes Markdown IDE context preamble; split on `## My request for Codex:\n`
- CLI: Plain text, no preamble; use full message
The parser must handle both without crashing.

### 6. Tool call argument parsing
Codex tool call `arguments` is a **JSON string** (not an object). Must `JSON.parse(arguments)` to get structured input. Malformed JSON should degrade gracefully (catch, return `undefined` input).

### 7. Reasoning is encrypted
`reasoning` entries have `encrypted_content` (opaque) and `summary: [{type:"summary_text", text:string}]` (readable). Map summary texts to `ThinkingBlock.content`. Encrypted content is unreadable — skip it.

### 8. Session ID / file naming
File names are `<label>-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl`. Use **`session_meta.payload.id`** (the UUID) as the canonical session ID — mandatory, not optional. Do not use the filename stem; the UUID in `session_meta` is the authoritative identifier.

### 9. Large files / streaming
The example VSCode session was ~550KB. Consider reading line-by-line with `readline` or a streaming JSON approach rather than `fs.readFile` into memory. The parser doesn't need look-ahead within a turn (unlike Claude Code's tool result linking), making streaming straightforward.

### 10. In-chat command detection
The `::record`, `::capture`, `::export`, `::stop` commands will appear in the extracted user text (after preamble stripping). The existing detector should work without modification.

### 11. Discovery scaling (deferred)
Full date-tree scan on every poll will become slow as session history grows (scanning years of YYYY/MM/DD directories). Mitigations (tracked in `dev.product-ideas.md`): constrain scan to recent date partitions (e.g. last N days), or add incremental file indexing. Out of scope for this task.

### 12. User messages must be yielded immediately
The parser must yield `user` messages at their own byte offset, before any assistant content is accumulated. `monitor.ts:165` calls `handleCommand()` inline — a `::record @file` command must fire the moment the user message hits the file, not after the agent finishes. This is already reflected in the parsing approach (step 1 yields immediately); noted here as a correctness invariant to preserve in code review.
