import { useSplitPreload } from "@/lib/define-split";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  pluginCommandId,
  pluginCommandIdSchema,
  type KeyboardCommandId,
} from "@bb/domain";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import {
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
  useAppCommandRunner,
  useAppCommandShortcuts,
} from "./AppCommandProvider";
import type { PaletteAction } from "@/lib/command-palette/palette-action";
import {
  buildAppCommandActions,
  PALETTE_COMMAND_IDS,
  paletteActionIdForCommand,
} from "@/lib/command-palette/palette-app-commands";
import {
  readPaletteRecents,
  recordPaletteRecent,
} from "@/lib/command-palette/palette-recents";
import {
  buildPluginComposerCommandActions,
  buildPluginPaletteActions,
} from "@/lib/command-palette/palette-plugin-actions";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import type { PluginSettingsCandidate } from "@/components/settings/plugin-settings-entries";
import { appQueryClient } from "@/lib/app-query-client";
import { LazyCommandPaletteBody } from "./LazyCommandPaletteBody";

const ThreadSearchPaletteMode = lazy(() =>
  import("./ThreadSearchPaletteMode").then((module) => ({
    default: module.ThreadSearchPaletteMode,
  })),
);

const THREAD_SEARCH_ACTION_ID = paletteActionIdForCommand("thread.search");

function invocationTarget(invocation: {
  target: EventTarget | null;
}): EventTarget | null {
  return (
    invocation.target ??
    (typeof document === "undefined" ? null : document.activeElement)
  );
}

export interface CommandPaletteProps {
  threadId: string | null;
  projectId: string | null;
}

