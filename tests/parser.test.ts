import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseClaudeMessages } from "../src/providers/claude-code/parser.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "claude-session.jsonl");

/** Collect all messages from the async generator */
async function collectMessages(filePath: string, fromOffset?: number) {
  const messages: Awaited<
    ReturnType<typeof parseClaudeMessages> extends AsyncIterable<infer T> ? T : never
  >[] = [];
  for await (const item of parseClaudeMessages(filePath, fromOffset)) {
    messages.push(item);
  }
  return messages;
}

describe("parseClaudeMessages", () => {
  it("parses the fixture into the correct number of aggregated messages", async () => {
    const results = await collectMessages(FIXTURE);
    // Expect: user1, assistant1, user2, assistant2
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("skips non-message types (queue-operation, progress, file-history-snapshot)", async () => {
    const results = await collectMessages(FIXTURE);
    // None of the yielded messages should come from skipped entry types
    // If these weren't skipped, we'd have more than 4 messages
    expect(results).toHaveLength(4);
  });

  it("skips sidechain entries", async () => {
    const results = await collectMessages(FIXTURE);
    // The sidechain assistant message should not appear
    for (const { message } of results) {
      expect(message.content).not.toContain("sidechain message that should be skipped");
    }
  });

  it("extracts user message text correctly", async () => {
    const results = await collectMessages(FIXTURE);
    const user1 = results[0]!.message;
    expect(user1.role).toBe("user");
    expect(user1.content).toBe(
      "I want to add authentication to my app. Can you help?",
    );
    expect(user1.id).toBe("msg-u1");
    expect(user1.timestamp).toBe("2026-02-10T23:36:18.000Z");
  });

  it("aggregates multi-entry assistant turn into one message", async () => {
    const results = await collectMessages(FIXTURE);
    const assistant1 = results[1]!.message;

    expect(assistant1.role).toBe("assistant");
    expect(assistant1.id).toBe("msg-a1a"); // UUID of first entry in the turn

    // Text from msg-a1b and msg-a1e should be merged
    expect(assistant1.content).toContain(
      "I'd be happy to help with authentication!",
    );
    expect(assistant1.content).toContain("I'd recommend using Passport.js");

    // Text blocks joined with double newline
    expect(assistant1.content).toMatch(
      /Let me check your project structure first\.\n\n.*Passport\.js/s,
    );
  });

  it("captures thinking blocks", async () => {
    const results = await collectMessages(FIXTURE);
    const assistant1 = results[1]!.message;

    expect(assistant1.thinkingBlocks).toHaveLength(1);
    expect(assistant1.thinkingBlocks![0]!.content).toBe(
      "The user wants auth. Let me check what framework they're using.",
    );
  });

  it("captures tool calls with descriptions", async () => {
    const results = await collectMessages(FIXTURE);
    const assistant1 = results[1]!.message;

    expect(assistant1.toolCalls).toHaveLength(2);

    const readCall = assistant1.toolCalls![0]!;
    expect(readCall.id).toBe("toolu_read1");
    expect(readCall.name).toBe("Read");
    expect(readCall.description).toBe("/home/user/project/package.json");

    const grepCall = assistant1.toolCalls![1]!;
    expect(grepCall.id).toBe("toolu_grep1");
    expect(grepCall.name).toBe("Grep");
    expect(grepCall.description).toBe("auth|login|session");
  });

  it("links tool results back to tool calls", async () => {
    const results = await collectMessages(FIXTURE);
    const assistant1 = results[1]!.message;

    const readCall = assistant1.toolCalls![0]!;
    expect(readCall.result).toContain('"name": "my-app"');

    const grepCall = assistant1.toolCalls![1]!;
    expect(grepCall.result).toBe("No matches found.");
  });

  it("captures the model name from assistant messages", async () => {
    const results = await collectMessages(FIXTURE);
    const assistant1 = results[1]!.message;
    expect(assistant1.model).toBe("claude-opus-4-6");

    // User messages don't have a model
    const user1 = results[0]!.message;
    expect(user1.model).toBeUndefined();
  });

  it("tracks offsets for resume capability", async () => {
    const results = await collectMessages(FIXTURE);

    // Each yielded offset should be greater than the previous
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.offset).toBeGreaterThan(results[i - 1]!.offset);
    }

    // Resuming from the offset after user1+assistant1 should yield user2+assistant2
    const midOffset = results[1]!.offset;
    const resumed = await collectMessages(FIXTURE, midOffset);
    expect(resumed).toHaveLength(2);
    expect(resumed[0]!.message.content).toContain("Passport.js. Can you set it up?");
    expect(resumed[1]!.message.content).toContain(
      "I'll set up Passport.js with JWT authentication",
    );
  });

  it("handles second user/assistant exchange correctly", async () => {
    const results = await collectMessages(FIXTURE);

    const user2 = results[2]!.message;
    expect(user2.content).toBe(
      "Sounds good, let's go with Passport.js. Can you set it up?",
    );
    expect(user2.timestamp).toBe("2026-02-10T23:40:12.000Z");

    const assistant2 = results[3]!.message;
    expect(assistant2.content).toBe(
      "I'll set up Passport.js with JWT authentication for your Express app.",
    );
  });
});
