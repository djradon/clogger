import type { Provider } from "../base.js";
import type { Message, Session } from "../../types/index.js";
import { discoverClaudeSessions } from "./discovery.js";
import { parseClaudeMessages } from "./parser.js";

export class ClaudeCodeProvider implements Provider {
  readonly name = "claude-code";

  discoverSessions(): AsyncIterable<Session> {
    return discoverClaudeSessions();
  }

  parseMessages(
    sessionFilePath: string,
    fromOffset?: number,
  ): AsyncIterable<{ message: Message; offset: number }> {
    return parseClaudeMessages(sessionFilePath, fromOffset);
  }

  resolveWorkspaceRoot(sessionFilePath: string): string | undefined {
    // The workspace root is encoded in the parent directory name
    // e.g., ~/.claude/projects/-home-user-myproject/session.jsonl
    const parts = sessionFilePath.split("/");
    const projectDirIndex = parts.indexOf("projects");
    if (projectDirIndex >= 0 && projectDirIndex + 1 < parts.length) {
      const encoded = parts[projectDirIndex + 1]!;
      return encoded.replace(/-/g, "/");
    }
    return undefined;
  }
}
