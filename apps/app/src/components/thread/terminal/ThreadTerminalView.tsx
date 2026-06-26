import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "@xterm/xterm/css/xterm.css";
import type { ITheme, Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalServerMessage, TerminalSession } from "@bb/server-contract";
import { terminalServerMessageSchema } from "@bb/server-contract";
import { useAppThemeEpoch } from "@/hooks/useAppTheme";
import { usePreferredTheme } from "@/hooks/useTheme";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import {
  openUrlInExternalBrowser,
  useOpenUrlByPreference,
} from "@/lib/url-open-routing";
import type { MessageProseSelection } from "@/components/thread/timeline/SelectableMessageProse.js";
import { TimelineSelectionMenu } from "@/components/thread/timeline/TimelineSelectionMenu.js";
import { buildTerminalWebSocketUrl } from "./terminal-websocket-url";

const TERMINAL_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace";
const TERMINAL_SELECTION_DRAG_DIRECTION_THRESHOLD_PX = 4;

type TerminalFitScheduler = () => void;

interface TerminalSelectionAnchorPoint {
  x: number;
  y: number;
}

interface TerminalSelectionAnchor {
  point: TerminalSelectionAnchorPoint;
  side: "top" | "bottom";
}

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
  onSelectionAddToChat?: (text: string) => void;
  onTitleChange?: TerminalTitleChangeHandler;
  onUserInput?: () => void;
  session: TerminalSession;
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

interface WriteTerminalSessionStatusNoticeArgs {
  lastNotice: TerminalSessionStatusNoticeRef;
  session: TerminalSession;
  terminal: XTermTerminal;
}

interface TerminalOutputWriteArgs {
  isReplay: boolean;
  replayWriteState: TerminalReplayWriteState;
  terminal: XTermTerminal;
  text: string;
}

interface OpenTerminalWebLinkArgs {
  event: MouseEvent;
  onOpenLink: MarkdownPreviewLinkHandler;
  uri: string;
}

interface TerminalReplayWriteState {
  suppressedWriteCount: number;
}

type TerminalSessionStatusNotice = "disconnected" | "exited";
type TerminalSessionStatusNoticeRef = {
  current: TerminalSessionStatusNotice | null;
};

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

function terminalSelectionAnchorPointFromEvent(
  event: Pick<MouseEvent, "clientX" | "clientY">,
): TerminalSelectionAnchorPoint | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

function terminalSelectionAnchorFromPointerRelease(
  startPoint: TerminalSelectionAnchorPoint | null,
  releaseEvent: Pick<MouseEvent, "clientX" | "clientY">,
): TerminalSelectionAnchor | null {
  const releasePoint = terminalSelectionAnchorPointFromEvent(releaseEvent);
  if (releasePoint === null) {
    return null;
  }

  return {
    point: releasePoint,
    side:
      startPoint !== null &&
      releasePoint.y - startPoint.y >
        TERMINAL_SELECTION_DRAG_DIRECTION_THRESHOLD_PX
        ? "bottom"
        : "top",
  };
}

function buildTerminalSelection({
  anchor,
  containerElement,
  text,
}: {
  anchor: TerminalSelectionAnchor | null;
  containerElement: HTMLElement;
  text: string;
}): MessageProseSelection | null {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return null;
  }

  const selection: MessageProseSelection = {
    text: trimmedText,
    rect:
      anchor === null
        ? containerElement.getBoundingClientRect()
        : new DOMRect(anchor.point.x, anchor.point.y, 0, 0),
  };
  if (anchor !== null) {
    selection.anchorPoint = anchor.point;
    selection.anchorSide = anchor.side;
  }
  return selection;
}

function writeTerminalStatus({ terminal, text }: WriteTerminalStatusArgs): void {
  terminal.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
}

function writeTerminalSessionStatusNotice({
  lastNotice,
  session,
  terminal,
}: WriteTerminalSessionStatusNoticeArgs): void {
  switch (session.status) {
    case "disconnected":
      if (lastNotice.current === "disconnected") {
        return;
      }
      lastNotice.current = "disconnected";
      writeTerminalStatus({ terminal, text: "Terminal disconnected" });
      return;
    case "exited":
      if (lastNotice.current === "exited") {
        return;
      }
      lastNotice.current = "exited";
      writeTerminalStatus({
        terminal,
        text:
          session.exitCode === null
            ? "Terminal exited"
            : `Terminal exited with code ${session.exitCode}`,
      });
      return;
    case "starting":
    case "running":
      lastNotice.current = null;
      return;
  }
}

