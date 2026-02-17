import type { LocalContext } from "../context.js";
import { StateManager } from "../../core/state.js";
import { loadConfig } from "../../config.js";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";

interface CleanFlags {
  recordings?: number;
  sessions?: number;
  all?: boolean;
  dryRun?: boolean;
}

/** Extract session slug from JSONL file (search first 10 lines) */
async function getSessionSlug(jsonlPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(jsonlPath, "utf-8");
    const lines = content.split("\n").slice(0, 10);

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.slug) return parsed.slug;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Format a session label as "provider: encoded-path (slug)" */
async function formatSessionLabel(filePath: string): Promise<string> {
  const parts = filePath.split("/");
  const projectsIdx = parts.indexOf("projects");

  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    const encodedPath = parts[projectsIdx + 1]!;
    const slug = await getSessionSlug(filePath);

    const label = `claude: ${encodedPath}`;
    return slug ? `${label} (${slug})` : label;
  }

  return filePath;
}

export async function cleanImpl(
  this: LocalContext,
  flags: CleanFlags,
): Promise<void> {
  const { recordings: recordingsMaxAge, sessions: sessionsMaxAge, all, dryRun } = flags;

  if (!recordingsMaxAge && !sessionsMaxAge && !all) {
    this.process.stdout.write(
      chalk.yellow("No cleanup options specified.\n") +
      "Use --recordings <days>, --sessions <days>, or --all\n" +
      "Run 'clogger clean --help' for more information.\n"
    );
    return;
  }

  const config = await loadConfig();
  const state = new StateManager();
  await state.load();

  const { sessions, recordings } = state.getState();
  const now = Date.now();

  let recordingsToRemove: string[] = [];
  let sessionsToRemove: string[] = [];

  if (all) {
    recordingsToRemove = Object.keys(recordings);
    sessionsToRemove = Object.keys(sessions);
  } else {
    // Find stale recordings
    if (recordingsMaxAge !== undefined) {
      const maxAgeMs = recordingsMaxAge * 24 * 60 * 60 * 1000;
      for (const [sessionId, recording] of Object.entries(recordings)) {
        const lastExported = new Date(recording.lastExported).getTime();
        if (now - lastExported > maxAgeMs) {
          recordingsToRemove.push(sessionId);
        }
      }
    }

    // Find stale sessions
    if (sessionsMaxAge !== undefined) {
      const maxAgeMs = sessionsMaxAge * 24 * 60 * 60 * 1000;
      for (const [sessionId, session] of Object.entries(sessions)) {
        const lastProcessed = new Date(session.lastProcessedTimestamp).getTime();
        if (now - lastProcessed > maxAgeMs) {
          sessionsToRemove.push(sessionId);
        }
      }
    }
  }

  if (recordingsToRemove.length === 0 && sessionsToRemove.length === 0) {
    this.process.stdout.write(chalk.green("Nothing to clean.\n"));
    return;
  }

  // Show what will be removed
  if (dryRun) {
    this.process.stdout.write(chalk.bold("Dry run - no changes will be made\n\n"));
  }

  if (recordingsToRemove.length > 0) {
    this.process.stdout.write(
      chalk.bold(`${dryRun ? "Would remove" : "Removing"} ${recordingsToRemove.length} recording(s):\n`)
    );
    for (const sessionId of recordingsToRemove) {
      const recording = recordings[sessionId]!;
      const session = sessions[sessionId];
      const label = session ? await formatSessionLabel(session.filePath) : sessionId.slice(0, 8) + "...";
      this.process.stdout.write(
        `  ${chalk.red("●")} ${chalk.cyan(label)}\n`
      );
      this.process.stdout.write(
        `    ${chalk.dim("→")} ${recording.outputFile}\n`
      );
    }
    this.process.stdout.write("\n");
  }

  if (sessionsToRemove.length > 0) {
    this.process.stdout.write(
      chalk.bold(`${dryRun ? "Would remove" : "Removing"} ${sessionsToRemove.length} tracked session(s):\n`)
    );
    for (const sessionId of sessionsToRemove) {
      const session = sessions[sessionId]!;
      const label = await formatSessionLabel(session.filePath);
      this.process.stdout.write(
        `  ${chalk.dim("○")} ${chalk.cyan(label)}\n`
      );
    }
    this.process.stdout.write("\n");
  }

  // Actually remove if not dry run
  if (!dryRun) {
    for (const sessionId of recordingsToRemove) {
      state.removeRecording(sessionId);
    }

    for (const sessionId of sessionsToRemove) {
      state.removeSession(sessionId);
    }

    await state.save();
    this.process.stdout.write(chalk.green("State cleaned successfully.\n"));
  }
}
