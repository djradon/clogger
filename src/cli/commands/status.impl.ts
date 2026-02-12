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

async function collectValidPaths(
  prefix: string,
  remaining: string,
  results: string[],
): Promise<void> {
  if (!remaining) {
    results.push(prefix);
    return;
  }
  const hyphens: number[] = [];
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === "-") hyphens.push(i);
  }
  for (const pos of hyphens) {
    if (pos === 0) continue;
    const segment = remaining.slice(0, pos);
    const rest = remaining.slice(pos + 1);
    const candidate = path.join(prefix, segment);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        await collectValidPaths(candidate, rest, results);
      }
    } catch { /* not a valid path */ }
  }
  const leaf = path.join(prefix, remaining);
  try {
    await fs.stat(leaf);
    results.push(leaf);
  } catch { /* not a valid path */ }
}

async function resolveEncodedPath(encoded: string): Promise<string> {
  const raw = encoded.startsWith("-") ? encoded.slice(1) : encoded;
  const home = os.homedir();
  const homeEncoded = home.slice(1).replace(/\//g, "-");
  if (raw.startsWith(homeEncoded + "-")) {
    const afterHome = raw.slice(homeEncoded.length + 1);
    const results: string[] = [];
    await collectValidPaths(home, afterHome, results);
    if (results.length > 0) {
      results.sort((a, b) => a.split("/").length - b.split("/").length);
      return results[0]!;
    }
  }
  return encoded;
}

async function workspaceLabel(filePath: string): Promise<string> {
  const parts = filePath.split("/");
  const projectsIdx = parts.indexOf("projects");
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    const encoded = parts[projectsIdx + 1]!;
    return resolveEncodedPath(encoded);
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
      const workspace = session ? await workspaceLabel(session.filePath) : "unknown";
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
      const workspace = await workspaceLabel(session.filePath);
      this.process.stdout.write(
        `  ${chalk.dim("○")} ${chalk.cyan(workspace)}\n`,
      );
      this.process.stdout.write(
        `    ${chalk.dim(`Last activity ${timeAgo(session.lastProcessedTimestamp)}`)}\n`,
      );
    }
  }

  if (sessionEntries.length === 0 && recordingEntries.length === 0) {
    this.process.stdout.write(chalk.dim("\nNo sessions or recordings in state.\n"));
  }

  this.process.stdout.write("\n");
}
