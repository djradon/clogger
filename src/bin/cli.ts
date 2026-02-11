#!/usr/bin/env node
import { run } from "@stricli/core";
import { app } from "../cli/app.js";
import { buildContext } from "../cli/context.js";

await run(app, process.argv.slice(2), buildContext(process));
