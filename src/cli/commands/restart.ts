import { buildCommand } from "@stricli/core";

export const restartCommand = buildCommand({
  loader: async () => {
    const { restartImpl } = await import("./restart.impl.js");
    return restartImpl;
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
    flags: {},
  },
  docs: {
    brief: "Restart the stenobot monitoring daemon",
  },
});
