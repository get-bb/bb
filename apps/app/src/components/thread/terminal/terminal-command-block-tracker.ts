import type {
  IDisposable,
  IMarker,
  Terminal as XTermTerminal,
} from "@xterm/xterm";
import {
  TERMINAL_COMMAND_BLOCK_OSC_IDENTIFIER,
  TERMINAL_CWD_OSC_IDENTIFIER,
  parseTerminalCommandBlockOsc,
  parseTerminalCwdOsc,
  type TerminalCommandBlock,
} from "@bb/domain";

const MAX_TRACKED_BLOCKS = 200;

export interface TrackedTerminalCommandBlock {
  command: string;
  cwd: string | null;
  exitCode: number | null;
  id: number;
  outputEndCursorX: number;
  outputEndMarker: IMarker | null;
  outputStartMarker: IMarker | null;
  promptMarker: IMarker;
  running: boolean;
}

export interface TerminalCommandBlockTrackerOptions {
  onBlockFinished: (block: TrackedTerminalCommandBlock) => void;
  terminal: XTermTerminal;
}

export interface TerminalCommandBlockTracker extends IDisposable {
  blocks(): TrackedTerminalCommandBlock[];
  reset(): void;
}

interface TerminalBufferRange {
  endLine: number;
  startLine: number;
}

export function terminalCommandBlockOutputRange(
  block: TrackedTerminalCommandBlock,
): TerminalBufferRange | null {
  const start = block.outputStartMarker;
  const end = block.outputEndMarker;
  if (start === null || end === null) {
    return null;
  }
  if (start.line < 0 || end.line < 0) {
    return null;
  }
  const endLine = block.outputEndCursorX > 0 ? end.line : end.line - 1;
  if (endLine < start.line) {
    return null;
  }
  return { endLine, startLine: start.line };
}

export function readTerminalBufferLines(
  terminal: XTermTerminal,
  range: TerminalBufferRange,
): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let line = range.startLine; line <= range.endLine; line += 1) {
    const bufferLine = buffer.getLine(line);
    if (bufferLine === undefined) {
      continue;
    }
    const text = bufferLine.translateToString(true);
    if (bufferLine.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
      continue;
    }
    lines.push(text);
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  return lines.map((line) => line.replace(/\s+$/u, ""));
}

export function readTerminalCommandBlockOutput(
  terminal: XTermTerminal,
  block: TrackedTerminalCommandBlock,
): string {
  const range = terminalCommandBlockOutputRange(block);
  if (range === null) {
    return "";
  }
  return readTerminalBufferLines(terminal, range).join("\n");
}

export function toTerminalCommandBlock(
  terminal: XTermTerminal,
  block: TrackedTerminalCommandBlock,
): TerminalCommandBlock {
  return {
    command: block.command,
    cwd: block.cwd,
    exitCode: block.exitCode,
    index: block.id,
    output: readTerminalCommandBlockOutput(terminal, block),
    outputTruncated: false,
    running: block.running,
  };
}

export function createTerminalCommandBlockTracker(
  options: TerminalCommandBlockTrackerOptions,
): TerminalCommandBlockTracker {
  const { terminal } = options;
  const tracked: TrackedTerminalCommandBlock[] = [];
  let open: TrackedTerminalCommandBlock | null = null;
  let latestCwd: string | null = null;
  let nextId = 0;
  let disposed = false;

  const pruneTracked = (): void => {
    while (tracked.length > MAX_TRACKED_BLOCKS) {
      const removed = tracked.shift();
      removed?.promptMarker.dispose();
      removed?.outputStartMarker?.dispose();
      removed?.outputEndMarker?.dispose();
    }
  };

  const startBlock = (): void => {
    const promptMarker = terminal.registerMarker(0);
    if (promptMarker === undefined) {
      open = null;
      return;
    }
    open = {
      command: "",
      cwd: latestCwd,
      exitCode: null,
      id: nextId,
      outputEndCursorX: 0,
      outputEndMarker: null,
      outputStartMarker: null,
      promptMarker,
      running: true,
    };
    nextId += 1;
  };

  const handleCommandBlockOsc = (data: string): boolean => {
    const marker = parseTerminalCommandBlockOsc(
      `${TERMINAL_COMMAND_BLOCK_OSC_IDENTIFIER};${data}`,
    );
    if (marker === null) {
      return false;
    }
    switch (marker.kind) {
      case "prompt-start":
        startBlock();
        return true;
      case "prompt-end":
        return true;
      case "command-line":
        if (open === null) {
          startBlock();
        }
        if (open !== null) {
          open.command = marker.command;
        }
        return true;
      case "output-start":
        if (open === null) {
          startBlock();
        }
        if (open !== null) {
          open.outputStartMarker = terminal.registerMarker(0) ?? null;
        }
        return true;
      case "command-finished": {
        const finished = open;
        open = null;
        if (finished === null) {
          return true;
        }
        if (finished.command.trim().length === 0) {
          finished.promptMarker.dispose();
          finished.outputStartMarker?.dispose();
          return true;
        }
        finished.exitCode = marker.exitCode;
        finished.outputEndCursorX = terminal.buffer.active.cursorX;
        finished.outputEndMarker = terminal.registerMarker(0) ?? null;
        finished.running = false;
        tracked.push(finished);
        pruneTracked();
        options.onBlockFinished(finished);
        return true;
      }
    }
  };

  const commandBlockDisposable = terminal.parser.registerOscHandler(
    TERMINAL_COMMAND_BLOCK_OSC_IDENTIFIER,
    (data) => {
      if (disposed) {
        return false;
      }
      return handleCommandBlockOsc(data);
    },
  );

  const cwdDisposable = terminal.parser.registerOscHandler(
    TERMINAL_CWD_OSC_IDENTIFIER,
    (data) => {
      if (disposed) {
        return false;
      }
      const cwd = parseTerminalCwdOsc(`${TERMINAL_CWD_OSC_IDENTIFIER};${data}`);
      if (cwd === null) {
        return false;
      }
      latestCwd = cwd;
      if (open !== null && open.cwd === null) {
        open.cwd = cwd;
      }
      return false;
    },
  );

  const disposeTracked = (): void => {
    for (const block of tracked) {
      block.promptMarker.dispose();
      block.outputStartMarker?.dispose();
      block.outputEndMarker?.dispose();
    }
    tracked.length = 0;
    open?.promptMarker.dispose();
    open?.outputStartMarker?.dispose();
    open = null;
  };

  return {
    blocks: () => [...tracked],
    dispose: () => {
      disposed = true;
      commandBlockDisposable.dispose();
      cwdDisposable.dispose();
      disposeTracked();
    },
    reset: () => {
      disposeTracked();
      latestCwd = null;
    },
  };
}
