import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { ITheme, Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalServerMessage, TerminalSession } from "@bb/server-contract";
import { terminalServerMessageSchema } from "@bb/server-contract";
import { usePreferredTheme } from "@/hooks/useTheme";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { buildTerminalWebSocketUrl } from "./terminal-websocket-url";

const TERMINAL_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace";

type TerminalFitScheduler = () => void;

interface HasVisibleTerminalSizeArgs {
  containerElement: HTMLElement;
  entries?: readonly ResizeObserverEntry[];
}

function readResolvedCssColor(
  probe: HTMLElement,
  varName: string,
): string | undefined {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) {
    return undefined;
  }
  probe.style.color = raw;
  return getComputedStyle(probe).color;
}

function buildTerminalTheme(): ITheme {
  if (typeof document === "undefined") {
    return {};
  }
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const get = (name: string) => readResolvedCssColor(probe, name);
  const theme: ITheme = {
    background: get("--background"),
    foreground: get("--foreground"),
    cursor: get("--foreground"),
    cursorAccent: get("--background"),
    selectionBackground: get("--muted"),
    black: get("--ansi-0"),
    red: get("--ansi-1"),
    green: get("--ansi-2"),
    yellow: get("--ansi-3"),
    blue: get("--ansi-4"),
    magenta: get("--ansi-5"),
    cyan: get("--ansi-6"),
    white: get("--ansi-7"),
    brightBlack: get("--ansi-8"),
    brightRed: get("--ansi-9"),
    brightGreen: get("--ansi-10"),
    brightYellow: get("--ansi-11"),
    brightBlue: get("--ansi-12"),
    brightMagenta: get("--ansi-13"),
    brightCyan: get("--ansi-14"),
    brightWhite: get("--ansi-15"),
  };
  probe.remove();
  return theme;
}

interface ThreadTerminalViewProps {
  isPanelOpen: boolean;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onTitleChange?: TerminalTitleChangeHandler;
  onUserInput?: () => void;
  session: TerminalSession;
  threadId: string;
}

type TerminalTitleChangeHandler = (title: string) => void;

interface SendTerminalResizeArgs {
  socket: WebSocket;
  terminal: XTermTerminal;
}

interface WriteTerminalStatusArgs {
  terminal: XTermTerminal;
  text: string;
}

interface TerminalOutputWriteArgs {
  isReplay: boolean;
  replayWriteState: TerminalReplayWriteState;
  terminal: XTermTerminal;
  text: string;
}

interface OpenTerminalWebLinkArgs {
  event: MouseEvent;
  onOpenLink: MarkdownPreviewLinkHandler | undefined;
  uri: string;
}

interface TerminalReplayWriteState {
  suppressedWriteCount: number;
}

interface HandleTerminalServerMessageArgs {
  message: TerminalServerMessage;
  replayNextSeq: number | null;
  replayWriteState: TerminalReplayWriteState;
  setReplayNextSeq: (nextSeq: number) => void;
  terminal: XTermTerminal;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function sendTerminalResize({
  socket,
  terminal,
}: SendTerminalResizeArgs): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows,
    }),
  );
}

function hasVisibleTerminalSize({
  containerElement,
  entries,
}: HasVisibleTerminalSizeArgs): boolean {
  const entry = entries?.[0];
  const width = entry?.contentRect.width ?? containerElement.clientWidth;
  const height = entry?.contentRect.height ?? containerElement.clientHeight;
  return width > 0 && height > 0;
}

function writeTerminalStatus({ terminal, text }: WriteTerminalStatusArgs): void {
  terminal.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
}

function openTerminalWebLink({
  event,
  onOpenLink,
  uri,
}: OpenTerminalWebLinkArgs): void {
  if (onOpenLink?.({ href: uri })) {
    event.preventDefault();
    return;
  }
  window.open(uri, "_blank", "noopener,noreferrer");
}

function writeTerminalOutput({
  isReplay,
  replayWriteState,
  terminal,
  text,
}: TerminalOutputWriteArgs): void {
  if (!isReplay) {
    terminal.write(text);
    return;
  }

  replayWriteState.suppressedWriteCount += 1;
  terminal.write(text, () => {
    replayWriteState.suppressedWriteCount -= 1;
  });
}

function handleTerminalServerMessage({
  message,
  replayNextSeq,
  replayWriteState,
  setReplayNextSeq,
  terminal,
}: HandleTerminalServerMessageArgs): void {
  switch (message.type) {
    case "attached":
      setReplayNextSeq(message.nextSeq);
      return;
    case "pong":
    case "session-updated":
      return;
    case "output":
      writeTerminalOutput({
        isReplay: replayNextSeq !== null && message.chunk.seq < replayNextSeq,
        replayWriteState,
        terminal,
        text: decodeUtf8Base64(message.chunk.dataBase64),
      });
      return;
    case "error":
      writeTerminalStatus({
        terminal,
        text: `Terminal error: ${message.message}`,
      });
      return;
    case "exited":
      writeTerminalStatus({
        terminal,
        text:
          message.session.exitCode === null
            ? "Terminal exited"
            : `Terminal exited with code ${message.session.exitCode}`,
      });
      return;
  }
}

