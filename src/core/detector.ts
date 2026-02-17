import type { InChatCommand, InChatCommandName } from "../types/index.js";

const COMMAND_PATTERN = /::(\w+)\s*(.*)$/i;

const VALID_COMMANDS = new Set<InChatCommandName>([
  "record",
  "export",
  "capture",
  "stop",
]);

/** Extract a file path from args that may contain natural language */
function extractPath(rawArgs: string): string {
  const trimmed = rawArgs.trim();
  if (!trimmed) return "";

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
  // Only look at the first line of the message
  const firstLine = messageText.split("\n")[0]?.trim();
  if (!firstLine) return null;

  const match = COMMAND_PATTERN.exec(firstLine);
  if (!match) return null;

  const name = match[1]!.toLowerCase();
  if (!isValidCommand(name)) return null;

  const rawArgs = match[2]?.trim() ?? "";
  const args = extractPath(rawArgs);

  return {
    name: name as InChatCommandName,
    args,
    rawMessage: messageText,
  };
}

function isValidCommand(name: string): name is InChatCommandName {
  return VALID_COMMANDS.has(name as InChatCommandName);
}
