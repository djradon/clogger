import fs from "node:fs/promises";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { formatInTimeZone } from "date-fns-tz";
import { nanoid } from "nanoid";
import type { Message, CloggerConfig } from "../types/index.js";

export interface ExportOptions {
  title?: string;
  metadata: CloggerConfig["metadata"];
  speakerNames?: {
    user?: string;
    assistant?: string;
  };
}

/** Generate Dendron-compatible YAML frontmatter */
function generateFrontmatter(title: string): string {
  const now = Date.now();
  const frontmatter = {
    id: nanoid(10),
    title,
    desc: "",
    created: now,
    updated: now,
  };
  return `---\n${yamlStringify(frontmatter).trim()}\n---`;
}

/** Format a model ID into a friendly display name, e.g. "claude-opus-4-6" → "claude-opus-4.6" */
function formatModelName(model: string): string {
  // Convert hyphens between version numbers to dots: "claude-opus-4-6" → "claude-opus-4.6"
  return model.replace(/-(\d+)-(\d+)$/, "-$1.$2");
}

/** Format a timestamp into the heading format: Speaker_YYYY-MM-DD_HHMM_SS */
function formatMessageHeading(
  role: string,
  timestamp: string,
  model?: string,
  speakerNames?: ExportOptions["speakerNames"],
): string {
  const date = new Date(timestamp);
  let speaker: string;
  if (role === "user") {
    speaker = speakerNames?.user ?? "User";
  } else if (model) {
    speaker = formatModelName(model);
  } else {
    speaker = speakerNames?.assistant ?? "Claude";
  }
  const formatted = formatInTimeZone(date, "UTC", "yyyy-MM-dd_HHmm_ss");
  return `# ${speaker}_${formatted}`;
}

/** Format a single message to markdown */
export function formatMessage(message: Message, options: ExportOptions): string {
  const parts: string[] = [];

  // Heading with timestamp
  parts.push(
    formatMessageHeading(
      message.role,
      message.timestamp,
      message.model,
      options.speakerNames,
    ),
  );
  parts.push("");

  // Message content
  if (message.role === "user" && options.metadata.italicizeUserMessages) {
    // Wrap user messages in italics, escaping internal asterisks
    const lines = message.content.split("\n");
    const italicized = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        return `*${line.replace(/\*/g, "\\*")}*`;
      })
      .join("\n");
    parts.push(italicized);
  } else {
    parts.push(message.content);
  }

  // Optional: tool calls
  if (options.metadata.includeToolCalls && message.toolCalls?.length) {
    parts.push("");
    parts.push("<details>");
    parts.push("<summary>Tool Calls</summary>");
    parts.push("");
    for (const tool of message.toolCalls) {
      parts.push(
        `**${tool.name}**${tool.description ? `: ${tool.description}` : ""}`,
      );
      if (tool.result) {
        const limit = options.metadata.truncateToolResults;
        const truncated =
          limit > 0 && tool.result.length > limit
            ? tool.result.slice(0, limit) + "..."
            : tool.result;
        parts.push("");
        parts.push("```");
        parts.push(truncated);
        parts.push("```");
      }
      parts.push("");
    }
    parts.push("</details>");
  }

  // Optional: thinking blocks
  if (options.metadata.includeThinking && message.thinkingBlocks?.length) {
    parts.push("");
    parts.push("<details>");
    parts.push("<summary>Thinking</summary>");
    parts.push("");
    for (const block of message.thinkingBlocks) {
      parts.push(block.content.trim());
      parts.push("");
    }
    parts.push("</details>");
  }

  return parts.join("\n");
}

/** Render messages to a markdown string (no file I/O) */
export function renderToString(
  messages: Message[],
  options: ExportOptions & { includeFrontmatter?: boolean },
): string {
  const parts: string[] = [];

  if (options.includeFrontmatter !== false) {
    const title =
      options.title ?? "Untitled Conversation";
    parts.push(generateFrontmatter(title));
    parts.push("");
  }

  for (const message of messages) {
    parts.push(formatMessage(message, options));
    parts.push("");
  }

  return parts.join("\n");
}

/** Export messages to a markdown file (creates or appends) */
export async function exportToMarkdown(
  messages: Message[],
  outputPath: string,
  options: ExportOptions,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let fileExists = false;
  try {
    await fs.access(outputPath);
    fileExists = true;
  } catch {
    // File doesn't exist yet
  }

  if (fileExists) {
    // Append — no frontmatter, just the messages
    const content = renderToString(messages, {
      ...options,
      includeFrontmatter: false,
    });
    await fs.appendFile(outputPath, "\n" + content, "utf-8");
  } else {
    // New file — include frontmatter
    const title = options.title ?? path.basename(outputPath, ".md");
    const content = renderToString(messages, { ...options, title });
    await fs.writeFile(outputPath, content, "utf-8");
  }
}
