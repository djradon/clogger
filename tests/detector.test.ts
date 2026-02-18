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

  it("detects ::capture command with args", () => {
    const result = detectCommand("::capture ~/notes/conv.md");
    expect(result).toEqual({
      name: "capture",
      args: "~/notes/conv.md",
      rawMessage: "::capture ~/notes/conv.md",
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

  it("detects ::export command with filename", () => {
    const result = detectCommand("::export my-session.md");
    expect(result).toEqual({
      name: "export",
      args: "my-session.md",
      rawMessage: "::export my-session.md",
    });
  });

  it("detects ::capture command with filename", () => {
    const result = detectCommand("::capture project-log.md");
    expect(result).toEqual({
      name: "capture",
      args: "project-log.md",
      rawMessage: "::capture project-log.md",
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

  it("detects command on first line when multiple commands present", () => {
    const result = detectCommand("::record test.md\nsome other text\n::stop");
    expect(result?.name).toBe("record");
  });

  it("detects commands that don't start at beginning of line", () => {
    const result = detectCommand("We will ::record @path/to/file.md");
    expect(result).toEqual({
      name: "record",
      args: "@path/to/file.md",
      rawMessage: "We will ::record @path/to/file.md",
    });
  });

  it("extracts path from natural language with @-mention", () => {
    const result = detectCommand("Let's ::record this into @notes/conv.md for later");
    expect(result?.name).toBe("record");
    expect(result?.args).toContain("@notes/conv.md");
  });

  it("extracts full path from <ide_opened_file> tag when present", () => {
    const message = `::capture @sflo/documentation/file.md

<ide_opened_file>The user opened the file /home/djradon/hub/semantic-flow/sflo/documentation/file.md in the IDE.</ide_opened_file>`;

    const result = detectCommand(message);
    expect(result).toEqual({
      name: "capture",
      args: "/home/djradon/hub/semantic-flow/sflo/documentation/file.md",
      rawMessage: message,
    });
  });

  it("falls back to visible path when <ide_opened_file> contains non-markdown file", () => {
    const message = `::record @notes/conv.md

<ide_opened_file>The user opened the file /home/user/project/README.txt in the IDE.</ide_opened_file>`;

    const result = detectCommand(message);
    expect(result?.name).toBe("record");
    expect(result?.args).toBe("@notes/conv.md");
  });

  it("detects command on any line, not just first", () => {
    const message = `Some text before the command

::capture @notes/session.md

More text after`;

    const result = detectCommand(message);
    expect(result?.name).toBe("capture");
    expect(result?.args).toContain("@notes/session.md");
  });
});
