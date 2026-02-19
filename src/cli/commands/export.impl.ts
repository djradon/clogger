import type { LocalContext } from "../context.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { exportToMarkdown } from "../../core/exporter.js";
import { loadConfig } from "../../config.js";
import { expandHome, ensureMarkdownExtension } from "../../utils/paths.js";
import type { Message } from "../../types/index.js";
import path from "node:path";

interface ExportFlags {
  readonly output?: string;
  readonly thinking?: boolean;
  readonly toolCalls?: boolean;
  readonly italics?: boolean;
}

export async function exportImpl(
  this: LocalContext,
  flags: ExportFlags,
  sessionId: string,
): Promise<void> {
  const config = await loadConfig();
  const registry = new ProviderRegistry(config);

  // Find the session across all providers
  let sessionFilePath: string | undefined;
  let providerName: string | undefined;

  const matches: Array<{ filePath: string; providerName: string; id: string }> = [];

  for (const provider of registry.getAll()) {
    for await (const session of provider.discoverSessions()) {
      if (session.id === sessionId || session.id.startsWith(sessionId)) {
        matches.push({ filePath: session.filePath, providerName: provider.name, id: session.id });
      }
    }
  }

  if (matches.length === 0) {
    this.process.stderr.write(`Session "${sessionId}" not found.\n`);
    return;
  }

  if (matches.length > 1) {
    this.process.stderr.write(
      `Ambiguous session prefix "${sessionId}" matches ${matches.length} sessions:\n` +
      matches.map((m) => `  ${m.id}`).join("\n") + "\n",
    );
    return;
  }

  sessionFilePath = matches[0]!.filePath;
  providerName = matches[0]!.providerName;

  const provider = registry.get(providerName)!;

  // Collect all messages
  const messages: Message[] = [];
  for await (const { message } of provider.parseMessages(sessionFilePath)) {
    messages.push(message);
  }

  if (messages.length === 0) {
    this.process.stderr.write("No messages found in session.\n");
    return;
  }

  // Determine output path
  let outputPath: string;
  if (flags.output) {
    outputPath = ensureMarkdownExtension(expandHome(flags.output));
    if (!path.isAbsolute(outputPath)) {
      outputPath = path.resolve(process.cwd(), outputPath);
    }
  } else {
    outputPath = path.join(
      expandHome(config.outputDirectory),
      `conv.${providerName}.${sessionId}.md`,
    );
  }

  // CLI flags override config defaults
  const metadata = {
    ...config.metadata,
    ...(flags.thinking !== undefined && { includeThinking: flags.thinking }),
    ...(flags.toolCalls !== undefined && { includeToolCalls: flags.toolCalls }),
    ...(flags.italics !== undefined && { italicizeUserMessages: flags.italics }),
  };

  await exportToMarkdown(messages, outputPath, { metadata });

  this.process.stdout.write(
    `Exported ${messages.length} messages to ${outputPath}\n`,
  );
}
