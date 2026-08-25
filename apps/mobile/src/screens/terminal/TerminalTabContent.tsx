import type { TerminalSession } from "@bb/server-contract";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { e2eModeEnabled } from "@/app-shell/e2e";
import { useProfileClient, useProfiles } from "@/app-shell/ProfilesProvider";
import {
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
  terminalSessionStatusNotice,
  useFetchTerminalOutput,
  useTerminalSession,
} from "@/data/terminals";
import { useTheme } from "@/theme";
import { Button, Spinner, Text, toast, type NativeMenuAction } from "@/ui";
import { TerminalAccessoryBar } from "./TerminalAccessoryBar";
import { TerminalView, type TerminalViewHandle } from "./TerminalView";
import type { TerminalAccessoryKey } from "./terminal-bridge";
import { useTerminalTitleSync } from "./use-terminal-title-sync";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * One terminal session as tab / screen content: the attached xterm view, the
 * accessory key bar, and the not-running states. Usable inside the thread
 * panel's Terminal tab or full screen (`TerminalScreen`). The chrome sits on
 * the raised solid surface the xterm canvas is painted with, so the page and
 * its frame read as one.
 */

interface TerminalTabContentProps {
  terminalId: string;
  autoFocus?: boolean;
  /** Offered on the exited / disconnected card (and by the screen header). */
  onRestart?: () => void;
  onStartNew?: () => void;
  restartPending?: boolean;
  /** Android: adds a "…" key that opens the full-screen route's actions sheet. */
  onMenu?: () => void;
  /** iOS: the full-screen route's actions as a native menu on the "…" key. */
  menuActions?: readonly NativeMenuAction[];
  /** False for a retained-but-hidden terminal (inactive panel tab / closed sheet). */
  visible?: boolean;
  testID?: string;
}

export function TerminalTabContent(props: TerminalTabContentProps) {
  // The panel sheet renders through the root portal host, so this content can
  // outlive its screen (profile switch, sign-out); the session hooks below
  // need an active connection.
  const { connection } = useProfiles();
  const { tokens } = useTheme();
  if (!connection) {
    return (
      <View
        style={[styles.fill, { backgroundColor: tokens.surfaceRaisedSolid }]}
        className="justify-center p-6"
        testID={props.testID ?? "terminal-tab"}
      >
        <Text variant="footnote" tone="muted" className="text-center">
          No active server.
        </Text>
      </View>
    );
  }
  return <ConnectedTerminalTabContent {...props} />;
}

function ConnectedTerminalTabContent({
  terminalId,
  autoFocus = true,
  onRestart,
  onStartNew,
  restartPending = false,
  onMenu,
  menuActions,
  visible = true,
  testID = "terminal-tab",
}: TerminalTabContentProps) {
  const { tokens } = useTheme();
  const sessionQuery = useTerminalSession(terminalId);
  const session = sessionQuery.data;

  if (sessionQuery.isLoading && !session) {
    return (
      <View
        style={[styles.fill, { backgroundColor: tokens.surfaceRaisedSolid }]}
        className="items-center justify-center"
        testID={testID}
      >
        <Spinner />
      </View>
    );
  }
  if (!session) {
    return (
      <View
        style={[styles.fill, { backgroundColor: tokens.surfaceRaisedSolid }]}
        className="items-center justify-center gap-4 p-6"
        testID={testID}
      >
        <View className="items-center gap-1">
          <Text variant="headline" className="text-center">
            {sessionQuery.error
              ? "Could not load this terminal."
              : "This terminal no longer exists."}
          </Text>
          {sessionQuery.error ? (
            <Text
              variant="footnote"
              tone="muted"
              className="text-center"
              selectable
            >
              {sessionQuery.error.message}
            </Text>
          ) : null}
        </View>
        {onStartNew ? (
          <Button icon="Plus" variant="outline" onPress={onStartNew}>
            Start new terminal
          </Button>
        ) : null}
      </View>
    );
  }
  return (
    <AttachedTerminal
      key={session.id}
      session={session}
      autoFocus={autoFocus}
      onRestart={onRestart}
      onStartNew={onStartNew}
      restartPending={restartPending}
      onMenu={onMenu}
      menuActions={menuActions}
      visible={visible}
      testID={testID}
    />
  );
}

interface AttachedTerminalProps {
  session: TerminalSession;
  autoFocus: boolean;
  onRestart?: () => void;
  onStartNew?: () => void;
  restartPending: boolean;
  onMenu?: () => void;
  menuActions?: readonly NativeMenuAction[];
  visible: boolean;
  testID: string;
}

