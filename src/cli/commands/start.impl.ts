import type { LocalContext } from "../context.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { StateManager } from "../../core/state.js";
import { SessionMonitor } from "../../core/monitor.js";
import { loadConfig, generateDefaultConfig } from "../../config.js";
import { expandHome } from "../../utils/paths.js";
import fs from "node:fs/promises";
import nodePath from "node:path";
import { spawn } from "node:child_process";

interface StartFlags {}

export async function startImpl(
  this: LocalContext,
  _flags: StartFlags,
): Promise<void> {
  // Daemon worker path: we are the background child process
  if (process.env["CLOGGER_DAEMON_MODE"] === "1") {
    await runDaemon(this);
    return;
  }

  // Parent path: spawn the daemon and return to the shell
  const configResult = await generateDefaultConfig();
  if (configResult.created) {
    this.process.stdout.write(`Config file created: ${configResult.path}\n`);
  }

  const config = await loadConfig();
  const pidFile = expandHome(config.daemon.pidFile);

  // Check if already running
  try {
    const existingPid = await fs.readFile(pidFile, "utf-8");
    try {
      process.kill(parseInt(existingPid.trim(), 10), 0);
      this.process.stdout.write(
        `clogger daemon is already running (PID: ${existingPid.trim()})\n`,
      );
      return;
    } catch {
      // Stale PID file — process is gone, proceed to start
    }
  } catch {
    // No PID file, proceed to start
  }

  // Spawn detached child with CLOGGER_DAEMON_MODE=1
  const child = spawn(this.process.execPath, this.process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...this.process.env, CLOGGER_DAEMON_MODE: "1" },
  });
  child.unref();

  await fs.mkdir(nodePath.dirname(pidFile), { recursive: true });
  await fs.writeFile(pidFile, String(child.pid), "utf-8");
  this.process.stdout.write(`clogger daemon started (PID: ${child.pid})\n`);
}

async function runDaemon(ctx: LocalContext): Promise<void> {
  const config = await loadConfig();
  const registry = new ProviderRegistry(config);
  const state = new StateManager();
  const monitor = new SessionMonitor(registry, state, config);

  await monitor.start();

  const pidFile = expandHome(config.daemon.pidFile);

  const shutdown = async () => {
    await monitor.stop();
    await fs.rm(pidFile, { force: true });
    ctx.process.exit(0);
  };

  ctx.process.on("SIGINT", () => void shutdown());
  ctx.process.on("SIGTERM", () => void shutdown());
}
