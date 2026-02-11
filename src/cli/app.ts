import { buildApplication, buildRouteMap } from "@stricli/core";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { exportCommand } from "./commands/export.js";

const routes = buildRouteMap({
  routes: {
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    export: exportCommand,
  },
  docs: {
    brief: "Chat logger — monitor and export LLM conversation logs to markdown",
  },
});

export const app = buildApplication(routes, {
  name: "clogger",
  versionInfo: {
    currentVersion: "0.1.0",
  },
});
