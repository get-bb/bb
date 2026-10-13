import { describe, expect, it } from "vitest";
import {
  createTerminalCommandBlockReader,
  readTerminalCommandBlocks,
} from "../src/terminal-command-blocks.js";
import {
  formatTerminalCommandBlockMarkdown,
  terminalCommandBlockFileName,
} from "../src/terminal-command-block-format.js";
import { terminalTextToPlainText } from "../src/terminal-plain-text.js";

function encodeCommand(command: string): string {
  const bytes = new TextEncoder().encode(command);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function block(command: string, output: string, exitCode = 0): string {
  return [
    "\u001b]133;A\u0007",
    `prompt$ ${command}\r\n`,
    `\u001b]133;P;cmdline_b64=${encodeCommand(command)}\u0007`,
    "\u001b]133;C\u0007",
    output,
    `\u001b]133;D;${exitCode}\u0007`,
  ].join("");
}

describe("terminal command block reader", () => {
  it("captures command, output, cwd and exit code between markers", () => {
    const stream = [
      "\u001b]7;file://host/Users/rachel/bb\u0007",
      block("ls", "AGENTS.md\r\napps\r\n"),
      "\u001b]133;A\u0007prompt$ ",
    ].join("");

    const blocks = readTerminalCommandBlocks(stream);

    expect(blocks).toEqual([
      {
        command: "ls",
        cwd: "/Users/rachel/bb",
        exitCode: 0,
        index: 0,
        output: "AGENTS.md\r\napps\r\n",
        outputTruncated: false,
        running: false,
      },
    ]);
  });

  it("excludes the prompt line and echoed typing from captured output", () => {
    const blocks = readTerminalCommandBlocks(block("echo hi", "hi\r\n"));

    expect(blocks[0]?.output).toBe("hi\r\n");
    expect(blocks[0]?.output).not.toContain("prompt$");
  });

  it("records a non-zero exit code", () => {
    const blocks = readTerminalCommandBlocks(block("false", "", 1));

    expect(blocks[0]?.exitCode).toBe(1);
  });

  it("reports a command with no finish marker as running", () => {
    const stream = [
      "\u001b]133;A\u0007",
      `\u001b]133;P;cmdline_b64=${encodeCommand("sleep 10")}\u0007`,
      "\u001b]133;C\u0007",
      "working\r\n",
    ].join("");

    const blocks = readTerminalCommandBlocks(stream);

    expect(blocks).toEqual([
      {
        command: "sleep 10",
        cwd: null,
        exitCode: null,
        index: 0,
        output: "working\r\n",
        outputTruncated: false,
        running: true,
      },
    ]);
  });

  it("parses markers split across chunk boundaries", () => {
    const stream = block("pwd", "/tmp\r\n");
    const reader = createTerminalCommandBlockReader();
    for (const character of stream) {
      reader.push(character);
    }

    expect(reader.blocks()).toEqual([
      {
        command: "pwd",
        cwd: null,
        exitCode: 0,
        index: 0,
        output: "/tmp\r\n",
        outputTruncated: false,
        running: false,
      },
    ]);
  });

  it("drops empty commands so a bare Enter does not create a block", () => {
    const stream = [
      "\u001b]133;A\u0007prompt$ \r\n",
      "\u001b]133;C\u0007",
      "\u001b]133;D;0\u0007",
      block("ls", "AGENTS.md\r\n"),
    ].join("");

    const blocks = readTerminalCommandBlocks(stream);

    expect(blocks.map((entry) => entry.command)).toEqual(["ls"]);
  });

  it("truncates output beyond the capture limit and flags it", () => {
    const blocks = readTerminalCommandBlocks(block("yes", "x".repeat(50)), {
      maxOutputCharacters: 10,
    });

    expect(blocks[0]?.output).toBe("x".repeat(10));
    expect(blocks[0]?.outputTruncated).toBe(true);
  });

  it("retains only the most recent blocks", () => {
    const stream = [
      block("one", "1\r\n"),
      block("two", "2\r\n"),
      block("three", "3\r\n"),
    ].join("");

    const blocks = readTerminalCommandBlocks(stream, { maxBlocks: 2 });

    expect(blocks.map((entry) => entry.command)).toEqual(["two", "three"]);
    expect(blocks.map((entry) => entry.index)).toEqual([1, 2]);
  });

  it("leaves unrelated escape sequences in the captured output", () => {
    const blocks = readTerminalCommandBlocks(
      block("ls", "\u001b[32mapps\u001b[0m\r\n"),
    );

    expect(blocks[0]?.output).toBe("\u001b[32mapps\u001b[0m\r\n");
    expect(terminalTextToPlainText(blocks[0]?.output ?? "")).toBe("apps");
  });

  it("ignores a cmdline property that is not valid base64", () => {
    const stream = [
      "\u001b]133;A\u0007",
      "\u001b]133;P;cmdline_b64=!!!not-base64!!!\u0007",
      "\u001b]133;C\u0007",
      "output\r\n",
      "\u001b]133;D;0\u0007",
    ].join("");

    expect(readTerminalCommandBlocks(stream)).toEqual([]);
  });

  it("accepts string-terminator framing as well as bell framing", () => {
    const stream = [
      "\u001b]133;A\u001b\\",
      `\u001b]133;P;cmdline_b64=${encodeCommand("date")}\u001b\\`,
      "\u001b]133;C\u001b\\",
      "today\r\n",
      "\u001b]133;D;0\u001b\\",
    ].join("");

    expect(readTerminalCommandBlocks(stream)[0]).toMatchObject({
      command: "date",
      exitCode: 0,
      output: "today\r\n",
    });
  });
});

describe("terminal plain text", () => {
  it("applies carriage-return overwrites so progress output collapses", () => {
    expect(terminalTextToPlainText("10%\r50%\r100%\r\ndone\r\n")).toBe(
      "100%\ndone",
    );
  });

  it("honours erase-to-end-of-line after a carriage return", () => {
    expect(terminalTextToPlainText("downloading...\rdone\u001b[K\r\n")).toBe(
      "done",
    );
  });

  it("strips hyperlink and title sequences", () => {
    expect(
      terminalTextToPlainText(
        "\u001b]0;title\u0007\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007",
      ),
    ).toBe("link");
  });

  it("expands tabs to the next eight-column stop", () => {
    expect(terminalTextToPlainText("ab\tc")).toBe("ab      c");
  });

  it("trims trailing blank lines and trailing spaces", () => {
    expect(terminalTextToPlainText("a   \r\n\r\n\r\n")).toBe("a");
  });
});

describe("terminal command block markdown", () => {
  it("renders command, metadata and output for the agent", () => {
    const blocks = readTerminalCommandBlocks(
      [
        "\u001b]7;file://host/Users/rachel/bb\u0007",
        block("ls", "AGENTS.md\r\napps\r\n"),
      ].join(""),
    );

    const markdown = formatTerminalCommandBlockMarkdown({
      block: blocks[0]!,
      capturedAt: "2026-10-13T20:12:01.000Z",
      shell: "zsh",
    });

    expect(markdown).toBe(
      [
        "# Terminal command",
        "",
        "- Directory: /Users/rachel/bb",
        "- Exit code: 0",
        "- Shell: zsh",
        "- Captured: 2026-10-13T20:12:01.000Z",
        "",
        "## Command",
        "",
        "```sh",
        "ls",
        "```",
        "",
        "## Output",
        "",
        "```text",
        "AGENTS.md",
        "apps",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("uses a longer fence when the output contains a code fence", () => {
    const blocks = readTerminalCommandBlocks(
      block("cat readme.md", "```sh\r\nls\r\n```\r\n"),
    );

    const markdown = formatTerminalCommandBlockMarkdown({ block: blocks[0]! });

    expect(markdown).toContain("````text\n```sh\nls\n```\n````");
  });

  it("says there was no output instead of emitting an empty fence", () => {
    const blocks = readTerminalCommandBlocks(block("true", ""));

    expect(formatTerminalCommandBlockMarkdown({ block: blocks[0]! })).toContain(
      "## Output\n\nNo output.\n",
    );
  });

  it("flags truncated output and a running command", () => {
    const stream = [
      "\u001b]133;A\u0007",
      `\u001b]133;P;cmdline_b64=${encodeCommand("yes")}\u0007`,
      "\u001b]133;C\u0007",
      "y\r\n".repeat(20),
    ].join("");
    const blocks = readTerminalCommandBlocks(stream, {
      maxOutputCharacters: 10,
    });

    const markdown = formatTerminalCommandBlockMarkdown({ block: blocks[0]! });

    expect(markdown).toContain("- Exit code: still running");
    expect(markdown).toContain("- Output truncated: yes");
  });

  it("derives a readable file name from the command", () => {
    expect(
      terminalCommandBlockFileName({
        command: "pnpm exec turbo run test --filter=@bb/domain",
        cwd: null,
        exitCode: 0,
        index: 0,
        output: "",
        outputTruncated: false,
        running: false,
      }),
    ).toBe("terminal-pnpm-exec-turbo-run-test-filter-bb-do.md");
  });
});
