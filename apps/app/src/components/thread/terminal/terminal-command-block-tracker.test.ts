import { describe, expect, it, vi } from "vitest";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import {
  createTerminalCommandBlockTracker,
  readTerminalCommandBlockOutput,
  terminalCommandBlockOutputRange,
  toTerminalCommandBlock,
  type TrackedTerminalCommandBlock,
} from "./terminal-command-block-tracker";

interface FakeBufferLine {
  isWrapped: boolean;
  text: string;
}

interface FakeTerminal {
  cursorX: number;
  emitOsc: (identifier: number, data: string) => boolean;
  lines: FakeBufferLine[];
  markerLine: number;
  terminal: XTermTerminal;
}

function createFakeTerminal(): FakeTerminal {
  const handlers = new Map<number, (data: string) => boolean>();
  const state = {
    cursorX: 0,
    lines: [] as FakeBufferLine[],
    markerLine: 0,
  };
  const terminal = {
    buffer: {
      active: {
        get cursorX() {
          return state.cursorX;
        },
        getLine: (line: number) => {
          const entry = state.lines[line];
          if (entry === undefined) {
            return undefined;
          }
          return {
            isWrapped: entry.isWrapped,
            translateToString: () => entry.text,
          };
        },
      },
    },
    cols: 80,
    parser: {
      registerOscHandler: (
        identifier: number,
        handler: (data: string) => boolean,
      ) => {
        handlers.set(identifier, handler);
        return { dispose: () => handlers.delete(identifier) };
      },
    },
    registerMarker: () => ({
      dispose: () => {},
      line: state.markerLine,
    }),
  } as unknown as XTermTerminal;

  return {
    emitOsc: (identifier, data) => handlers.get(identifier)?.(data) ?? false,
    get cursorX() {
      return state.cursorX;
    },
    set cursorX(value: number) {
      state.cursorX = value;
    },
    get lines() {
      return state.lines;
    },
    set lines(value: FakeBufferLine[]) {
      state.lines = value;
    },
    get markerLine() {
      return state.markerLine;
    },
    set markerLine(value: number) {
      state.markerLine = value;
    },
    terminal,
  };
}

function encodeCommand(command: string): string {
  return Buffer.from(command, "utf8").toString("base64");
}

interface RunCommandBlockArgs {
  command: string;
  exitCode?: number;
  fake: FakeTerminal;
  outputEndCursorX?: number;
  outputEndLine: number;
  outputStartLine: number;
  promptLine: number;
}

function runCommandBlock(args: RunCommandBlockArgs): void {
  args.fake.markerLine = args.promptLine;
  args.fake.emitOsc(133, "A");
  args.fake.emitOsc(133, `P;cmdline_b64=${encodeCommand(args.command)}`);
  args.fake.markerLine = args.outputStartLine;
  args.fake.emitOsc(133, "C");
  args.fake.markerLine = args.outputEndLine;
  args.fake.cursorX = args.outputEndCursorX ?? 0;
  args.fake.emitOsc(133, `D;${args.exitCode ?? 0}`);
}

