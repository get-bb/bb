const ESCAPE = "\u001b";
const BELL = "\u0007";
const MAX_PENDING_SEQUENCE_LENGTH = 4096;
const DEFAULT_MAX_OUTPUT_CHARACTERS = 256 * 1024;
const DEFAULT_MAX_BLOCKS = 100;
const COMMAND_LINE_PROPERTY = "cmdline_b64";

export const TERMINAL_COMMAND_BLOCK_OSC_IDENTIFIER = 133;
export const TERMINAL_CWD_OSC_IDENTIFIER = 7;

export type TerminalCommandBlockMarker =
  | { kind: "prompt-start" }
  | { kind: "prompt-end" }
  | { kind: "output-start" }
  | { kind: "command-line"; command: string }
  | { kind: "command-finished"; exitCode: number | null };

export interface TerminalCommandBlock {
  command: string;
  cwd: string | null;
  exitCode: number | null;
  index: number;
  output: string;
  outputTruncated: boolean;
  running: boolean;
}

export interface TerminalCommandBlockReaderOptions {
  maxBlocks?: number;
  maxOutputCharacters?: number;
}

export interface TerminalCommandBlockReader {
  blocks(): TerminalCommandBlock[];
  push(text: string): void;
}

interface OpenTerminalCommandBlock {
  capturing: boolean;
  command: string;
  cwd: string | null;
  exitCode: number | null;
  index: number;
  output: string;
  outputTruncated: boolean;
}

interface OscScanResult {
  body: string;
  end: number;
}

type OscScanOutcome = OscScanResult | "incomplete" | "not-osc";

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function scanOscSequence(input: string, start: number): OscScanOutcome {
  if (start + 1 >= input.length) {
    return "incomplete";
  }
  if (input[start + 1] !== "]") {
    return "not-osc";
  }
  for (let index = start + 2; index < input.length; index += 1) {
    if (input[index] === BELL) {
      return { body: input.slice(start + 2, index), end: index + 1 };
    }
    if (input[index] === ESCAPE) {
      if (index + 1 >= input.length) {
        return "incomplete";
      }
      if (input[index + 1] === "\\") {
        return { body: input.slice(start + 2, index), end: index + 2 };
      }
    }
  }
  return "incomplete";
}

