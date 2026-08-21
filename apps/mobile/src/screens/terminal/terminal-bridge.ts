/**
 * The RN ↔ WebView terminal bridge: message contracts and the pure helpers
 * both sides use. This module is DOM-free and React-free so it is bundled
 * into the terminal page (`page/terminal-page.ts` → `assets/terminal/
 * index.html`) and imported by the native side (`TerminalView.tsx`); vitest
 * covers it in the node environment.
 *
 * Host (React Native) → page: `TerminalHostMessage` (JSON string through
 * `WebView.postMessage`, received as a `message` event on `window`).
 * Page → host: `TerminalPageMessage` (JSON string through
 * `window.ReactNativeWebView.postMessage`, received by `onMessage`).
 *
 * Output semantics ported from apps/app ThreadTerminalView.tsx: chunks that
 * replay history (`attached.nextSeq` boundary, gap fills) are written with a
 * completion callback and `onData` is muted while any such write is still
 * being parsed, so the PTY never receives a second DA1 / cursor-position
 * reply for output it already answered (`forwardTerminalData` /
 * `writeTerminalOutput` in the web view).
 */

/**
 * Wire limit of one terminal input / output chunk (decoded bytes). Kept local
 * so the page bundle stays dependency-free; `terminal-bridge.test.ts` pins it
 * to `@bb/domain`'s `TERMINAL_DATA_MAX_BYTES`.
 */
export const TERMINAL_DATA_MAX_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Theme

/** The xterm `ITheme` subset the page paints; every value is a CSS color. */
export interface TerminalPageTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// ---------------------------------------------------------------------------
// Accessory keys

const TERMINAL_ACCESSORY_KEYS = [
  "Escape",
  "Tab",
  "ArrowLeft",
  "ArrowUp",
  "ArrowDown",
  "ArrowRight",
  "Home",
  "End",
  "-",
  "/",
  "|",
] as const;
export type TerminalAccessoryKey = (typeof TERMINAL_ACCESSORY_KEYS)[number];

interface TerminalKeySequenceModes {
  /** DECCKM: the application (vim, less, zsh) asked for SS3 cursor keys. */
  applicationCursorKeys: boolean;
}

const CURSOR_KEY_FINAL: Record<
  "ArrowUp" | "ArrowDown" | "ArrowRight" | "ArrowLeft" | "Home" | "End",
  string
> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

/**
 * Byte sequence an accessory-bar key sends, honoring the terminal's cursor
 * key mode like a hardware keyboard would (xterm's own `evaluateKeyboardEvent`
 * rules: CSI/SS3 finals, `1;5` for Control).
 */
