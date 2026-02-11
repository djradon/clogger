import { buildCommand } from "@stricli/core";

export const statusCommand = buildCommand({
  loader: async () => {
    const { statusImpl } = await import("./status.impl.js");
    return statusImpl;
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
    flags: {},
  },
  docs: {
    brief: "Show active sessions and recordings",
  },
});