export function ThreadTerminalView({
  isPanelOpen,
  onOpenLink,
  onTitleChange,
  onUserInput,
  session,
  threadId,
}: ThreadTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const onTitleChangeRef = useRef<TerminalTitleChangeHandler | undefined>(
    onTitleChange,
  );
  const onOpenLinkRef = useRef<MarkdownPreviewLinkHandler | undefined>(
    onOpenLink,
  );
  const onUserInputRef = useRef<(() => void) | undefined>(onUserInput);
  const isPanelOpenRef = useRef(isPanelOpen);
  const scheduleFitRef = useRef<TerminalFitScheduler | null>(null);
  const preferredTheme = usePreferredTheme();

  isPanelOpenRef.current = isPanelOpen;
  onOpenLinkRef.current = onOpenLink;
  onTitleChangeRef.current = onTitleChange;
  onUserInputRef.current = onUserInput;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let terminal: XTermTerminal | null = null;
    let fitAddon: FitAddon | null = null;
    let replayNextSeq: number | null = null;
    const replayWriteState: TerminalReplayWriteState = {
      suppressedWriteCount: 0,
    };
    let resizeAnimationFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function mountTerminal(containerElement: HTMLDivElement): Promise<void> {
      const [
        { Terminal },
        { FitAddon: LoadedFitAddon },
        { WebLinksAddon },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      if (disposed) {
        return;
      }

      terminal = new Terminal({
        allowProposedApi: false,
        convertEol: true,
        cursorBlink: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 12,
        scrollback: 10_000,
        theme: buildTerminalTheme(),
      });
      terminalRef.current = terminal;
      fitAddon = new LoadedFitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(
        new WebLinksAddon((event, uri) => {
          openTerminalWebLink({
            event,
            onOpenLink: onOpenLinkRef.current,
            uri,
          });
        }),
      );
      terminal.open(containerElement);
      const fitTerminal = () => {
        if (!fitAddon || !terminal) {
          return;
        }
        if (!hasVisibleTerminalSize({ containerElement })) {
          return;
        }
        fitAddon.fit();
        if (socket) {
          sendTerminalResize({
            socket,
            terminal,
          });
        }
      };
      const scheduleFit: TerminalFitScheduler = () => {
        if (resizeAnimationFrame !== null) {
          return;
        }
        resizeAnimationFrame = window.requestAnimationFrame(() => {
          resizeAnimationFrame = null;
          fitTerminal();
        });
      };
      fitTerminal();
      scheduleFitRef.current = scheduleFit;
      if (isPanelOpenRef.current) {
        terminal.focus();
      }

      socket = new WebSocket(
        buildTerminalWebSocketUrl({
          terminalId: session.id,
          threadId,
        }),
      );
      const activeSocket = socket;
      const activeTerminal = terminal;

      activeSocket.onopen = () => {
        sendTerminalResize({
          socket: activeSocket,
          terminal: activeTerminal,
        });
      };
      activeSocket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        let parsedMessage: unknown;
        try {
          parsedMessage = JSON.parse(event.data);
        } catch {
          return;
        }
        const result = terminalServerMessageSchema.safeParse(parsedMessage);
        if (!result.success) {
          return;
        }
        handleTerminalServerMessage({
          message: result.data,
          replayNextSeq,
          replayWriteState,
          setReplayNextSeq: (nextSeq) => {
            replayNextSeq = nextSeq;
          },
          terminal: activeTerminal,
        });
      };
      activeSocket.onclose = () => {
        if (!disposed) {
          writeTerminalStatus({
            terminal: activeTerminal,
            text: "Terminal connection closed",
          });
        }
      };
      activeTerminal.onData((data) => {
        if (replayWriteState.suppressedWriteCount > 0) {
          return;
        }
        if (activeSocket.readyState !== WebSocket.OPEN) {
          return;
        }
        onUserInputRef.current?.();
        activeSocket.send(
          JSON.stringify({
            type: "input",
            dataBase64: encodeUtf8Base64(data),
          }),
        );
      });
      activeTerminal.onTitleChange((title) => {
        if (replayWriteState.suppressedWriteCount > 0) {
          return;
        }
        onTitleChangeRef.current?.(title);
      });

      resizeObserver = new ResizeObserver((entries) => {
        if (!hasVisibleTerminalSize({ containerElement, entries })) {
          return;
        }
        scheduleFit();
      });
      resizeObserver.observe(containerElement);
    }

    void mountTerminal(container).catch((error) => {
      if (!disposed) {
        container.textContent =
          error instanceof Error ? error.message : String(error);
      }
    });

    return () => {
      disposed = true;
      if (resizeAnimationFrame !== null) {
        window.cancelAnimationFrame(resizeAnimationFrame);
      }
      resizeObserver?.disconnect();
      socket?.close();
      terminal?.dispose();
      terminalRef.current = null;
      scheduleFitRef.current = null;
    };
  }, [session.id, threadId]);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }
    terminalRef.current?.focus();
    scheduleFitRef.current?.();
  }, [isPanelOpen]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.theme = buildTerminalTheme();
  }, [preferredTheme]);

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-background p-2">
      <div
        ref={containerRef}
        className="h-full min-h-0 w-full overflow-hidden"
      />
    </div>
  );
}
