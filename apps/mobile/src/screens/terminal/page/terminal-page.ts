/**
 * The terminal WebView page: xterm.js + fit / unicode11 / web-links addons,
 * driven entirely by the React Native host through the message bridge in
 * `../terminal-bridge.ts`. The host owns the attach socket and posts output
 * batches; the page posts keystrokes, resizes, links, and titles back.
 *
 * This is the one HTML page in the app: it runs inside the WebView, never in
 * React Native. `scripts/build-terminal-page.ts` bundles it with its CSS into
 * `assets/terminal/index.html`.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  accessoryKeySequence,
  canForwardTerminalData,
  createTerminalReplayWriteState,
  decodeTerminalOutputBytes,
  encodeTerminalInputChunks,
  writeTerminalOutput,
  type TerminalHostMessage,
  type TerminalPageMessage,
  type TerminalPageTheme,
} from "../terminal-bridge";

const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", "MesloLGS NF", "Symbols Nerd Font Mono", ui-monospace, Menlo, Monaco, "Courier New", monospace';
const TEXT_MIRROR_INTERVAL_MS = 500;
const TEXT_MIRROR_LINES = 40;
const TOUCH_FOCUS_MAX_DURATION_MS = 700;
const TOUCH_FOCUS_MOVEMENT_THRESHOLD_PX = 10;

interface ReactNativeWebViewBridge {
  postMessage(data: string): void;
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
    /** Debug handle for Safari / a desktop browser opening the asset. */
    __bbTerminal?: { handle(message: TerminalHostMessage): void };
  }
}

function post(message: TerminalPageMessage): void {
  const bridge = window.ReactNativeWebView;
  if (bridge) {
    bridge.postMessage(JSON.stringify(message));
  } else if (message.type !== "text-mirror") {
    console.log("[terminal-page]", message);
  }
}

function showError(message: string): void {
  const element = document.getElementById("error");
  if (element) {
    element.textContent = message;
    element.style.display = "block";
  }
  post({ type: "error", message });
}

function applyTheme(
  terminal: Terminal,
  theme: TerminalPageTheme,
  fontSize: number,
): void {
  terminal.options.theme = theme;
  terminal.options.fontSize = fontSize;
  document.documentElement.style.setProperty(
    "--terminal-background",
    theme.background,
  );
}

/** The viewport's rows (trailing blank rows trimmed, capped from the bottom). */
function viewportLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const end = buffer.baseY + terminal.rows;
  const lines: string[] = [];
  for (let y = buffer.baseY; y < end; y += 1) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-TEXT_MIRROR_LINES);
}

function main(): void {
  const container = document.getElementById("terminal");
  if (!container) {
    showError("terminal container missing");
    return;
  }

  const terminal = new Terminal({
    allowProposedApi: true,
    convertEol: true,
    cursorBlink: true,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    scrollback: 10_000,
    // The DOM renderer; WebGL is skipped on purpose (context loss on
    // background / resume and no measurable gain on a phone-sized grid).
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
  terminal.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault();
      post({ type: "link", url: uri });
    }),
  );
  terminal.open(container);

  const replayWriteState = createTerminalReplayWriteState();
  let lastReportedSize = { cols: 0, rows: 0 };
  let resizeFrame: number | null = null;
  let textMirrorTimer: number | null = null;
  let lastMirror = "";

  const fit = (): void => {
    const { width, height } = container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    fitAddon.fit();
    if (
      terminal.cols !== lastReportedSize.cols ||
      terminal.rows !== lastReportedSize.rows
    ) {
      lastReportedSize = { cols: terminal.cols, rows: terminal.rows };
      post({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    }
  };
  const scheduleFit = (): void => {
    if (resizeFrame !== null) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = null;
      fit();
    });
  };

  terminal.onData((data) => {
    if (!canForwardTerminalData(replayWriteState)) return;
    for (const dataBase64 of encodeTerminalInputChunks(data)) {
      post({ type: "data", dataBase64 });
    }
  });
  terminal.onBinary((data) => {
    if (!canForwardTerminalData(replayWriteState)) return;
    // Binary mouse reports etc. arrive as a latin1 string.
    const bytes = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
      bytes[index] = data.charCodeAt(index) & 0xff;
    }
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
    post({ type: "data", dataBase64: btoa(binary) });
  });
  terminal.onTitleChange((title) => {
    if (!canForwardTerminalData(replayWriteState)) return;
    post({ type: "title", title });
  });

  // Tap (not scroll, not long-press) focuses the terminal so the keyboard
  // rises; mirrors the web view's touch-to-focus gesture.
  let touchStart: { x: number; y: number; at: number; moved: boolean } | null =
    null;
  container.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        at: Date.now(),
        moved: false,
      };
    },
    { passive: true },
  );
  container.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (!touchStart || !touch) return;
      if (
        Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) >
        TOUCH_FOCUS_MOVEMENT_THRESHOLD_PX
      ) {
        touchStart.moved = true;
      }
    },
    { passive: true },
  );
  container.addEventListener(
    "touchend",
    () => {
      const gesture = touchStart;
      touchStart = null;
      if (
        !gesture ||
        gesture.moved ||
        Date.now() - gesture.at >= TOUCH_FOCUS_MAX_DURATION_MS
      ) {
        return;
      }
      terminal.focus();
    },
    { passive: true },
  );

  const handle = (message: TerminalHostMessage): void => {
    switch (message.type) {
      case "init":
        applyTheme(terminal, message.theme, message.fontSize);
        if (message.textMirror && textMirrorTimer === null) {
          textMirrorTimer = window.setInterval(() => {
            const lines = viewportLines(terminal);
            const snapshot = lines.join("\n");
            if (snapshot === lastMirror) return;
            lastMirror = snapshot;
            post({ type: "text-mirror", lines });
          }, TEXT_MIRROR_INTERVAL_MS);
        }
        fit();
        return;
      case "theme":
        applyTheme(terminal, message.theme, message.fontSize);
        scheduleFit();
        return;
      case "write":
        for (const chunk of message.chunks) {
          writeTerminalOutput({
            terminal,
            data: decodeTerminalOutputBytes(chunk),
            isReplay: message.replay,
            replayWriteState,
          });
        }
        return;
      case "status":
        terminal.write(`\r\n\x1b[2m${message.text}\x1b[0m\r\n`);
        return;
      case "reset":
        terminal.reset();
        return;
      case "resize":
        scheduleFit();
        return;
      case "focus":
        terminal.focus();
        return;
      case "blur":
        terminal.blur();
        return;
      case "key": {
        const sequence = accessoryKeySequence(
          message.key,
          { applicationCursorKeys: terminal.modes.applicationCursorKeysMode },
          message.ctrl,
        );
        for (const dataBase64 of encodeTerminalInputChunks(sequence)) {
          post({ type: "data", dataBase64 });
        }
        terminal.scrollToBottom();
        return;
      }
      case "paste":
        // `paste` honors bracketed paste mode and routes through onData.
        terminal.paste(message.text);
        terminal.scrollToBottom();
        return;
    }
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    let message: TerminalHostMessage;
    try {
      message =
        typeof event.data === "string"
          ? (JSON.parse(event.data) as TerminalHostMessage)
          : (event.data as TerminalHostMessage);
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || !("type" in message)) return;
    try {
      handle(message);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });
  window.__bbTerminal = { handle };

  new ResizeObserver(() => scheduleFit()).observe(container);
  window.addEventListener("resize", scheduleFit);

  fit();
  post({ type: "ready", cols: terminal.cols, rows: terminal.rows });
}

try {
  main();
} catch (error) {
  showError(error instanceof Error ? error.message : String(error));
}