export function parseTerminalCommandBlockOsc(
  body: string,
): TerminalCommandBlockMarker | null {
  const separatorIndex = body.indexOf(";");
  const identifier =
    separatorIndex === -1 ? body : body.slice(0, separatorIndex);
  if (Number(identifier) !== TERMINAL_COMMAND_BLOCK_OSC_IDENTIFIER) {
    return null;
  }
  const payload = separatorIndex === -1 ? "" : body.slice(separatorIndex + 1);
  const [code, ...rest] = payload.split(";");
  switch (code) {
    case "A":
      return { kind: "prompt-start" };
    case "B":
      return { kind: "prompt-end" };
    case "C":
      return { kind: "output-start" };
    case "D": {
      const rawExitCode = rest[0];
      if (rawExitCode === undefined || rawExitCode.length === 0) {
        return { kind: "command-finished", exitCode: null };
      }
      const exitCode = Number(rawExitCode);
      return {
        kind: "command-finished",
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
      };
    }
    case "P": {
      const property = rest.join(";");
      const assignmentIndex = property.indexOf("=");
      if (assignmentIndex === -1) {
        return null;
      }
      if (property.slice(0, assignmentIndex) !== COMMAND_LINE_PROPERTY) {
        return null;
      }
      try {
        return {
          kind: "command-line",
          command: decodeBase64Utf8(property.slice(assignmentIndex + 1)),
        };
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export function parseTerminalCwdOsc(body: string): string | null {
  const separatorIndex = body.indexOf(";");
  if (separatorIndex === -1) {
    return null;
  }
  if (Number(body.slice(0, separatorIndex)) !== TERMINAL_CWD_OSC_IDENTIFIER) {
    return null;
  }
  const value = body.slice(separatorIndex + 1);
  if (!value.startsWith("file://")) {
    return null;
  }
  const pathStart = value.indexOf("/", "file://".length);
  if (pathStart === -1) {
    return null;
  }
  try {
    return decodeURIComponent(value.slice(pathStart));
  } catch {
    return null;
  }
}

export function createTerminalCommandBlockReader(
  options: TerminalCommandBlockReaderOptions = {},
): TerminalCommandBlockReader {
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const maxOutputCharacters =
    options.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS;
  const completed: TerminalCommandBlock[] = [];
  let open: OpenTerminalCommandBlock | null = null;
  let pending = "";
  let nextIndex = 0;
  let latestCwd: string | null = null;

  const startBlock = (): void => {
    open = {
      capturing: false,
      command: "",
      cwd: latestCwd,
      exitCode: null,
      index: nextIndex,
      output: "",
      outputTruncated: false,
    };
    nextIndex += 1;
  };

  const retainBlock = (block: TerminalCommandBlock): void => {
    completed.push(block);
    while (completed.length > maxBlocks) {
      completed.shift();
    }
  };

  const appendOutput = (text: string): void => {
    if (open === null || !open.capturing || text.length === 0) {
      return;
    }
    const remaining = maxOutputCharacters - open.output.length;
    if (remaining <= 0) {
      open.outputTruncated = true;
      return;
    }
    if (text.length > remaining) {
      open.output += text.slice(0, remaining);
      open.outputTruncated = true;
      return;
    }
    open.output += text;
  };

  const applyMarker = (marker: TerminalCommandBlockMarker): void => {
    switch (marker.kind) {
      case "prompt-start":
        startBlock();
        return;
      case "prompt-end":
        return;
      case "command-line":
        if (open === null) {
          startBlock();
        }
        if (open !== null) {
          open.command = marker.command;
        }
        return;
      case "output-start":
        if (open === null) {
          startBlock();
        }
        if (open !== null) {
          open.capturing = true;
        }
        return;
      case "command-finished": {
        if (open === null) {
          return;
        }
        const finished = open;
        open = null;
        if (finished.command.trim().length === 0) {
          return;
        }
        retainBlock({
          command: finished.command,
          cwd: finished.cwd,
          exitCode: marker.exitCode,
          index: finished.index,
          output: finished.output,
          outputTruncated: finished.outputTruncated,
          running: false,
        });
        return;
      }
    }
  };

  return {
    blocks(): TerminalCommandBlock[] {
      if (open === null || open.command.trim().length === 0) {
        return [...completed];
      }
      return [
        ...completed,
        {
          command: open.command,
          cwd: open.cwd,
          exitCode: null,
          index: open.index,
          output: open.output,
          outputTruncated: open.outputTruncated,
          running: true,
        },
      ];
    },
    push(text: string): void {
      const input = pending + text;
      pending = "";
      let plainStart = 0;
      let index = 0;
      while (index < input.length) {
        if (input[index] !== ESCAPE) {
          index += 1;
          continue;
        }
        const scan = scanOscSequence(input, index);
        if (scan === "not-osc") {
          index += 1;
          continue;
        }
        if (scan === "incomplete") {
          if (input.length - index > MAX_PENDING_SEQUENCE_LENGTH) {
            index += 1;
            continue;
          }
          appendOutput(input.slice(plainStart, index));
          pending = input.slice(index);
          return;
        }
        const marker = parseTerminalCommandBlockOsc(scan.body);
        const cwd = marker === null ? parseTerminalCwdOsc(scan.body) : null;
        if (marker === null && cwd === null) {
          index = scan.end;
          continue;
        }
        appendOutput(input.slice(plainStart, index));
        if (marker !== null) {
          applyMarker(marker);
        }
        if (cwd !== null) {
          latestCwd = cwd;
          if (open !== null && open.cwd === null) {
            open.cwd = cwd;
          }
        }
        index = scan.end;
        plainStart = scan.end;
      }
      appendOutput(input.slice(plainStart));
    },
  };
}

export function readTerminalCommandBlocks(
  text: string,
  options?: TerminalCommandBlockReaderOptions,
): TerminalCommandBlock[] {
  const reader = createTerminalCommandBlockReader(options);
  reader.push(text);
  return reader.blocks();
}