describe("createTerminalCommandBlockTracker", () => {
  it("tracks a finished command with its prompt line and exit code", () => {
    const fake = createFakeTerminal();
    const onBlockFinished = vi.fn();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished,
      terminal: fake.terminal,
    });

    fake.emitOsc(7, "file:///Users/rachel/bb");
    runCommandBlock({
      command: "ls",
      fake,
      outputEndLine: 3,
      outputStartLine: 1,
      promptLine: 0,
    });

    expect(onBlockFinished).toHaveBeenCalledTimes(1);
    const blocks = tracker.blocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      command: "ls",
      cwd: "/Users/rachel/bb",
      exitCode: 0,
      running: false,
    });
    expect(blocks[0]?.promptMarker.line).toBe(0);
    tracker.dispose();
  });

  it("excludes the prompt line and the following prompt from the output range", () => {
    const fake = createFakeTerminal();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished: () => {},
      terminal: fake.terminal,
    });
    fake.lines = [
      { isWrapped: false, text: "prompt$ ls" },
      { isWrapped: false, text: "AGENTS.md" },
      { isWrapped: false, text: "apps" },
      { isWrapped: false, text: "prompt$ " },
    ];

    runCommandBlock({
      command: "ls",
      fake,
      outputEndLine: 3,
      outputStartLine: 1,
      promptLine: 0,
    });

    const block = tracker.blocks()[0];
    expect(terminalCommandBlockOutputRange(block!)).toEqual({
      endLine: 2,
      startLine: 1,
    });
    expect(readTerminalCommandBlockOutput(fake.terminal, block!)).toBe(
      "AGENTS.md\napps",
    );
    tracker.dispose();
  });

  it("includes the final line when output did not end in a newline", () => {
    const fake = createFakeTerminal();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished: () => {},
      terminal: fake.terminal,
    });
    fake.lines = [
      { isWrapped: false, text: "prompt$ printf hi" },
      { isWrapped: false, text: "hi" },
    ];

    runCommandBlock({
      command: "printf hi",
      fake,
      outputEndCursorX: 2,
      outputEndLine: 1,
      outputStartLine: 1,
      promptLine: 0,
    });

    expect(
      readTerminalCommandBlockOutput(fake.terminal, tracker.blocks()[0]!),
    ).toBe("hi");
    tracker.dispose();
  });

  it("rejoins wrapped buffer lines into one logical line", () => {
    const fake = createFakeTerminal();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished: () => {},
      terminal: fake.terminal,
    });
    fake.lines = [
      { isWrapped: false, text: "prompt$ echo long" },
      { isWrapped: false, text: "start-of-a-very-long" },
      { isWrapped: true, text: "-wrapped-line" },
      { isWrapped: false, text: "second" },
      { isWrapped: false, text: "prompt$ " },
    ];

    runCommandBlock({
      command: "echo long",
      fake,
      outputEndLine: 4,
      outputStartLine: 1,
      promptLine: 0,
    });

    expect(
      readTerminalCommandBlockOutput(fake.terminal, tracker.blocks()[0]!),
    ).toBe("start-of-a-very-long-wrapped-line\nsecond");
    tracker.dispose();
  });

  it("ignores a prompt submitted with no command", () => {
    const fake = createFakeTerminal();
    const onBlockFinished = vi.fn();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished,
      terminal: fake.terminal,
    });

    fake.emitOsc(133, "A");
    fake.emitOsc(133, "C");
    fake.emitOsc(133, "D;0");

    expect(onBlockFinished).not.toHaveBeenCalled();
    expect(tracker.blocks()).toEqual([]);
    tracker.dispose();
  });

  it("stops tracking after reset so stale lines are not reused", () => {
    const fake = createFakeTerminal();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished: () => {},
      terminal: fake.terminal,
    });
    runCommandBlock({
      command: "ls",
      fake,
      outputEndLine: 2,
      outputStartLine: 1,
      promptLine: 0,
    });

    tracker.reset();

    expect(tracker.blocks()).toEqual([]);
    tracker.dispose();
  });

  it("claims the command-block sequences and leaves cwd reporting to xterm", () => {
    const fake = createFakeTerminal();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished: () => {},
      terminal: fake.terminal,
    });

    expect(fake.emitOsc(133, "A")).toBe(true);
    expect(fake.emitOsc(133, "unknown-code")).toBe(false);
    expect(fake.emitOsc(7, "file:///tmp")).toBe(false);
    tracker.dispose();
  });

  it("builds a domain command block with the rendered output", () => {
    const fake = createFakeTerminal();
    const tracker = createTerminalCommandBlockTracker({
      onBlockFinished: () => {},
      terminal: fake.terminal,
    });
    fake.lines = [
      { isWrapped: false, text: "prompt$ ls" },
      { isWrapped: false, text: "AGENTS.md" },
      { isWrapped: false, text: "prompt$ " },
    ];
    fake.emitOsc(7, "file:///Users/rachel/bb");
    runCommandBlock({
      command: "ls",
      exitCode: 2,
      fake,
      outputEndLine: 2,
      outputStartLine: 1,
      promptLine: 0,
    });

    const tracked = tracker.blocks()[0] as TrackedTerminalCommandBlock;
    expect(toTerminalCommandBlock(fake.terminal, tracked)).toEqual({
      command: "ls",
      cwd: "/Users/rachel/bb",
      exitCode: 2,
      index: 0,
      output: "AGENTS.md",
      outputTruncated: false,
      running: false,
    });
    tracker.dispose();
  });
});
