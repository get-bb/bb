import type { TerminalCommandBlock } from "./terminal-command-blocks.js";
import { terminalTextToPlainText } from "./terminal-plain-text.js";

const MAX_FILE_NAME_SLUG_LENGTH = 40;
const MINIMUM_FENCE_LENGTH = 3;

export interface FormatTerminalCommandBlockArgs {
  block: TerminalCommandBlock;
  capturedAt?: string;
  shell?: string | null;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const character of text) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
      continue;
    }
    current = 0;
  }
  return longest;
}

function fenceFor(text: string): string {
  return "`".repeat(
    Math.max(MINIMUM_FENCE_LENGTH, longestBacktickRun(text) + 1),
  );
}

function fencedBlock(language: string, text: string): string {
  const fence = fenceFor(text);
  return `${fence}${language}\n${text}\n${fence}`;
}

function exitCodeLine(block: TerminalCommandBlock): string {
  if (block.running) {
    return "- Exit code: still running";
  }
  if (block.exitCode === null) {
    return "- Exit code: unknown";
  }
  return `- Exit code: ${block.exitCode}`;
}

export function formatTerminalCommandBlockMarkdown(
  args: FormatTerminalCommandBlockArgs,
): string {
  const output = terminalTextToPlainText(args.block.output);
  const metadata = [
    args.block.cwd === null ? null : `- Directory: ${args.block.cwd}`,
    exitCodeLine(args.block),
    args.shell === null || args.shell === undefined
      ? null
      : `- Shell: ${args.shell}`,
    args.capturedAt === undefined ? null : `- Captured: ${args.capturedAt}`,
    args.block.outputTruncated
      ? "- Output truncated: yes, bb captured only the most recent output"
      : null,
  ].filter((line): line is string => line !== null);

  const sections = [
    "# Terminal command",
    metadata.join("\n"),
    "## Command",
    fencedBlock("sh", args.block.command),
    "## Output",
    output.length === 0 ? "No output." : fencedBlock("text", output),
  ];
  return `${sections.join("\n\n")}\n`;
}

export function terminalCommandBlockFileName(
  block: TerminalCommandBlock,
): string {
  const slug = block.command
    .trim()
    .slice(0, MAX_FILE_NAME_SLUG_LENGTH)
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return slug.length === 0 ? "terminal-command.md" : `terminal-${slug}.md`;
}
