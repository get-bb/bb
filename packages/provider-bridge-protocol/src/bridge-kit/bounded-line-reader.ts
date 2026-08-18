import { StringDecoder } from "node:string_decoder";

/**
 * The largest single JSON-RPC line either side of the bridge wire will
 * assemble. Real traffic is far below this: the biggest messages are tool
 * results and item payloads, which the producers already bound. The cap
 * exists because `readline` does not have one — an unterminated or runaway
 * line grows its internal buffer until the process dies, and the bridge is
 * now third-party code on both sides of that pipe.
 */
export const MAX_JSON_RPC_LINE_BYTES = 64 * 1024 * 1024;

export interface BoundedLineReaderArgs {
  input: NodeJS.ReadableStream;
  /** Complete lines, without their terminator. */
  onLine: (line: string) => void;
  /**
   * An oversized line was discarded (bytes counted so far when the cap was
   * passed). Reading continues from the next terminator, so one runaway
   * message costs its own content and nothing else.
   */
  onOverflow: (bytes: number) => void;
  onClose?: () => void;
  maxLineBytes?: number;
}

/**
 * Newline-delimited reader with a hard per-line cap — `readline` with the
 * bound it lacks. CR is stripped so a CRLF producer parses as JSON.
 */
export function readBoundedLines(args: BoundedLineReaderArgs): void {
  const maxLineBytes = args.maxLineBytes ?? MAX_JSON_RPC_LINE_BYTES;
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let discarding = false;
  let discardedBytes = 0;

  args.input.on("data", (chunk: Buffer | string) => {
    const text =
      typeof chunk === "string" ? chunk : decoder.write(chunk);
    let start = 0;
    for (;;) {
      const newlineIndex = text.indexOf("\n", start);
      if (newlineIndex === -1) {
        break;
      }
      if (discarding) {
        discarding = false;
        args.onOverflow(discardedBytes);
        discardedBytes = 0;
      } else {
        emit(pending + text.slice(start, newlineIndex));
      }
      pending = "";
      start = newlineIndex + 1;
    }
    const tail = text.slice(start);
    if (discarding) {
      discardedBytes += Buffer.byteLength(tail);
      return;
    }
    pending += tail;
    if (Buffer.byteLength(pending) > maxLineBytes) {
      discarding = true;
      discardedBytes = Buffer.byteLength(pending);
      pending = "";
    }
  });

  args.input.on("end", () => {
    if (!discarding && pending.length > 0) {
      emit(pending);
    }
    pending = "";
    args.onClose?.();
  });

  function emit(line: string): void {
    args.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  }
}
