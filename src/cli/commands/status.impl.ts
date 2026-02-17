import type { LocalContext } from "../context.js";
import { StateManager } from "../../core/state.js";
import { loadConfig } from "../../config.js";
import { expandHome } from "../../utils/paths.js";
import { formatDistanceToNow } from "date-fns";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface StatusFlags {}

/** Check if the daemon process is running */
async function isDaemonRunning(pidFile: string): Promise<{ running: boolean; pid?: number }> {
  let pid: number;
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    pid = parseInt(raw.trim(), 10);
  } catch {
    return { running: false };
  }

  try {
    // Signal 0 tests if the process exists without actually sending a signal
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    return { running: false, pid };
  }
}

interface SessionMetadata {
  sessionId: string;
  firstUserMessage: string | null;
}

/** Extract session metadata from JSONL file */
async function getSessionMetadata(jsonlPath: string): Promise<SessionMetadata | null> {
  try {
    const content = await fs.readFile(jsonlPath, "utf-8");
    const lines = content.split("\n").slice(0, 20);

    let sessionId = "";
    let firstUserMessage: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);

        // Get session ID from any line
        if (!sessionId && parsed.sessionId) {
          sessionId = parsed.sessionId;
        }

        // Get first user message text (skip system tags)
        if (!firstUserMessage && parsed.type === "user" && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === "text" && block.text) {
              // Skip system reminders and tags
              const cleaned = block.text
                .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
                .replace(/<ide_[^>]+>[\s\S]*?<\/ide_[^>]+>/g, "")
                .trim();

              if (cleaned) {
                // Take first ~60 chars, strip newlines
                firstUserMessage = cleaned.replace(/\n/g, " ").slice(0, 60);
                break;
              }
            }
          }
        }

        if (sessionId && firstUserMessage) break;
      } catch {
        continue;
      }
    }

    return sessionId ? { sessionId, firstUserMessage } : null;
  } catch {
    return null;
  }
}

/** Format a session label as "claude: "first message..." (session-id-short)" */
async function formatSessionLabel(filePath: string): Promise<string> {
  const metadata = await getSessionMetadata(filePath);

  if (metadata) {
    const shortId = metadata.sessionId.slice(0, 8);
    const message = metadata.firstUserMessage
      ? `"${metadata.firstUserMessage}..."`
      : `(no message)`;
    return `claude: ${message} (${shortId})`;
  }

  return filePath;
}

/** Format an ISO timestamp as a relative "ago" string */
function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export async function statusImpl(
  this: LocalContext,
  _flags: StatusFlags,
): Promise<void> {
  const config = await loadConfig();
  const pidFile = expandHome(config.daemon.pidFile);

  // Daemon status
  const daemon = await isDaemonRunning(pidFile);
  if (daemon.running) {
    this.process.stdout.write(
      chalk.green("● Daemon running") + chalk.dim(` (PID ${daemon.pid})`) + "\n",
    );
  } else if (daemon.pid) {
    this.process.stdout.write(
      chalk.red("● Daemon not running") + chalk.dim(` (stale PID file: ${daemon.pid})`) + "\n",
    );
  } else {
    this.process.stdout.write(chalk.red("● Daemon not running") + "\n");
  }

  // Load state
  const state = new StateManager();
  await state.load();

  const { sessions, recordings } = state.getState();
  const sessionEntries = Object.entries(sessions);
  const recordingEntries = Object.entries(recordings);

  // Summary line
  this.process.stdout.write(
    chalk.dim(
      `  ${sessionEntries.length} tracked session${sessionEntries.length !== 1 ? "s" : ""}, ` +
      `${recordingEntries.length} active recording${recordingEntries.length !== 1 ? "s" : ""}`,
    ) + "\n",
  );

  // Active recordings (most useful info first)
  if (recordingEntries.length > 0) {
    this.process.stdout.write(chalk.bold("\nRecordings:\n"));
    for (const [id, recording] of recordingEntries) {
      const session = sessions[id];
      const workspace = session ? await formatSessionLabel(session.filePath) : "unknown";
      this.process.stdout.write(
        `  ${chalk.green("●")} ${chalk.cyan(workspace)}\n`,
      );
      this.process.stdout.write(
        `    ${chalk.dim("→")} ${recording.outputFile}\n`,
      );
      this.process.stdout.write(
        `    ${chalk.dim(`Started ${timeAgo(recording.started)} · Last export ${timeAgo(recording.lastExported)}`)}\n`,
      );
    }
  }

  // Tracked sessions (without active recordings)
  const nonRecordingSessions = sessionEntries.filter(
    ([id]) => !recordings[id],
  );
  if (nonRecordingSessions.length > 0) {
    this.process.stdout.write(chalk.bold("\nTracked Sessions:\n"));
    for (const [, session] of nonRecordingSessions) {
      const workspace = await formatSessionLabel(session.filePath);
      this.process.stdout.write(
        `  ${chalk.dim("○")} ${chalk.cyan(workspace)}\n`,
      );
      this.process.stdout.write(
        `    ${chalk.dim(`Last activity ${timeAgo(session.lastProcessedTimestamp)} · Offset ${session.lastProcessedOffset}`)}\n`,
      );
    }
  }

  if (sessionEntries.length === 0 && recordingEntries.length === 0) {
    this.process.stdout.write(chalk.dim("\nNo sessions or recordings in state.\n"));
  }

  this.process.stdout.write("\n");
}
