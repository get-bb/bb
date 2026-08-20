import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useProfiles } from "@/app-shell/ProfilesProvider";
import {
  useCloseTerminal,
  useCreateTerminal,
  useRestartTerminal,
  useTerminalSession,
} from "@/data/terminals";
import { useTheme } from "@/theme";
import { EmptyStatePanel, Icon, KeyboardPaddingView, Text } from "@/ui";
// Leaf imports: the panel barrel pulls in the registration manifest, which
// imports this module (see the panel README).
import { usePanel } from "../panel/PanelProvider";
import type {
  PanelLauncherContentProps,
  PanelTabContentProps,
  PanelTabOfKind,
} from "../panel/registry";
import { threadTerminalHref } from "../shell/hrefs";
import { TerminalSessionsList } from "./TerminalSessionsList";
import { TerminalTabContent } from "./TerminalTabContent";
import {
  terminalCreateScopeForPanelScope,
  terminalListScopeForPanelScope,
  terminalScopeUnavailableMessage,
} from "./terminal-scope";

/**
 * Workspace-panel surfaces of the terminal: the Terminal launcher (sessions
 * of the panel's scope + "Start terminal") and the `terminal` tab kind (one
 * attached session with its toolbar). A started or selected session becomes
 * a panel tab; the tab's title opens the same session full screen, where the
 * "…" menu also renames it.
 */

export function TerminalLauncherContent({ scope }: PanelLauncherContentProps) {
  const panel = usePanel();
  const openTerminal = panel.openTerminal;
  const listScope = terminalListScopeForPanelScope(scope);
  const createScope = terminalCreateScopeForPanelScope(scope);
  const onOpenTerminal = useCallback(
    (terminalId: string) => openTerminal(terminalId),
    [openTerminal],
  );
  if (listScope === null || createScope === null) {
    return (
      <View className="p-4" testID="panel-terminal-launcher">
        <EmptyStatePanel>
          {terminalScopeUnavailableMessage(scope)}
        </EmptyStatePanel>
      </View>
    );
  }
  return (
    <TerminalSessionsList
      listScope={listScope}
      createScope={createScope}
      onOpenTerminal={onOpenTerminal}
      testID="panel-terminal-launcher"
    />
  );
}

export function TerminalPanelTabContent(
  props: PanelTabContentProps<PanelTabOfKind<"terminal">>,
) {
  // Panel contents render through the root portal host and can outlive the
  // screen that opened them (profile switch, sign-out).
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <View className="flex-1 justify-center p-4" testID="panel-terminal-tab">
        <EmptyStatePanel>No active server.</EmptyStatePanel>
      </View>
    );
  }
  return <ConnectedTerminalPanelTabContent {...props} />;
}

function ConnectedTerminalPanelTabContent({
  scope,
  tab,
  active,
  panelVisible,
}: PanelTabContentProps<PanelTabOfKind<"terminal">>) {
  const panel = usePanel();
  const router = useRouter();
  const sessionQuery = useTerminalSession(tab.terminalId);
  const session = sessionQuery.data;
  const restartTerminal = useRestartTerminal();
  const closeTerminal = useCloseTerminal();
  const createTerminal = useCreateTerminal();
  const createScope = terminalCreateScopeForPanelScope(scope);
  const tabId = tab.id;
  const { closeTab, openTerminal } = panel;

  const handleRestart = useCallback(() => {
    if (restartTerminal.isPending) return;
    restartTerminal.mutate(
      { terminalId: tab.terminalId },
      {
        onSuccess: (next) => {
          closeTab(tabId);
          openTerminal(next.id);
        },
      },
    );
  }, [closeTab, openTerminal, restartTerminal, tab.terminalId, tabId]);

  const handleStartNew = useCallback(() => {
    if (createScope === null || createTerminal.isPending) return;
    createTerminal.mutate(
      { scope: createScope },
      { onSuccess: (next) => openTerminal(next.id) },
    );
  }, [createScope, createTerminal, openTerminal]);

  const handleClose = useCallback(() => {
    if (closeTerminal.isPending) return;
    closeTerminal.mutate(
      { terminalId: tab.terminalId, mode: "force" },
      { onSettled: () => closeTab(tabId) },
    );
  }, [closeTab, closeTerminal, tab.terminalId, tabId]);

  const handleExpand = useCallback(() => {
    if (scope.kind !== "thread") return;
    panel.close();
    router.push(threadTerminalHref(scope.threadId, tab.terminalId));
  }, [panel, router, scope, tab.terminalId]);

  return (
    <View className="flex-1" testID="panel-terminal-tab">
      <TerminalToolbar
        title={session?.title ?? "Terminal"}
        onExpand={scope.kind === "thread" ? handleExpand : null}
        onRestart={handleRestart}
        onStartNew={createScope === null ? null : handleStartNew}
        onClose={handleClose}
      />
      {/* The sheet only resizes for its own text inputs; the WebView's
          keyboard would otherwise cover the accessory bar. */}
      <KeyboardPaddingView style={styles.fill}>
        <TerminalTabContent
          terminalId={tab.terminalId}
          // Never raise the keyboard by itself inside the sheet: it would cover
          // the terminal the moment the tab opens. Tapping the terminal (or the
          // accessory bar's keyboard key) focuses it.
          autoFocus={false}
          visible={active && panelVisible}
          onRestart={handleRestart}
          onStartNew={createScope === null ? undefined : handleStartNew}
          restartPending={restartTerminal.isPending}
        />
      </KeyboardPaddingView>
    </View>
  );
}

interface TerminalToolbarProps {
  title: string;
  onExpand: (() => void) | null;
  onRestart: () => void;
  onStartNew: (() => void) | null;
  onClose: () => void;
}

function TerminalToolbar({
  title,
  onExpand,
  onRestart,
  onStartNew,
  onClose,
}: TerminalToolbarProps) {
  const { tokens } = useTheme();
  return (
    <View className="flex-row items-center gap-1 border-b border-border-hairline bg-sidebar px-2 py-1.5">
      <Pressable
        accessibilityRole={onExpand ? "button" : undefined}
        accessibilityLabel={onExpand ? "Open terminal full screen" : undefined}
        disabled={onExpand === null}
        onPress={onExpand ?? undefined}
        className="min-w-0 flex-1 flex-row items-center gap-1.5 rounded-md px-1 py-1 active:bg-state-hover"
        testID="panel-terminal-title"
      >
        <Icon name="Terminal" size={14} color={tokens.mutedForeground} />
        <Text variant="label" numberOfLines={1} className="min-w-0 flex-1">
          {title}
        </Text>
        {onExpand ? (
          <Icon name="Maximize2" size={14} color={tokens.mutedForeground} />
        ) : null}
      </Pressable>
      <ToolbarButton
        icon="RotateCcw"
        label="Restart terminal"
        onPress={onRestart}
        testID="panel-terminal-restart"
      />
      {onStartNew ? (
        <ToolbarButton
          icon="Plus"
          label="New terminal"
          onPress={onStartNew}
          testID="panel-terminal-new"
        />
      ) : null}
      <ToolbarButton
        icon="X"
        label="Close terminal"
        onPress={onClose}
        testID="panel-terminal-close"
      />
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: "RotateCcw" | "Plus" | "X";
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      className="h-8 w-8 items-center justify-center rounded-md active:bg-state-hover"
      testID={testID}
    >
      <Icon name={icon} size={16} color={tokens.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