export function CommandPalette({ threadId, projectId }: CommandPaletteProps) {
  useSplitPreload(LazyCommandPaletteBody);
  const runner = useAppCommandRunner();
  const shortcuts = useAppCommandShortcuts(PALETTE_COMMAND_IDS);

  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<readonly PaletteAction[]>([]);
  const [searchingThreads, setSearchingThreads] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<
    readonly PluginSettingsCandidate[]
  >([]);
  const [recents, setRecents] = useState<readonly string[]>(() =>
    readPaletteRecents(),
  );
  const pluginSlots = usePluginSlots();
  const pluginCommandIds = useMemo(
    () =>
      pluginSlots.commandPaletteActions.map((command) =>
        pluginCommandId(command.pluginId, command.id),
      ),
    [pluginSlots.commandPaletteActions],
  );
  const pluginShortcuts = useAppCommandShortcuts(pluginCommandIds);
  const appPluginCommands = useMemo(
    () =>
      pluginSlots.commandPaletteActions.filter(
        (command) => command.target === "app",
      ),
    [pluginSlots.commandPaletteActions],
  );
  const composerPluginCommands = useMemo(
    () =>
      pluginSlots.commandPaletteActions.filter(
        (command) => command.target === "composer",
      ),
    [pluginSlots.commandPaletteActions],
  );
  const appPluginCommandIds = useMemo(
    () =>
      appPluginCommands.map((command) =>
        pluginCommandId(command.pluginId, command.id),
      ),
    [appPluginCommands],
  );
  useIndexedAppCommandHandlers(appPluginCommandIds, (index) => {
    const slot = appPluginCommands[index];
    if (!slot) return false;
    const action = buildPluginPaletteActions({
      slots: [slot],
      threadId,
      projectId,
      openThreadPanel: getActiveThreadPanelOpener(),
    })[0];
    if (!action) return false;
    action.run();
    return true;
  });
  const openTargetRef = useRef<EventTarget | null>(null);
  const pendingRunRef = useRef<(() => void) | null>(null);

  const buildActions = useCallback(
    (target: EventTarget | null) => [
      ...buildAppCommandActions({
        target,
        isCommandAvailable: runner.isCommandAvailable,
        dispatch: runner.dispatch,
        shortcuts,
      }),
      ...[
        ...buildPluginPaletteActions({
          slots: appPluginCommands,
          threadId,
          projectId,
          openThreadPanel: getActiveThreadPanelOpener(),
        }),
        ...buildPluginComposerCommandActions({
          slots: composerPluginCommands,
          target,
          isCommandAvailable: runner.isCommandAvailable,
          dispatch: runner.dispatch,
        }),
      ].map((action) => ({
        ...action,
        shortcut:
          pluginShortcuts.get(pluginCommandIdSchema.parse(action.id)) ?? null,
      })),
    ],
    [
      appPluginCommands,
      composerPluginCommands,
      projectId,
      pluginShortcuts,
      runner.dispatch,
      runner.isCommandAvailable,
      shortcuts,
      threadId,
    ],
  );

  const prepareOpen = useCallback(
    (target: EventTarget | null) => {
      if (!open) openTargetRef.current = target;
      setActions(buildActions(openTargetRef.current));
      setQuery("");
      setOpenCount((count) => count + 1);
      void appQueryClient
        .fetchQuery(pluginListQueryOptions({ enabled: true }))
        .then(setInstalledPlugins, () => {});
    },
    [buildActions, open],
  );

  useAppCommandHandler("palette.open", (invocation) => {
    const target = invocationTarget(invocation);
    prepareOpen(target);
    setSearchingThreads(false);
    setOpen(true);
    return true;
  });

  useAppCommandHandler(
    "thread.search",
    (invocation) => {
      const target = invocationTarget(invocation);
      prepareOpen(target);
      setSearchingThreads(true);
      setOpen(true);
      return true;
    },
    100,
  );

  const shortcutActions = useMemo(() => {
    const byId = new Map(actions.map((action) => [action.id, action]));
    const byCommand = new Map<KeyboardCommandId, PaletteAction>();
    for (const command of PALETTE_COMMAND_IDS) {
      const action = byId.get(paletteActionIdForCommand(command));
      if (action) byCommand.set(command, action);
    }
    for (const command of pluginCommandIds) {
      const action = byId.get(command);
      if (action) byCommand.set(command, action);
    }
    return byCommand;
  }, [actions, pluginCommandIds]);

  const chooseAction = useCallback((action: PaletteAction) => {
    setRecents((current) => recordPaletteRecent(current, action.id));
    if (action.id === THREAD_SEARCH_ACTION_ID) {
      action.run();
      return;
    }
    pendingRunRef.current = action.run;
    setOpen(false);
  }, []);

  const runAfterClose = useCallback((run: () => void) => {
    pendingRunRef.current = run;
    setOpen(false);
  }, []);

  const handleAfterCloseAutoFocus = useCallback(() => {
    const pending = pendingRunRef.current;
    pendingRunRef.current = null;
    const target = openTargetRef.current;
    if (target instanceof HTMLElement && target.isConnected) {
      target.focus({ preventScroll: true });
    }
    pending?.();
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchingThreads(false);
      setQuery("");
    }
  }, []);

  const exitMode = () => {
    setSearchingThreads(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="top-[12%] max-w-[640px] translate-y-0 gap-0 p-0 shadow-lg sm:rounded-xl"
        onAfterCloseAutoFocus={handleAfterCloseAutoFocus}
        onKeyDownCapture={(event) => {
          if (
            !open ||
            !(event.target instanceof Node) ||
            !event.currentTarget.contains(event.target)
          ) {
            return;
          }
          const command = runner.getShortcutCommand(event.nativeEvent, [
            "palette.open",
            ...shortcutActions.keys(),
          ]);
          if (command === null) return;
          event.preventDefault();
          event.stopPropagation();
          if (command === "palette.open") {
            runner.dispatch(command, openTargetRef.current);
            return;
          }
          const action = shortcutActions.get(command);
          if (action) chooseAction(action);
        }}
        onEscapeKeyDown={(event) => {
          if (searchingThreads) {
            event.preventDefault();
            exitMode();
          }
        }}
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Quick palette</DialogTitle>
        {!searchingThreads ? (
          <LazyCommandPaletteBody
            key={openCount}
            actions={actions}
            installedPlugins={installedPlugins}
            recents={recents}
            query={query}
            onQueryChange={setQuery}
            onChoose={chooseAction}
          />
        ) : (
          <Suspense
            fallback={
              <p
                role="status"
                className="px-3 py-4 text-sm text-muted-foreground"
              >
                Loading threads
              </p>
            }
          >
            <ThreadSearchPaletteMode
              onExit={exitMode}
              runAfterClose={runAfterClose}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