export function accessoryKeySequence(
  key: TerminalAccessoryKey,
  modes: TerminalKeySequenceModes,
  ctrl: boolean,
): string {
  switch (key) {
    case "Escape":
      return "\x1b";
    case "Tab":
      return "\t";
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowRight":
    case "ArrowLeft":
    case "Home":
    case "End": {
      const final = CURSOR_KEY_FINAL[key];
      if (ctrl) return `\x1b[1;5${final}`;
      return modes.applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`;
    }
    case "-":
    case "/":
    case "|":
      return ctrl ? applyControlModifier(key) : key;
  }
}

/**
 * Control-key transform for one typed character (the sticky Ctrl of the
 * accessory bar): letters → C0 codes, the `@[\]^_` column, `?` → DEL, space
 * → NUL, `/` and `-` → US like xterm. Anything else is returned unchanged.
 */
export function applyControlModifier(text: string): string {
  if (text.length !== 1) return text;
  const code = text.charCodeAt(0);
  // a-z / A-Z
  if ((code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a)) {
    return String.fromCharCode(code & 0x1f);
  }
  switch (text) {
    case "@":
    case " ":
      return "\x00";
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
    case "/":
    case "-":
      return "\x1f";
    case "?":
      return "\x7f";
    default:
      return text;
  }
}

interface StickyControlResult {
  text: string;
  /** Whether the sticky modifier was spent on this input. */
  consumed: boolean;
}

/**
 * Apply a pending sticky Ctrl to the next keystroke the page reports. Only a
 * single typed character consumes it (a paste or an IME commit passes
 * through untouched and keeps the modifier armed).
 */
export function applyStickyControl(text: string): StickyControlResult {
  if (text.length !== 1) return { text, consumed: false };
  return { text: applyControlModifier(text), consumed: true };
}

// ---------------------------------------------------------------------------
// Messages

export type TerminalHostMessage =
  | {
      type: "init";
      theme: TerminalPageTheme;
      fontSize: number;
      /** Post `text-mirror` snapshots (e2e / dev only). */
      textMirror: boolean;
    }
  | {
      type: "write";
      /** Base64 output chunks, in order. */
      chunks: string[];
      /** Historical output: mute `onData` replies while it is parsed. */
      replay: boolean;
    }
  | { type: "status"; text: string }
  | { type: "reset" }
  | { type: "resize" }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "key"; key: TerminalAccessoryKey; ctrl: boolean }
  | { type: "paste"; text: string }
  | { type: "theme"; theme: TerminalPageTheme; fontSize: number };

export type TerminalPageMessage =
  | { type: "ready"; cols: number; rows: number }
  /** Keystrokes and terminal replies (base64 bytes, one wire chunk each). */
  | { type: "data"; dataBase64: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "link"; url: string }
  | { type: "title"; title: string }
  /** Last lines of the viewport (dev / e2e only, see `init.textMirror`). */
  | { type: "text-mirror"; lines: string[] }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Encoding

function encodeBytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

export function decodeTerminalOutputBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** UTF-8 encode `text` and split it into wire-sized base64 chunks. */
export function encodeTerminalInputChunks(text: string): string[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += TERMINAL_DATA_MAX_BYTES
  ) {
    chunks.push(
      encodeBytesBase64(
        bytes.subarray(
          offset,
          Math.min(offset + TERMINAL_DATA_MAX_BYTES, bytes.byteLength),
        ),
      ),
    );
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Replay write suppression (page side)

export interface TerminalReplayWriteState {
  suppressedWriteCount: number;
}

export function createTerminalReplayWriteState(): TerminalReplayWriteState {
  return { suppressedWriteCount: 0 };
}

export interface TerminalWriter {
  write(data: string | Uint8Array, callback?: () => void): void;
}

interface WriteTerminalOutputArgs {
  terminal: TerminalWriter;
  data: string | Uint8Array;
  isReplay: boolean;
  replayWriteState: TerminalReplayWriteState;
}

/**
 * Replayed output is written with a completion callback so `onData` can be
 * muted until xterm has parsed it (see the module comment).
 */
export function writeTerminalOutput({
  terminal,
  data,
  isReplay,
  replayWriteState,
}: WriteTerminalOutputArgs): void {
  if (!isReplay) {
    terminal.write(data);
    return;
  }
  replayWriteState.suppressedWriteCount += 1;
  terminal.write(data, () => {
    replayWriteState.suppressedWriteCount -= 1;
  });
}

/** Whether an `onData` emission may leave the page right now. */
export function canForwardTerminalData(
  replayWriteState: TerminalReplayWriteState,
): boolean {
  return replayWriteState.suppressedWriteCount <= 0;
}

// ---------------------------------------------------------------------------
// Output batching (host side)

const TERMINAL_WRITE_BATCH_MAX_BYTES = 16 * 1024;
const TERMINAL_WRITE_BATCH_MAX_DELAY_MS = 16;

export interface TerminalWriteBatch {
  chunks: string[];
  replay: boolean;
}

interface TerminalWriteBatcherOptions {
  flush: (batch: TerminalWriteBatch) => void;
  maxBytes?: number;
  maxDelayMs?: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface TerminalWriteBatcher {
  push(dataBase64: string, replay: boolean): void;
  /** Deliver whatever is pending now (before a reset / status line). */
  flushNow(): void;
  dispose(): void;
}

/**
 * Coalesce output chunks into one host → page message per animation frame:
 * a batch is delivered when it reaches `maxBytes` (base64 length), when
 * `maxDelayMs` elapse after its first chunk, or when the replay flag flips
 * (a batch never mixes replayed and live output).
 */
export function createTerminalWriteBatcher({
  flush,
  maxBytes = TERMINAL_WRITE_BATCH_MAX_BYTES,
  maxDelayMs = TERMINAL_WRITE_BATCH_MAX_DELAY_MS,
  setTimeout: schedule = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: cancel = (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}: TerminalWriteBatcherOptions): TerminalWriteBatcher {
  let pending: TerminalWriteBatch | null = null;
  let pendingBytes = 0;
  let timer: unknown = null;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };
  const flushNow = (): void => {
    clearTimer();
    if (pending === null) return;
    const batch = pending;
    pending = null;
    pendingBytes = 0;
    flush(batch);
  };

  return {
    push(dataBase64, replay) {
      if (disposed) return;
      if (pending !== null && pending.replay !== replay) {
        flushNow();
      }
      if (pending === null) {
        pending = { chunks: [], replay };
      }
      pending.chunks.push(dataBase64);
      pendingBytes += dataBase64.length;
      if (pendingBytes >= maxBytes) {
        flushNow();
        return;
      }
      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          flushNow();
        }, maxDelayMs);
      }
    },
    flushNow,
    dispose() {
      disposed = true;
      clearTimer();
      pending = null;
      pendingBytes = 0;
    },
  };
}
