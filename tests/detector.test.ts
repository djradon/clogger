import { describe, it, expect } from "vitest";
import { detectCommand } from "../src/core/detector.js";

describe("detectCommand", () => {
  it("detects ::record command with filename", () => {
    const result = detectCommand("::record my-conversation.md");
    expect(result).toEqual({
      name: "record",
      args: "my-conversation.md",
      rawMessage: "::record my-conversation.md",
    });
  });

  it("detects ::record command with @-mention path", () => {
    const result = detectCommand("::record @private-notes/conv.design.md");
    expect(result).toEqual({
      name: "record",
      args: "@private-notes/conv.design.md",
      rawMessage: "::record @private-notes/conv.design.md",
    });
  });

  it("detects ::stop command", () => {
    const result = detectCommand("::stop");
    expect(result).toEqual({
      name: "stop",
      args: "",
      rawMessage: "::stop",
    });
  });

  it("detects ::status command", () => {
    const result = detectCommand("::status");
    expect(result).toEqual({
      name: "status",
      args: "",
      rawMessage: "::status",
    });
  });

  it("is case-insensitive", () => {
    const result = detectCommand("::RECORD test.md");
    expect(result).toEqual({
      name: "record",
      args: "test.md",
      rawMessage: "::RECORD test.md",
    });
  });

  it("returns null for non-command messages", () => {
    expect(detectCommand("hello world")).toBeNull();
    expect(detectCommand("let's discuss the :: syntax")).toBeNull();
    expect(detectCommand("")).toBeNull();
  });

  it("returns null for unrecognized commands", () => {
    expect(detectCommand("::foobar")).toBeNull();
    expect(detectCommand("::summarize output.md")).toBeNull();
  });

  it("only looks at the first line", () => {
    const result = detectCommand("::record test.md\nsome other text\n::stop");
    expect(result?.name).toBe("record");
  });
});
