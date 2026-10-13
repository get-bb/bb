import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export interface LogFileFollower {
  stop(): void;
}

interface CreateLogFileFollowerArgs {
  filePath: string;
  initialLines: number;
  onChunk: (chunk: string) => void;
  onError: (error: Error) => void;
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const INITIAL_READ_MAX_BYTES = 1024 * 1024;
const READ_BUFFER_BYTES = 64 * 1024;

async function readRange(
  filePath: string,
  start: number,
  end: number,
  onBytes: (bytes: Buffer) => void,
): Promise<void> {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(READ_BUFFER_BYTES);
    let position = start;
    while (position < end) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, end - position),
        position,
      );
      if (bytesRead === 0) {
        return;
      }
      onBytes(Buffer.from(buffer.subarray(0, bytesRead)));
      position += bytesRead;
    }
  } finally {
    await file.close();
  }
}

function lastLines(text: string, count: number): string {
  let index = text.endsWith("\n") ? text.length - 1 : text.length;
  for (let found = 0; found < count; found += 1) {
    index = text.lastIndexOf("\n", index - 1);
    if (index < 0) {
      return text;
    }
  }
  return text.slice(index + 1);
}

export function createLogFileFollower(
  args: CreateLogFileFollowerArgs,
): LogFileFollower {
  let stopped = false;
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let decoder = new StringDecoder("utf8");

  const emit = (text: string): void => {
    if (!stopped && text.length > 0) {
      args.onChunk(text);
    }
  };

  async function readInitial(): Promise<void> {
    const { size } = await stat(args.filePath);
    const start = Math.max(0, size - INITIAL_READ_MAX_BYTES);
    const chunks: Buffer[] = [];
    await readRange(args.filePath, start, size, (bytes) => chunks.push(bytes));
    const bytes = Buffer.concat(chunks);
    const firstLineStart = start === 0 ? 0 : bytes.indexOf(0x0a) + 1;
    offset = start + bytes.length;
    emit(
      lastLines(
        decoder.write(bytes.subarray(firstLineStart)),
        args.initialLines,
      ),
    );
  }

  async function readAppended(): Promise<void> {
    const { size } = await stat(args.filePath);
    if (size < offset) {
      offset = 0;
      decoder = new StringDecoder("utf8");
    }
    if (size === offset) {
      return;
    }
    const start = offset;
    await readRange(args.filePath, start, size, (bytes) => {
      offset += bytes.length;
      emit(decoder.write(bytes));
    });
  }

  function schedule(read: () => Promise<void>): void {
    read()
      .catch((error: unknown) => {
        if (!stopped) {
          args.onError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })
      .finally(() => {
        if (stopped) {
          return;
        }
        timer = setTimeout(
          () => schedule(readAppended),
          args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        );
      });
  }

  schedule(readInitial);

  return {
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
