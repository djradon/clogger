import type { InChatCommand, InChatCommandName } from "../types/index.js";

const COMMAND_PATTERN = /^::(\w+)\s*(.*)$/i;

const VALID_COMMANDS = new Set<InChatCommandName>([
  "record",
  "stop",
  "pause",
  "resume",
  "status",
]);

/** Detect an in-chat command from a user message */
export function detectCommand(messageText: string): InChatCommand | null {
  // Only look at the first line of the message
  const firstLine = messageText.split("\n")[0]?.trim();
  if (!firstLine) return null;

  const match = COMMAND_PATTERN.exec(firstLine);
  if (!match) return null;

  const name = match[1]!.toLowerCase();
  if (!isValidCommand(name)) return null;

  return {
    name: name as InChatCommandName,
    args: match[2]?.trim() ?? "",
    rawMessage: messageText,
  };
}

function isValidCommand(name: string): name is InChatCommandName {
  return VALID_COMMANDS.has(name as InChatCommandName);
}
