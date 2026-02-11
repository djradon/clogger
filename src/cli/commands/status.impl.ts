import type { LocalContext } from "../context.js";
import { StateManager } from "../../core/state.js";
import chalk from "chalk";

interface StatusFlags {}

export async function statusImpl(
  this: LocalContext,
  _flags: StatusFlags,
): Promise<void> {
  const state = new StateManager();
  await state.load();

  const { sessions, recordings } = state.getState();

  const sessionIds = Object.keys(sessions);
  const recordingIds = Object.keys(recordings);

  if (sessionIds.length === 0 && recordingIds.length === 0) {
    this.process.stdout.write("No active sessions or recordings.\n");
    return;
  }

  if (sessionIds.length > 0) {
    this.process.stdout.write(chalk.bold("\nTracked Sessions:\n"));
    for (const [id, session] of Object.entries(sessions)) {
      this.process.stdout.write(
        `  ${chalk.cyan(id)} → ${session.filePath}\n`,
      );
      this.process.stdout.write(
        `    Last processed: ${session.lastProcessedTimestamp}\n`,
      );
    }
  }

  if (recordingIds.length > 0) {
    this.process.stdout.write(chalk.bold("\nActive Recordings:\n"));
    for (const [id, recording] of Object.entries(recordings)) {
      this.process.stdout.write(
        `  ${chalk.green(id)} → ${recording.outputFile}\n`,
      );
      this.process.stdout.write(
        `    Started: ${recording.started} | Last export: ${recording.lastExported}\n`,
      );
    }
  }

  this.process.stdout.write("\n");
}
