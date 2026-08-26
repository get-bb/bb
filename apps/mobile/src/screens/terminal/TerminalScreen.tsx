import type { TerminalSession } from "@bb/server-contract";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import {
  useCloseTerminal,
  useCreateTerminal,
  useRenameTerminal,
  useRestartTerminal,
  useTerminalSession,
} from "@/data/terminals";
import { useTheme } from "@/theme";
import { useProfiles } from "@/app-shell/ProfilesProvider";
import {
  confirmDestructive,
  Icon,
  KeyboardPaddingView,
  ListRow,
  Separator,
  sfSymbolFor,
  Sheet,
  Text,
  toast,
  useSheet,
  type NativeMenuAction,
  type SheetController,
} from "@/ui";
import { ConnectionBanner } from "../shell/ConnectionBanner";
import { threadTerminalHref } from "../shell/hrefs";
import { ScreenTitle } from "../shell/ScreenTitle";
import { SheetNameForm } from "../sidebar/SheetNameForm";
import { TerminalTabContent } from "./TerminalTabContent";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * `/threads/[id]/terminal/[terminalId]`: one terminal full screen (any
 * orientation). Header: the session title and a "…" menu with rename /
 * restart / new terminal / close — a native toolbar menu on iOS (rename
 * through the system prompt, close through the destructive confirmation),
 * a sheet with the same rows on Android.
 */
export function TerminalScreen() {
  // The route can be restored before a profile is active (cold start on the
  // last route, profile switch): the hooks below need a connection.
  const { connection } = useProfiles();
  const { id: threadId, terminalId } = useLocalSearchParams<{
    id: string;
    terminalId: string;
  }>();
  if (!terminalId || !connection) {
    return (
      <>
        <Stack.Screen options={{ title: "Terminal" }} />
        <View
          className="flex-1 justify-center bg-background p-6"
          testID="terminal-screen"
        >
          <Text variant="footnote" tone="muted" className="text-center">
            No active server.
          </Text>
        </View>
      </>
    );
  }
  return (
    <ConnectedTerminalScreen threadId={threadId} terminalId={terminalId} />
  );
}

interface ConnectedTerminalScreenProps {
  threadId: string | undefined;
  terminalId: string;
}

