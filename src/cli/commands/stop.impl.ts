import type { LocalContext } from "../context.js";
import fs from "node:fs/promises";
import { getCloggerDir } from "../../utils/paths.js";
import path from "node:path";

interface StopFlags {}

export async function stopImpl(
  this: LocalContext,
  _flags: StopFlags,
): Promise<void> {
  const pidFile = path.join(getCloggerDir(), "daemon.pid");

  let pid: number;
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    pid = parseInt(raw.trim(), 10);
  } catch {
    this.process.stderr.write("No running clogger daemon found.\n");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    await fs.rm(pidFile, { force: true });
    this.process.stdout.write("clogger daemon stopped.\n");
  } catch {
    this.process.stderr.write(
      `Failed to stop daemon (PID ${pid}). It may have already exited.\n`,
    );
    await fs.rm(pidFile, { force: true });
  }
}
