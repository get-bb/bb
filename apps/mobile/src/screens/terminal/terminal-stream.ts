import type { TerminalSocketConnectionState } from "@bb/client-core";
import type {
  TerminalOutputResponse,
  TerminalServerMessage,
  TerminalSession,
} from "@bb/server-contract";

/**
 * Attach-stream policy between the transport and the page (the pure part of
 * apps/app ThreadTerminalView.tsx's `handleTerminalServerMessage` + the
 * connection-state notices), plus the mobile addition: a replay gap after a
 * reconnect is filled from `GET /terminals/:id/output?sinceSeq=` before the
 * socket's output is let through, and only falls back to the web's
 * reset-and-notice when the scrollback no longer covers it.
 *
 * Replay boundary: output with `seq < attached.nextSeq` is history and is
 * written as replay (the page mutes `onData` while parsing it).
 */

export interface TerminalStreamSink {
  /** Append one base64 chunk; `replay` mutes protocol replies (see above). */
  write(dataBase64: string, replay: boolean): void;
  /** Dim status line between output (connection lost, exited, errors). */
  writeStatus(text: string): void;
  /** Clear the terminal (`terminal.reset()`): history is no longer contiguous. */
  reset(): void;
  onSession(session: TerminalSession): void;
}

interface TerminalStreamControllerOptions {
  sink: TerminalStreamSink;
  /** `GET /terminals/:id/output?sinceSeq=`; null disables the gap fill. */
  fetchOutput: ((sinceSeq: number) => Promise<TerminalOutputResponse>) | null;
  fillTimeoutMs?: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface TerminalStreamController {
  handleMessage(message: TerminalServerMessage): void;
  /** Transport `onSequenceGap`: called before the message that revealed it. */
  handleSequenceGap(expectedSeq: number, receivedSeq: number): void;
  handleConnectionState(state: TerminalSocketConnectionState): void;
  handleInputOverflow(maxBytes: number): void;
  handleInvalidMessage(): void;
  /**
   * The host is about to `suspend()` the transport (app backgrounded): the
   * following `closed` → `reconnecting` → `open` cycle is silent.
   */
  markSuspended(): void;
  dispose(): void;
}

interface PendingGapFill {
  from: number;
  to: number;
  buffered: TerminalServerMessage[];
  timer: unknown;
}

const TERMINAL_GAP_FILL_TIMEOUT_MS = 8_000;
export const TERMINAL_GAP_NOTICE =
  "Some terminal output was unavailable after reconnect";

/** Chunks in `[from, to)`, contiguous from `from`; null when not covered. */
export function selectGapFillChunks(
  response: TerminalOutputResponse,
  from: number,
  to: number,
): string[] | null {
  const needed = response.chunks
    .filter((chunk) => chunk.seq >= from && chunk.seq < to)
    .sort((left, right) => left.seq - right.seq);
  if (needed.length !== to - from) return null;
  for (let index = 0; index < needed.length; index += 1) {
    if (needed[index]?.seq !== from + index) return null;
  }
  return needed.map((chunk) => chunk.dataBase64);
}

export function createTerminalStreamController({
  sink,
  fetchOutput,
  fillTimeoutMs = TERMINAL_GAP_FILL_TIMEOUT_MS,
  setTimeout: schedule = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: cancel = (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}: TerminalStreamControllerOptions): TerminalStreamController {
  let replayNextSeq: number | null = null;
  let fill: PendingGapFill | null = null;
  let disposed = false;
  let hasOpened = false;
  let reconnectNoticeVisible = false;
  let suspendedByHost = false;

  function deliver(message: TerminalServerMessage): void {
    switch (message.type) {
      case "attached":
        sink.onSession(message.session);
        replayNextSeq = message.nextSeq;
        return;
      case "pong":
        return;
      case "session-updated":
        sink.onSession(message.session);
        return;
      case "output":
        sink.write(
          message.chunk.dataBase64,
          replayNextSeq !== null && message.chunk.seq < replayNextSeq,
        );
        return;
      case "error":
        sink.writeStatus(`Terminal error: ${message.message}`);
        return;
      case "exited":
        sink.onSession(message.session);
        sink.writeStatus(
          message.session.exitCode === null
            ? "Terminal exited"
            : `Terminal exited with code ${message.session.exitCode}`,
        );
        return;
    }
  }

  function finishFill(pending: PendingGapFill, chunks: string[] | null): void {
    if (fill !== pending) return;
    fill = null;
    cancel(pending.timer);
    if (chunks === null) {
      sink.reset();
      sink.writeStatus(TERMINAL_GAP_NOTICE);
    } else {
      for (const dataBase64 of chunks) sink.write(dataBase64, true);
    }
    for (const message of pending.buffered) deliver(message);
  }

  return {
    handleMessage(message) {
      if (disposed) return;
      if (fill !== null && message.type !== "pong") {
        fill.buffered.push(message);
        return;
      }
      deliver(message);
    },
    handleSequenceGap(expectedSeq, receivedSeq) {
      if (disposed) return;
      if (fill !== null) {
        // A second gap while filling: history is not contiguous either way.
        finishFill(fill, null);
      }
      if (expectedSeq === 0 || fetchOutput === null) {
        // Nothing was shown yet (first attach to a terminal whose scrollback
        // was trimmed) or no fallback: the web behavior, minus the notice on
        // an empty screen.
        if (expectedSeq !== 0) {
          sink.reset();
          sink.writeStatus(TERMINAL_GAP_NOTICE);
        }
        return;
      }
      const pending: PendingGapFill = {
        from: expectedSeq,
        to: receivedSeq,
        buffered: [],
        timer: null,
      };
      pending.timer = schedule(() => finishFill(pending, null), fillTimeoutMs);
      fill = pending;
      fetchOutput(expectedSeq).then(
        (response) => {
          if (disposed) return;
          finishFill(
            pending,
            selectGapFillChunks(response, pending.from, pending.to),
          );
        },
        () => {
          if (disposed) return;
          finishFill(pending, null);
        },
      );
    },
    handleConnectionState(state) {
      if (disposed) return;
      if (state === "reconnecting") {
        if (suspendedByHost || reconnectNoticeVisible) return;
        reconnectNoticeVisible = true;
        sink.writeStatus("Terminal connection lost; reconnecting...");
        return;
      }
      if (state === "open") {
        if (hasOpened && reconnectNoticeVisible) {
          sink.writeStatus("Terminal reconnected");
        }
        hasOpened = true;
        reconnectNoticeVisible = false;
        suspendedByHost = false;
      }
    },
    handleInputOverflow(maxBytes) {
      if (disposed) return;
      sink.writeStatus(
        `Terminal input queue is full (${maxBytes} bytes); input was not sent`,
      );
    },
    handleInvalidMessage() {
      if (disposed) return;
      sink.writeStatus("Terminal received an invalid server message");
    },
    markSuspended() {
      suspendedByHost = true;
    },
    dispose() {
      disposed = true;
      if (fill !== null) {
        cancel(fill.timer);
        fill = null;
      }
    },
  };
}