function AttachedTerminal({
  session,
  autoFocus,
  onRestart,
  onStartNew,
  restartPending,
  onMenu,
  menuActions,
  visible,
  testID,
}: AttachedTerminalProps) {
  const { tokens } = useTheme();
  const { serverUrl } = useProfileClient();
  const queryClient = useQueryClient();
  const fetchOutput = useFetchTerminalOutput();
  const viewRef = useRef<TerminalViewHandle | null>(null);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [mirrorLines, setMirrorLines] = useState<string[]>([]);
  // A session that was already exited when this mounted has no page to show
  // (the socket would only answer `terminal_exited`); one that exits while
  // attached keeps its last output on screen under the notice.
  const [hadLiveSession] = useState(session.status !== "exited");
  const handleTitleChange = useTerminalTitleSync(session);

  // The WebView owns the keyboard; the accessory bar's keyboard key toggles
  // it, so track whether one is up (any keyboard: the notifications are
  // app-wide).
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      IS_IOS ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      IS_IOS ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const handleSessionChange = useCallback(
    (next: TerminalSession) => {
      if (next.status === "exited")
        applyTerminalSessionClose(queryClient, next);
      else applyTerminalSessionUpsert(queryClient, next);
    },
    [queryClient],
  );
  const handleKey = useCallback(
    (key: TerminalAccessoryKey) => {
      viewRef.current?.sendKey(key, ctrlActive);
      if (ctrlActive) setCtrlActive(false);
    },
    [ctrlActive],
  );
  const handlePaste = useCallback(() => {
    void Clipboard.getStringAsync().then(
      (text) => {
        if (!text) {
          toast.info("Clipboard is empty");
          return;
        }
        viewRef.current?.paste(text);
      },
      () => toast.error("Could not read the clipboard"),
    );
  }, []);
  const toggleKeyboard = useCallback(() => {
    if (keyboardVisible) viewRef.current?.blur();
    else viewRef.current?.focus();
  }, [keyboardVisible]);

  const notice = terminalSessionStatusNotice(session);
  const showView = hadLiveSession;

  return (
    <View
      style={[styles.fill, { backgroundColor: tokens.surfaceRaisedSolid }]}
      testID={testID}
    >
      {showView ? (
        <TerminalView
          ref={viewRef}
          session={session}
          serverUrl={serverUrl}
          fetchOutput={fetchOutput}
          autoFocus={autoFocus}
          visible={visible}
          stickyControl={ctrlActive}
          onStickyControlConsumed={() => setCtrlActive(false)}
          onSessionChange={handleSessionChange}
          onTitleChange={handleTitleChange}
          textMirror={e2eModeEnabled}
          onTextMirror={e2eModeEnabled ? setMirrorLines : undefined}
          style={styles.fill}
          testID="terminal-view"
        />
      ) : null}
      {notice !== null ? (
        <View
          style={[
            styles.statusCard,
            {
              borderTopColor: tokens.borderHairline,
              backgroundColor: tokens.surfaceRaisedSolid,
            },
          ]}
          testID="terminal-status-card"
        >
          <Text variant="headline" className="text-center">
            {notice}
          </Text>
          {!showView ? (
            <Text variant="footnote" tone="muted" className="text-center">
              Its output is no longer available.
            </Text>
          ) : null}
          <View className="flex-row justify-center gap-3">
            {onRestart ? (
              <Button
                variant="outline"
                icon="RotateCcw"
                loading={restartPending}
                onPress={onRestart}
                testID="terminal-restart"
              >
                Restart
              </Button>
            ) : null}
            {onStartNew ? (
              <Button
                icon="Plus"
                onPress={onStartNew}
                testID="terminal-start-new"
              >
                New terminal
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
      {showView && session.status === "running" ? (
        <TerminalAccessoryBar
          ctrlActive={ctrlActive}
          onToggleCtrl={() => setCtrlActive((value) => !value)}
          onKey={handleKey}
          onPaste={handlePaste}
          onKeyboard={toggleKeyboard}
          keyboardVisible={keyboardVisible}
          onMenu={onMenu}
          menuActions={menuActions}
          testID="terminal-accessory-bar"
        />
      ) : null}
      {e2eModeEnabled && showView ? (
        // Maestro reads the viewport's last lines here (the WebView's own
        // text is invisible to the accessibility tree).
        <Text
          variant="caption"
          mono
          numberOfLines={1}
          accessibilityLabel={mirrorLines.join(" ")}
          testID="terminal-text-mirror"
          className="px-2 py-0.5 text-2xs text-muted-foreground"
        >
          {lastNonEmptyLine(mirrorLines)}
        </Text>
      ) : null}
    </View>
  );
}

function lastNonEmptyLine(lines: readonly string[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) return line;
  }
  return "";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  statusCard: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
});