function ConnectedTerminalScreen({
  threadId,
  terminalId,
}: ConnectedTerminalScreenProps) {
  const router = useRouter();
  const { tokens } = useTheme();
  const sessionQuery = useTerminalSession(terminalId);
  const session = sessionQuery.data;
  const restartTerminal = useRestartTerminal();
  const closeTerminal = useCloseTerminal();
  const createTerminal = useCreateTerminal();
  const renameTerminal = useRenameTerminal();
  // Android: one sheet with two views (menu / rename) — presenting a second
  // modal while the first dismisses leaves an empty backdrop. iOS never
  // mounts it (native menu + system prompt).
  const sheet = useSheet();
  const [sheetView, setSheetView] = useState<"menu" | "rename" | null>(null);
  const openMenu = useCallback(() => {
    // The WebView owns the keyboard while the terminal is focused; a sheet
    // presented under it lands off screen. Blur first (`visible={false}`
    // below), then present.
    setSheetView("menu");
    sheet.present();
  }, [sheet]);
  const sheetOpen = sheetView !== null;

  const replaceWith = useCallback(
    (nextTerminalId: string) => {
      if (!threadId) return;
      router.replace(threadTerminalHref(threadId, nextTerminalId));
    },
    [router, threadId],
  );
  const handleRestart = useCallback(() => {
    if (!terminalId || restartTerminal.isPending) return;
    restartTerminal.mutate(
      { terminalId },
      { onSuccess: (next) => replaceWith(next.id) },
    );
  }, [replaceWith, restartTerminal, terminalId]);
  const handleStartNew = useCallback(() => {
    if (!threadId || createTerminal.isPending) return;
    createTerminal.mutate(
      { scope: { kind: "thread", threadId } },
      { onSuccess: (next) => replaceWith(next.id) },
    );
  }, [createTerminal, replaceWith, threadId]);
  const handleClose = useCallback(() => {
    if (!terminalId || closeTerminal.isPending) return;
    closeTerminal.mutate(
      { terminalId, mode: "force" },
      {
        onSuccess: () => {
          toast.success("Terminal closed");
          if (router.canGoBack()) router.back();
        },
      },
    );
  }, [closeTerminal, router, terminalId]);
  const rename = useCallback(
    (title: string) => {
      if (!session) return;
      renameTerminal.mutate({ terminalId: session.id, title });
    },
    [renameTerminal, session],
  );
  const promptRename = useCallback(() => {
    if (!session) return;
    if (process.env.EXPO_OS === "ios") {
      // The system text-field alert, prefilled with the current title.
      Alert.prompt(
        "Rename terminal",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Rename",
            onPress: (title?: string) => {
              const next = title?.trim() ?? "";
              if (next.length > 0 && next !== session.title) rename(next);
            },
          },
        ],
        "plain-text",
        session.title,
      );
      return;
    }
    setSheetView("rename");
  }, [rename, session]);

  const running = session?.status === "running";
  const confirmClose = useCallback(() => {
    confirmDestructive({
      title: running ? "Close this terminal?" : "Remove this terminal?",
      message: running
        ? "The shell and anything running in it will be killed."
        : undefined,
      actionLabel: running ? "Close" : "Remove",
      onConfirm: handleClose,
    });
  }, [handleClose, running]);

  const actions: NativeMenuAction[] = [
    {
      key: "rename",
      label: "Rename",
      icon: "Edit",
      disabled: !session,
      onPress: promptRename,
    },
    {
      key: "restart",
      label: "Restart terminal",
      icon: "RotateCcw",
      disabled: !session || restartTerminal.isPending,
      onPress: () => {
        sheet.dismiss();
        handleRestart();
      },
    },
    {
      key: "new",
      label: "New terminal",
      icon: "Plus",
      disabled: !threadId || createTerminal.isPending,
      onPress: () => {
        sheet.dismiss();
        handleStartNew();
      },
    },
    {
      key: "close",
      label: running ? "Close terminal" : "Remove terminal",
      icon: "X",
      destructive: true,
      disabled: !session || closeTerminal.isPending,
      onPress: () => {
        sheet.dismiss();
        confirmClose();
      },
    },
  ];

  return (
    <>
      <Stack.Screen
        options={
          IS_IOS
            ? {
                orientation: "all",
                // Nothing scrolls under the bar (the xterm canvas fills the
                // screen), so it stays opaque in the canvas color.
                headerTransparent: false,
                headerStyle: { backgroundColor: tokens.surfaceRaisedSolid },
              }
            : {
                orientation: "all",
                headerRight: () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Terminal actions"
                    hitSlop={8}
                    onPress={openMenu}
                    testID="terminal-actions-button"
                  >
                    <Icon
                      name="MoreHorizontal"
                      size={22}
                      color={tokens.foreground}
                    />
                  </Pressable>
                ),
              }
        }
      />
      <ScreenTitle>{session?.title ?? "Terminal"}</ScreenTitle>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu
            icon="ellipsis.circle"
            accessibilityLabel="Terminal actions"
          >
            {actions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.key}
                icon={action.icon ? sfSymbolFor(action.icon) : undefined}
                destructive={action.destructive}
                disabled={action.disabled}
                onPress={action.onPress}
              >
                {action.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <View
        style={{ flex: 1, backgroundColor: tokens.surfaceRaisedSolid }}
        testID="terminal-screen"
      >
        <ConnectionBanner inset />
        <KeyboardPaddingView style={{ flex: 1 }}>
          <TerminalTabContent
            terminalId={terminalId}
            autoFocus
            onRestart={handleRestart}
            onStartNew={threadId ? handleStartNew : undefined}
            restartPending={restartTerminal.isPending}
            onMenu={IS_IOS ? undefined : openMenu}
            menuActions={IS_IOS ? actions : undefined}
            visible={!sheetOpen}
          />
        </KeyboardPaddingView>
      </View>
      {IS_IOS ? null : (
        <Sheet
          controller={sheet}
          deferContent={false}
          onOpenChange={(open) => {
            if (!open) setSheetView(null);
          }}
        >
          <TerminalActionsSheetBody
            view={sheetView}
            session={session ?? null}
            actions={actions}
            renamePending={renameTerminal.isPending}
            onRename={(title) => {
              if (!session) return;
              renameTerminal.mutate(
                { terminalId: session.id, title },
                { onSettled: () => sheet.dismiss() },
              );
            }}
            sheet={sheet}
          />
        </Sheet>
      )}
    </>
  );
}

interface TerminalActionsSheetBodyProps {
  view: "menu" | "rename" | null;
  session: TerminalSession | null;
  actions: readonly NativeMenuAction[];
  renamePending: boolean;
  onRename: (title: string) => void;
  sheet: SheetController;
}

/** Android: the "…" sheet's rows, or the rename form once Rename was picked. */
function TerminalActionsSheetBody({
  view,
  session,
  actions,
  renamePending,
  onRename,
  sheet,
}: TerminalActionsSheetBodyProps) {
  if (view === "rename" && session) {
    return (
      <SheetNameForm
        title="Rename terminal"
        initialValue={session.title}
        submitLabel="Rename"
        pending={renamePending}
        autoCapitalize="none"
        onSubmit={onRename}
        onCancel={() => sheet.dismiss()}
        testID="terminal-rename"
      />
    );
  }
  if (view !== "menu") return null;
  return (
    <View className="pb-2">
      <View className="px-4 pb-3 pt-1">
        <Text variant="heading" numberOfLines={1}>
          {session?.title ?? "Terminal"}
        </Text>
      </View>
      <Separator />
      {actions.map((action) => (
        <ListRow
          key={action.key}
          title={action.label}
          leading={action.icon}
          destructive={action.destructive}
          disabled={action.disabled}
          onPress={action.onPress}
          testID={`terminal-action-${action.key}`}
        />
      ))}
    </View>
  );
}
