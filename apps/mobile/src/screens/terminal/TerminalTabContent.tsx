import type { TerminalSession } from "@bb/server-contract";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { e2eModeEnabled } from "@/app-shell/e2e";
import { useProfileClient, useProfiles } from "@/app-shell/ProfilesProvider";
import {
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
  terminalSessionStatusNotice,
  useFetchTerminalOutput,
  useTerminalSession,
} from "@/data/terminals";
import { Button, EmptyStatePanel, Spinner, Text, toast } from "@/ui";
import { TerminalAccessoryBar } from "./TerminalAccessoryBar";
import { TerminalView, type TerminalViewHandle } from "./TerminalView";
import type { TerminalAccessoryKey } from "./terminal-bridge";
import { useTerminalTitleSync } from "./use-terminal-title-sync";

/**
 * One terminal session as tab / screen content: the attached xterm view, the
 * accessory key bar, and the not-running states. Usable inside the thread
 * panel's Terminal tab or full screen (`TerminalScreen`).
 */

interface TerminalTabContentProps {
  terminalId: string;
  autoFocus?: boolean;
  /** Offered on the exited / disconnected card (and by the screen header). */
  onRestart?: () => void;
  onStartNew?: () => void;
  restartPending?: boolean;
  /** Adds a "…" key to the accessory bar (the full-screen route's menu). */
  onMenu?: () => void;
  /** False for a retained-but-hidden terminal (inactive panel tab / closed sheet). */
  visible?: boolean;
  testID?: string;
}

export function TerminalTabContent(props: TerminalTabContentProps) {
  // The panel sheet renders through the root portal host, so this content can
  // outlive its screen (profile switch, sign-out); the session hooks below
  // need an active connection.
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <View
        className="flex-1 justify-center bg-sidebar p-4"
        testID={props.testID ?? "terminal-tab"}
      >
        <EmptyStatePanel>No active server.</EmptyStatePanel>
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
  visible = true,
  testID = "terminal-tab",
}: TerminalTabContentProps) {
  const sessionQuery = useTerminalSession(terminalId);
  const session = sessionQuery.data;

  if (sessionQuery.isLoading && !session) {
    return (
      <View
        className="flex-1 items-center justify-center bg-sidebar"
        testID={testID}
      >
        <Spinner />
      </View>
    );
  }
  if (!session) {
    return (
      <View className="flex-1 gap-3 bg-sidebar p-4" testID={testID}>
        <EmptyStatePanel>
          <Text className="text-center text-sm text-muted-foreground">
            {sessionQuery.error
              ? "Could not load this terminal."
              : "This terminal no longer exists."}
          </Text>
          {sessionQuery.error ? (
            <Text variant="caption" className="pt-1 text-center">
              {sessionQuery.error.message}
            </Text>
          ) : null}
        </EmptyStatePanel>
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
  visible,
  testID,
}: AttachedTerminalProps) {
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
  const focusTerminal = useCallback(() => viewRef.current?.focus(), []);

  const notice = terminalSessionStatusNotice(session);
  const showView = hadLiveSession;

  return (
    <View className="flex-1 bg-sidebar" testID={testID}>
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
          style={{ flex: 1 }}
          testID="terminal-view"
        />
      ) : null}
      {notice !== null ? (
        <View
          className="gap-3 border-t border-border bg-background p-4"
          testID="terminal-status-card"
        >
          <Text weight="medium" className="text-center text-foreground">
            {notice}
          </Text>
          {!showView ? (
            <Text className="text-center text-sm text-muted-foreground">
              Its output is no longer available.
            </Text>
          ) : null}
          <View className="flex-row justify-center gap-2">
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
          onKeyboard={focusTerminal}
          onMenu={onMenu}
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
