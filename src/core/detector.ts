import type { InChatCommand, InChatCommandName } from "../types/index.js";

const COMMAND_PATTERN = /::(\w+)\s*(.*)$/i;

const VALID_COMMANDS = new Set<InChatCommandName>([
  "record",
  "export",
  "capture",
  "stop",
]);

/** Extract a file path from args that may contain natural language */
function extractPath(rawArgs: string, fullMessage: string): string {
  const trimmed = rawArgs.trim();
  if (!trimmed) return "";

  // First, check if there's an <ide_opened_file> tag with the full path
  // VSCode @-mentions include this tag with the absolute path
  const ideFileMatch = /<ide_opened_file>The user opened the file ([^<]+) in the IDE\.<\/ide_opened_file>/i.exec(fullMessage);
  if (ideFileMatch) {
    const fullPath = ideFileMatch[1]!.trim();
    // Only use this path if it's a markdown file and matches the visible path pattern
    if (fullPath.endsWith('.md')) {
      return fullPath;
    }
  }

  // Look for @-mention paths (e.g., "@notes/file.md")
  const mentionMatch = /@[\w\-./~]+\.md/i.exec(trimmed);
  if (mentionMatch) return mentionMatch[0]!;

  // Look for file paths with .md extension
  const pathMatch = /[\w\-./~]+\.md/i.exec(trimmed);
  if (pathMatch) return pathMatch[0]!;

  // Return the whole thing if no path pattern found (backward compatible)
  return trimmed;
}

/** Detect an in-chat command from a user message */
export function detectCommand(messageText: string): InChatCommand | null {
  // Check each line for a command (not just first line)
  const lines = messageText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = COMMAND_PATTERN.exec(trimmed);
    if (!match) continue;

    const name = match[1]!.toLowerCase();
    if (!isValidCommand(name)) continue;

    const rawArgs = match[2]?.trim() ?? "";
    const args = extractPath(rawArgs, messageText);

    return {
      name: name as InChatCommandName,
      args,
      rawMessage: messageText,
    };
  }

  return null;
}

function isValidCommand(name: string): name is InChatCommandName {
  return VALID_COMMANDS.has(name as InChatCommandName);
}
