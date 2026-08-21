import {
  buildTerminalWebSocketPath,
  TerminalWebSocketTransport,
} from "@bb/client-core";
import type { TerminalSession } from "@bb/server-contract";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  AppState,
  Linking,
  View,
  type AppStateStatus,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { FetchTerminalOutput } from "@/data/terminals";
import { useTheme } from "@/theme";
import { Spinner, Text } from "@/ui";
import {
  applyStickyControl,
  createTerminalWriteBatcher,
  decodeTerminalOutputBytes,
  encodeTerminalInputChunks,
  type TerminalAccessoryKey,
  type TerminalHostMessage,
  type TerminalWriteBatcher,
} from "./terminal-bridge";
import { parseTerminalPageMessage } from "./terminal-page-message";
import { useTerminalPageHtml } from "./terminal-page-source";
import {
  createTerminalStreamController,
  type TerminalStreamController,
} from "./terminal-stream";
import {
  buildTerminalThemeFromTokens,
  TERMINAL_FONT_SIZE,
} from "./terminal-theme";

/**
 * One attached terminal: the xterm WebView page plus the RN-owned attach
 * socket (`@bb/client-core` `TerminalWebSocketTransport` over React Native's
 * WebSocket; the native cookie jar authenticates it through bb connect).
 * Output is batched into `write` messages (`createTerminalWriteBatcher`),
 * keystrokes come back as `data` and go out through the transport; replay
 * / gap semantics live in `terminal-stream.ts`. Backgrounding the app
 * suspends the socket; foregrounding resumes it from the last seen chunk.
 *
 * Mount one instance per session id (the parent keys it): a new session is
 * a fresh page and socket.
 */

export interface TerminalViewHandle {
  focus(): void;
  blur(): void;
  sendKey(key: TerminalAccessoryKey, ctrl: boolean): void;
  paste(text: string): void;
}