function openTerminalWebLink({
  event,
  onOpenLink,
  uri,
}: OpenTerminalWebLinkArgs): void {
  if (onOpenLink({ href: uri })) {
    event.preventDefault();
    return;
  }
  openUrlInExternalBrowser(uri);
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
  onSelectionAddToChat,
  onTitleChange,
  onUserInput,
  session,
}: ThreadTerminalViewProps) {
  const [activeSelection, setActiveSelection] =
    useState<MessageProseSelection | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const pointerIsDownRef = useRef(false);
  const pointerStartPointRef = useRef<TerminalSelectionAnchorPoint | null>(
    null,
  );
  const lastPointerReleaseAnchorRef = useRef<TerminalSelectionAnchor | null>(
    null,
  );
  const onTitleChangeRef = useRef<TerminalTitleChangeHandler | undefined>(
    onTitleChange,
  );
  const onUserInputRef = useRef<(() => void) | undefined>(onUserInput);
  const isPanelOpenRef = useRef(isPanelOpen);
  const sessionStatusRef = useRef<TerminalSession["status"]>(session.status);
  const sessionRef = useRef(session);
  const lastStatusNoticeRef = useRef<TerminalSessionStatusNotice | null>(null);
  const scheduleFitRef = useRef<TerminalFitScheduler | null>(null);
  const preferredTheme = usePreferredTheme();
  // The xterm canvas bakes its palette, so re-apply the theme on app-palette
  // changes too, not just light/dark toggles.
  const appThemeEpoch = useAppThemeEpoch();
  const openUrlByPreference = useOpenUrlByPreference();
  const handleOpenLinkByPreference =
    useCallback<MarkdownPreviewLinkHandler>(
      ({ href }) => openUrlByPreference(href),
      [openUrlByPreference],
    );
  const effectiveOnOpenLink = onOpenLink ?? handleOpenLinkByPreference;
  const onOpenLinkRef =
    useRef<MarkdownPreviewLinkHandler>(effectiveOnOpenLink);

  isPanelOpenRef.current = isPanelOpen;
  sessionStatusRef.current = session.status;
  sessionRef.current = session;
  onOpenLinkRef.current = effectiveOnOpenLink;
  onTitleChangeRef.current = onTitleChange;
  onUserInputRef.current = onUserInput;

  const reportTerminalSelection = useCallback(
    (anchor: TerminalSelectionAnchor | null) => {
      const terminal = terminalRef.current;
      const container = containerRef.current;
      if (!terminal || !container) {
        setActiveSelection(null);
        return;
      }
      setActiveSelection(
        buildTerminalSelection({
          anchor,
          containerElement: container,
          text: terminal.getSelection(),
        }),
      );
    },
    [],
  );

  const clearTerminalSelection = useCallback(() => {
    terminalRef.current?.clearSelection();
    setActiveSelection(null);
  }, []);

  const handleSelectionAddToChat = useCallback(
    (text: string) => {
      onSelectionAddToChat?.(text);
      clearTerminalSelection();
    },
    [clearTerminalSelection, onSelectionAddToChat],
  );

  const handleTerminalPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      pointerIsDownRef.current = true;
      pointerStartPointRef.current =
        terminalSelectionAnchorPointFromEvent(event);
    },
    [],
  );

  const handleTerminalPointerRelease = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const anchor = terminalSelectionAnchorFromPointerRelease(
        pointerStartPointRef.current,
        event,
      );
      lastPointerReleaseAnchorRef.current = anchor;
      pointerIsDownRef.current = false;
      pointerStartPointRef.current = null;
      window.requestAnimationFrame(() => {
        reportTerminalSelection(anchor);
      });
    },
    [reportTerminalSelection],
  );

  const handleTerminalPointerCancel = useCallback(() => {
    pointerIsDownRef.current = false;
    pointerStartPointRef.current = null;
    window.requestAnimationFrame(() => {
      reportTerminalSelection(lastPointerReleaseAnchorRef.current);
    });
  }, [reportTerminalSelection]);

  useEffect(() => {
    setActiveSelection(null);
  }, [session.id]);

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
    let selectionAnimationFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let selectionChangeDisposable: { dispose: () => void } | null = null;

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
      writeTerminalSessionStatusNotice({
        lastNotice: lastStatusNoticeRef,
        session: sessionRef.current,
        terminal,
      });
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
        buildTerminalWebSocketUrl({ terminalId: session.id }),
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
        if (sessionStatusRef.current !== "running") {
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
        if (sessionStatusRef.current !== "running") {
          return;
        }
        onTitleChangeRef.current?.(title);
      });
      const scheduleSelectionReport = () => {
        if (pointerIsDownRef.current || selectionAnimationFrame !== null) {
          return;
        }
        selectionAnimationFrame = window.requestAnimationFrame(() => {
          selectionAnimationFrame = null;
          reportTerminalSelection(lastPointerReleaseAnchorRef.current);
        });
      };
      selectionChangeDisposable = activeTerminal.onSelectionChange(
        scheduleSelectionReport,
      );

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
      if (selectionAnimationFrame !== null) {
        window.cancelAnimationFrame(selectionAnimationFrame);
      }
      resizeObserver?.disconnect();
      selectionChangeDisposable?.dispose();
      socket?.close();
      terminal?.dispose();
      terminalRef.current = null;
      scheduleFitRef.current = null;
    };
  }, [reportTerminalSelection, session.id, session.threadId]);

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
    writeTerminalSessionStatusNotice({
      lastNotice: lastStatusNoticeRef,
      session,
      terminal,
    });
  }, [session]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.theme = buildTerminalTheme();
  }, [preferredTheme, appThemeEpoch]);

  return (
    <div
      className="h-full min-h-0 w-full overflow-hidden bg-background p-2"
      onPointerDown={handleTerminalPointerDown}
      onPointerUp={handleTerminalPointerRelease}
      onPointerCancel={handleTerminalPointerCancel}
    >
      <div
        ref={containerRef}
        className="h-full min-h-0 w-full overflow-hidden"
      />
      <TimelineSelectionMenu
        selection={activeSelection}
        onAddToChat={
          onSelectionAddToChat === undefined
            ? undefined
            : handleSelectionAddToChat
        }
        onDismiss={clearTerminalSelection}
      />
    </div>
  );
}
