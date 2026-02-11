import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { Session } from "../../types/index.js";

/** Default Claude Code projects directory */
function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** Discover active Claude Code sessions by scanning the projects directory */
export async function* discoverClaudeSessions(): AsyncIterable<Session> {
  const projectsDir = getClaudeProjectsDir();

  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(projectsDir);
  } catch {
    return; // Directory doesn't exist — no sessions
  }

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    const stat = await fs.stat(projectPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    let sessionFiles: string[];
    try {
      sessionFiles = await fs.readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of sessionFiles) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = path.join(projectPath, file);
      const fileStat = await fs.stat(filePath).catch(() => null);
      if (!fileStat) continue;

      const sessionId = path.basename(file, ".jsonl");

      yield {
        id: sessionId,
        provider: "claude-code",
        filePath,
        lastModified: fileStat.mtime,
        workspaceRoot: decodeProjectDir(projectDir),
      };
    }
  }
}

/** Decode a Claude Code project directory name back to a path */
function decodeProjectDir(encoded: string): string {
  // Claude Code encodes paths by replacing path separators with hyphens
  // e.g., "-home-user-project" → "/home/user/project"
  return encoded.replace(/-/g, path.sep);
}