interface TerminalViewProps {
  session: TerminalSession;
  /** The profile's server URL; the socket URL is derived from it. */
  serverUrl: string;
  /** `GET /terminals/:id/output` for replay gap fills; null disables it. */
  fetchOutput: FetchTerminalOutput | null;
  /** Raise the keyboard once the page is ready. */
  autoFocus?: boolean;
  /**
   * The view is on screen. A retained-but-hidden terminal (panel tab switch,
   * sheet closed) is blurred so its keyboard does not stay up over whatever
   * replaced it; the socket keeps streaming.
   */
  visible?: boolean;
  /** Pending sticky Ctrl from the accessory bar; consumed by the next key. */
  stickyControl?: boolean;
  onStickyControlConsumed?: () => void;
  onSessionChange?: (session: TerminalSession) => void;
  /** The shell's OSC title (raw; the caller normalizes / debounces). */
  onTitleChange?: (title: string) => void;
  /** Dev / e2e: the page mirrors its last lines every 500 ms. */
  textMirror?: boolean;
  onTextMirror?: (lines: string[]) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function terminalSocketUrl(serverUrl: string, terminalId: string): string {
  const url = new URL(serverUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else throw new Error(`Unsupported server URL scheme: ${url.protocol}`);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}${buildTerminalWebSocketPath({ terminalId })}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

function decodeBase64Text(dataBase64: string): string {
  return new TextDecoder().decode(decodeTerminalOutputBytes(dataBase64));
}

function isInlineTerminalPageRequest(request: { url: string }): boolean {
  return request.url.startsWith("about:") || request.url.startsWith("data:");
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView(
    {
      session,
      serverUrl,
      fetchOutput,
      autoFocus = false,
      visible = true,
      stickyControl = false,
      onStickyControlConsumed,
      onSessionChange,
      onTitleChange,
      textMirror = false,
      onTextMirror,
      style,
      testID,
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const theme = useMemo(() => buildTerminalThemeFromTokens(tokens), [tokens]);
    const page = useTerminalPageHtml();
    const webViewRef = useRef<WebView | null>(null);
    const pageReadyRef = useRef(false);
    const transportRef = useRef<TerminalWebSocketTransport | null>(null);
    const controllerRef = useRef<TerminalStreamController | null>(null);
    const batcherRef = useRef<TerminalWriteBatcher | null>(null);
    const sessionStatusRef = useRef(session.status);
    const stickyControlRef = useRef(stickyControl);
    const themeRef = useRef(theme);
    const textMirrorRef = useRef(textMirror);
    const autoFocusRef = useRef(autoFocus);
    const callbacksRef = useRef({
      onSessionChange,
      onTitleChange,
      onTextMirror,
      onStickyControlConsumed,
      fetchOutput,
    });
    useEffect(() => {
      sessionStatusRef.current = session.status;
      stickyControlRef.current = stickyControl;
      themeRef.current = theme;
      textMirrorRef.current = textMirror;
      autoFocusRef.current = autoFocus;
      callbacksRef.current = {
        onSessionChange,
        onTitleChange,
        onTextMirror,
        onStickyControlConsumed,
        fetchOutput,
      };
    });

    const post = useCallback((message: TerminalHostMessage) => {
      webViewRef.current?.postMessage(JSON.stringify(message));
    }, []);

    // Transport + stream controller per session; the socket starts once the
    // page has reported `ready` (a message posted before the page listens is
    // lost).
    const terminalId = session.id;
    useEffect(() => {
      let disposed = false;
      const batcher = createTerminalWriteBatcher({
        flush: (batch) =>
          post({ type: "write", chunks: batch.chunks, replay: batch.replay }),
      });
      const fetch = callbacksRef.current.fetchOutput;
      const controller = createTerminalStreamController({
        sink: {
          write: (dataBase64, replay) => batcher.push(dataBase64, replay),
          writeStatus: (text) => {
            batcher.flushNow();
            post({ type: "status", text });
          },
          reset: () => {
            batcher.flushNow();
            post({ type: "reset" });
          },
          onSession: (next) => callbacksRef.current.onSessionChange?.(next),
        },
        fetchOutput:
          fetch === null ? null : (sinceSeq) => fetch({ terminalId, sinceSeq }),
      });
      const transport = new TerminalWebSocketTransport({
        createSocket: (url) => new WebSocket(url),
        url: terminalSocketUrl(serverUrl, terminalId),
        shouldReconnect: () =>
          !disposed && sessionStatusRef.current === "running",
        onMessage: (message) => controller.handleMessage(message),
        onSequenceGap: (expected, received) =>
          controller.handleSequenceGap(expected, received),
        onConnectionState: (state) => controller.handleConnectionState(state),
        onInputOverflow: (maxBytes) => controller.handleInputOverflow(maxBytes),
        onInvalidMessage: () => controller.handleInvalidMessage(),
      });
      batcherRef.current = batcher;
      controllerRef.current = controller;
      transportRef.current = transport;
      if (pageReadyRef.current) {
        transport.start();
      }
      const appState = AppState.addEventListener(
        "change",
        (state: AppStateStatus) => {
          if (state === "background") {
            controller.markSuspended();
            transport.suspend();
          } else if (state === "active") {
            transport.resume();
          }
        },
      );
      return () => {
        disposed = true;
        appState.remove();
        transport.dispose();
        controller.dispose();
        batcher.dispose();
        if (transportRef.current === transport) transportRef.current = null;
        if (controllerRef.current === controller) controllerRef.current = null;
        if (batcherRef.current === batcher) batcherRef.current = null;
      };
    }, [post, serverUrl, terminalId]);

    useEffect(() => {
      if (visible) return;
      post({ type: "blur" });
    }, [post, visible]);

    // Re-theme a live page when the palette / mode changes.
    useEffect(() => {
      if (!pageReadyRef.current) return;
      post({ type: "theme", theme, fontSize: TERMINAL_FONT_SIZE });
    }, [post, theme]);

    const sendInputText = useCallback((text: string) => {
      const transport = transportRef.current;
      if (!transport) return;
      for (const chunk of encodeTerminalInputChunks(text)) {
        transport.sendInput(chunk);
      }
    }, []);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        const message = parseTerminalPageMessage(event.nativeEvent.data);
        if (!message) return;
        switch (message.type) {
          case "ready": {
            pageReadyRef.current = true;
            post({
              type: "init",
              theme: themeRef.current,
              fontSize: TERMINAL_FONT_SIZE,
              textMirror: textMirrorRef.current,
            });
            transportRef.current?.sendResize(message.cols, message.rows);
            transportRef.current?.start();
            if (autoFocusRef.current) post({ type: "focus" });
            return;
          }
          case "data": {
            // xterm emits protocol replies through onData alongside typing;
            // none of it may reach a session that is not running.
            if (sessionStatusRef.current !== "running") return;
            const transport = transportRef.current;
            if (!transport) return;
            if (stickyControlRef.current) {
              const { text, consumed } = applyStickyControl(
                decodeBase64Text(message.dataBase64),
              );
              if (consumed) {
                stickyControlRef.current = false;
                callbacksRef.current.onStickyControlConsumed?.();
                sendInputText(text);
                return;
              }
            }
            transport.sendInput(message.dataBase64);
            return;
          }
          case "resize":
            transportRef.current?.sendResize(message.cols, message.rows);
            return;
          case "link":
            void Linking.openURL(message.url).catch(() => undefined);
            return;
          case "title":
            if (sessionStatusRef.current !== "running") return;
            callbacksRef.current.onTitleChange?.(message.title);
            return;
          case "text-mirror":
            callbacksRef.current.onTextMirror?.(message.lines);
            return;
          case "error":
            console.warn(`[terminal page] ${message.message}`);
            return;
        }
      },
      [post, sendInputText],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => post({ type: "focus" }),
        blur: () => post({ type: "blur" }),
        sendKey: (key, ctrl) => post({ type: "key", key, ctrl }),
        paste: (text) => post({ type: "paste", text }),
      }),
      [post],
    );

    if (page.error) {
      return (
        <View
          style={[{ flex: 1, backgroundColor: theme.background }, style]}
          className="items-center justify-center p-4"
          testID={testID}
        >
          <Text className="text-center text-sm text-destructive-text">
            Could not load the terminal page.
          </Text>
          <Text variant="caption" className="pt-1 text-center">
            {page.error.message}
          </Text>
        </View>
      );
    }
    if (page.html === null) {
      return (
        <View
          style={[{ flex: 1, backgroundColor: theme.background }, style]}
          className="items-center justify-center"
          testID={testID}
        >
          <Spinner />
        </View>
      );
    }
    return (
      <View
        style={[{ flex: 1, backgroundColor: theme.background }, style]}
        testID={testID}
      >
        <WebView
          ref={webViewRef}
          source={{ html: page.html }}
          originWhitelist={["*"]}
          javaScriptEnabled
          allowsInlineMediaPlayback
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          // The page is a bundled asset that never navigates: links are
          // posted to RN (`link` message), so any navigation request other
          // than the inline document itself is refused.
          onShouldStartLoadWithRequest={isInlineTerminalPageRequest}
          allowsLinkPreview={false}
          dataDetectorTypes="none"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          webviewDebuggingEnabled={__DEV__}
          onMessage={handleMessage}
          style={{ flex: 1, backgroundColor: theme.background }}
          containerStyle={{ backgroundColor: theme.background }}
        />
      </View>
    );
  },
);
