import fs from "node:fs/promises";
import type { Message, ToolCall, ThinkingBlock } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Raw JSONL entry types (internal)
// ---------------------------------------------------------------------------

interface RawContentBlock {
  type: string;
  [key: string]: unknown;
}

interface RawEntry {
  type: string;
  uuid: string;
  timestamp: string;
  isSidechain?: boolean;
  message?: {
    role: string;
    model?: string;
    content: RawContentBlock[];
  };
}

// ---------------------------------------------------------------------------
// Phase A: Line-level parsing
// ---------------------------------------------------------------------------

interface ParsedLine {
  entry: RawEntry;
  endOffset: number;
}

function* parseLines(
  content: string,
  fromOffset: number,
): Generator<ParsedLine> {
  const lines = content.split("\n");
  let currentOffset = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf-8") + 1; // +1 for newline
    const endOffset = currentOffset + lineBytes;

    if (currentOffset < fromOffset || !line.trim()) {
      currentOffset = endOffset;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      currentOffset = endOffset;
      continue;
    }

    const entry = parsed as RawEntry;

    // Skip non-message types and sidechains
    if (entry.type !== "user" && entry.type !== "assistant") {
      currentOffset = endOffset;
      continue;
    }
    if (entry.isSidechain) {
      currentOffset = endOffset;
      continue;
    }
    if (!entry.message?.content || !Array.isArray(entry.message.content)) {
      currentOffset = endOffset;
      continue;
    }

    yield { entry, endOffset };
    currentOffset = endOffset;
  }
}

// ---------------------------------------------------------------------------
// Phase B: Turn aggregation
// ---------------------------------------------------------------------------

/** Check if a user entry is a "real" user message (has text content, not just tool results) */
function isUserTextEntry(entry: RawEntry): boolean {
  return entry.message!.content.some((b) => b.type === "text");
}

/** Extract text blocks from a content array, joining with double newlines */
function extractText(content: RawContentBlock[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => String(b["text"] ?? ""))
    .join("\n\n");
}

/** Extract thinking blocks from a content array */
function extractThinking(content: RawContentBlock[]): ThinkingBlock[] {
  return content
    .filter((b) => b.type === "thinking")
    .map((b) => ({ content: String(b["thinking"] ?? "") }));
}

/** Extract tool_use blocks as ToolCall objects */
function extractToolUses(content: RawContentBlock[]): ToolCall[] {
  return content
    .filter((b) => b.type === "tool_use")
    .map((b) => {
      const name = String(b["name"] ?? "unknown");
      const input = b["input"] as Record<string, unknown> | undefined;
      return {
        id: String(b["id"] ?? ""),
        name,
        description: deriveToolDescription(name, input),
        input,
      };
    });
}

/** Derive a human-readable description from tool name + input */
function deriveToolDescription(
  name: string,
  input?: Record<string, unknown>,
): string | undefined {
  if (!input) return undefined;
  switch (name) {
    case "Bash":
      return (
        (input.description as string | undefined) ??
        truncate(input.command as string | undefined, 80)
      );
    case "Read":
    case "Edit":
    case "Write":
      return input.file_path as string | undefined;
    case "Grep":
    case "Glob":
      return input.pattern as string | undefined;
    case "Task":
      return input.description as string | undefined;
    default:
      return undefined;
  }
}

function truncate(str: string | undefined, max: number): string | undefined {
  if (!str) return undefined;
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/** Extract tool_result content as text */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b: unknown) =>
          typeof b === "object" && b !== null && (b as RawContentBlock).type === "text",
      )
      .map((b: unknown) => ((b as { text: string }).text))
      .join("\n");
  }
  return "";
}

/** Link tool_result blocks from a user entry back to pending tool calls */
function linkToolResults(
  content: RawContentBlock[],
  pendingTools: Map<string, ToolCall>,
): void {
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const toolUseId = block.tool_use_id as string;
    const toolCall = pendingTools.get(toolUseId);
    if (toolCall) {
      toolCall.result = extractToolResultText(block.content);
      pendingTools.delete(toolUseId);
    }
  }
}

function makeMessage(
  role: "user" | "assistant",
  uuid: string,
  timestamp: string,
  textParts: string[],
  toolCalls: ToolCall[],
  thinkingBlocks: ThinkingBlock[],
  model?: string,
): Message {
  return {
    id: uuid,
    role,
    content: textParts.join("\n\n"),
    timestamp,
    ...(model && { model }),
    ...(toolCalls.length > 0 && { toolCalls }),
    ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a Claude Code JSONL session file into normalized, turn-aggregated messages */
export async function* parseClaudeMessages(
  filePath: string,
  fromOffset: number = 0,
): AsyncIterable<{ message: Message; offset: number }> {
  const content = await fs.readFile(filePath, "utf-8");

  // Track pending state for aggregation
  let currentRole: "user" | "assistant" | null = null;
  let currentUuid = "";
  let currentTimestamp = "";
  let currentModel: string | undefined;
  let textParts: string[] = [];
  let toolCalls: ToolCall[] = [];
  let thinkingBlocks: ThinkingBlock[] = [];
  let lastOffset = fromOffset;
  const pendingTools = new Map<string, ToolCall>();

  function* flushCurrent(): Generator<{ message: Message; offset: number }> {
    if (!currentRole) return;
    if (textParts.length > 0 || toolCalls.length > 0 || thinkingBlocks.length > 0) {
      yield {
        message: makeMessage(
          currentRole,
          currentUuid,
          currentTimestamp,
          textParts,
          toolCalls,
          thinkingBlocks,
          currentModel,
        ),
        offset: lastOffset,
      };
    }
    currentRole = null;
    currentModel = undefined;
    textParts = [];
    toolCalls = [];
    thinkingBlocks = [];
  }

  for (const { entry, endOffset } of parseLines(content, fromOffset)) {
    if (entry.type === "user") {
      const blocks = entry.message!.content;
      const hasText = isUserTextEntry(entry);

      if (hasText) {
        // Real user message — flush any pending assistant turn, then any pending user turn
        yield* flushCurrent();

        // Start new user turn
        currentRole = "user";
        currentUuid = entry.uuid;
        currentTimestamp = entry.timestamp;
        textParts = [];
        const text = extractText(blocks);
        if (text) textParts.push(text);
      }

      // Always process tool_result blocks (even in user entries that also have text)
      linkToolResults(blocks, pendingTools);
    } else if (entry.type === "assistant") {
      if (currentRole !== "assistant") {
        // Transitioning to assistant — flush the current user turn
        yield* flushCurrent();
        currentRole = "assistant";
        currentUuid = entry.uuid;
        currentTimestamp = entry.timestamp;
        currentModel = entry.message!.model;
      }

      const blocks = entry.message!.content;

      // Accumulate text
      const text = extractText(blocks);
      if (text) textParts.push(text);

      // Accumulate thinking
      thinkingBlocks.push(...extractThinking(blocks));

      // Accumulate tool calls and register them as pending for result linking
      const newToolCalls = extractToolUses(blocks);
      toolCalls.push(...newToolCalls);
      for (const tc of newToolCalls) {
        pendingTools.set(tc.id, tc);
      }
    }

    lastOffset = endOffset;
  }

  // Flush the final turn
  yield* flushCurrent();
}
