import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { LAUNCHER_ACTION_ROW_BASE_CLASS } from "@/components/secondary-panel/launcherRow";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
  useAppCommandRunner,
  useAppCommandShortcuts,
  useIndexedAppCommandHandlers,
} from "./AppCommandProvider";
import { AppCommandShortcutPill } from "./AppCommandShortcutHint";
import {
  PALETTE_ACTION_BUCKETS,
  type PaletteAction,
} from "@/lib/command-palette/palette-action";
import {
  buildAppCommandActions,
  PALETTE_COMMAND_IDS,
  paletteActionIdForCommand,
} from "@/lib/command-palette/palette-app-commands";
import {
  rankPaletteActions,
  type RankedPaletteAction,
} from "@/lib/command-palette/palette-ranking";
import {
  readPaletteRecents,
  recordPaletteRecent,
} from "@/lib/command-palette/palette-recents";
import { buildPluginPaletteActions } from "@/lib/command-palette/palette-plugin-actions";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import { buildSettingsPaletteActions } from "@/lib/command-palette/palette-settings-actions";
import { buildPluginPagePaletteActions } from "@/lib/command-palette/palette-plugin-page-actions";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import {
  buildPluginSettingsEntries,
  type PluginSettingsCandidate,
} from "@/components/settings/plugin-settings-entries";
import { useSettingsNavSections } from "@/components/settings/settings-nav";
import { appQueryClient } from "@/lib/app-query-client";
import {
  PALETTE_MODE_ENTRY_COMMANDS,
  PALETTE_MODES,
} from "@/lib/command-palette/palette-modes";
import { PaletteShell } from "./PaletteShell";

const PALETTE_PLACEHOLDER = "Search commands";
const MODE_ENTRY_HANDLER_PRIORITY = 100;
const MODE_BY_ACTION_ID = new Map(
  PALETTE_MODES.map((mode) => [
    paletteActionIdForCommand(mode.entryCommand),
    mode,
  ]),
);

export interface CommandPaletteProps {
  threadId: string | null;
  projectId: string | null;
  onSplit?: () => void;
}

export function CommandPalette({
  threadId,
  projectId,
  onSplit,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const runner = useAppCommandRunner();
  const shortcuts = useAppCommandShortcuts(PALETTE_COMMAND_IDS);
  const paletteShortcut = useAppCommandShortcut("palette.open");
  const listId = useId();
  const optionIdPrefix = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<readonly PaletteAction[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeModeId, setActiveModeId] = useState<string | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<
    readonly PluginSettingsCandidate[]
  >([]);
  const [recents, setRecents] = useState<readonly string[]>(() =>
    readPaletteRecents(),
  );
  const pluginSlots = usePluginSlots();
  const settingsSections = useSettingsNavSections(pluginSlots.fileOpeners);
  const pluginSettingsEntries = useMemo(
    () =>
      buildPluginSettingsEntries({
        installedPlugins,
        settingsSections: pluginSlots.settingsSections,
      }).all,
    [installedPlugins, pluginSlots.settingsSections],
  );
  const settingsActions = useMemo(
    () =>
      buildSettingsPaletteActions({
        navigate: (path) => void navigate(path),
        pluginEntries: pluginSettingsEntries,
        sections: settingsSections,
      }),
    [navigate, pluginSettingsEntries, settingsSections],
  );
  const pluginPageActions = useMemo(
    () =>
      buildPluginPagePaletteActions({
        navigate: (path) => void navigate(path),
        panels: pluginSlots.navPanels,
      }),
    [navigate, pluginSlots.navPanels],
  );
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
      ...(onSplit === undefined
        ? []
        : [
            {
              id: "internal:thread.split",
              bucket: "Actions",
              group: "Window and layout",
              title: "Split",
              shortcut: null,
              run: onSplit,
            } satisfies PaletteAction,
          ]),
      ...buildPluginPaletteActions({
        slots: pluginSlots.commandPaletteActions,
        threadId,
        projectId,
        openThreadPanel: getActiveThreadPanelOpener(),
      }),
    ],
    [
      projectId,
      runner.dispatch,
      runner.isCommandAvailable,
      shortcuts,
      threadId,
      onSplit,
      pluginSlots.commandPaletteActions,
    ],
  );

  const loadInstalledPlugins = useCallback(() => {
    void appQueryClient
      .fetchQuery(pluginListQueryOptions({ enabled: true }))
      .then(setInstalledPlugins, () => {});
  }, []);

  const prepareOpen = useCallback(
    (target: EventTarget | null) => {
      openTargetRef.current = target;
      setActions(buildActions(target));
      setQuery("");
      setHighlightedIndex(0);
      loadInstalledPlugins();
    },
    [buildActions, loadInstalledPlugins],
  );

  useAppCommandHandler("palette.open", (invocation) => {
    const target =
      invocation.target ??
      (typeof document === "undefined" ? null : document.activeElement);
    prepareOpen(target);
    setActiveModeId(null);
    setOpen(true);
    return true;
  });

  useIndexedAppCommandHandlers(
    PALETTE_MODE_ENTRY_COMMANDS,
    (index, invocation) => {
      const mode = PALETTE_MODES[index];
      if (mode === undefined) return false;
      const target =
        invocation.target ??
        (typeof document === "undefined" ? null : document.activeElement);
      prepareOpen(target);
      setActiveModeId(mode.id);
      setOpen(true);
      return true;
    },
    MODE_ENTRY_HANDLER_PRIORITY,
  );

  const availableActions = useMemo(
    () => [...actions, ...settingsActions, ...pluginPageActions],
    [actions, pluginPageActions, settingsActions],
  );
  const commandQuery = query.startsWith(">") ? query.slice(1) : query;
  const ranked = useMemo(
    () =>
      rankPaletteActions({
        actions: availableActions,
        query: commandQuery,
        recentIds: recents,
      }),
    [availableActions, commandQuery, recents],
  );
  const isGroupedRoot = commandQuery.trim() === "";
  const rootGroups = useMemo(() => {
    const groups = PALETTE_ACTION_BUCKETS.map((bucket) => ({
      bucket,
      entries: ranked.filter((entry) => entry.action.bucket === bucket),
    }));
    return groups.map((group, index) => ({
      ...group,
      startIndex: groups
        .slice(0, index)
        .reduce((total, prior) => total + prior.entries.length, 0),
    }));
  }, [ranked]);
  const visibleEntries = useMemo(
    () =>
      isGroupedRoot ? rootGroups.flatMap((group) => group.entries) : ranked,
    [isGroupedRoot, ranked, rootGroups],
  );
  const activeIndex =
    visibleEntries.length === 0
      ? -1
      : Math.min(highlightedIndex, visibleEntries.length - 1);

  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollOnNextHighlightRef = useRef(false);
  useEffect(() => {
    if (!scrollOnNextHighlightRef.current) return;
    scrollOnNextHighlightRef.current = false;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const chooseAction = useCallback((action: PaletteAction) => {
    setRecents((current) => recordPaletteRecent(current, action.id));
    if (MODE_BY_ACTION_ID.has(action.id)) {
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

  const handleCloseAutoFocus = useCallback((event: Event) => {
    const pending = pendingRunRef.current;
    pendingRunRef.current = null;
    const target = openTargetRef.current;
    if (target instanceof HTMLElement && target.isConnected) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
    pending?.();
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setActiveModeId(null);
      setQuery("");
      setHighlightedIndex(0);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (visibleEntries.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current + 1 >= visibleEntries.length ? 0 : current + 1,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current <= 0 ? visibleEntries.length - 1 : current - 1,
        );
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex(visibleEntries.length - 1);
        return;
      }
      if (event.key === "Enter") {
        const choice = visibleEntries[activeIndex];
        if (choice === undefined) return;
        event.preventDefault();
        chooseAction(choice.action);
      }
    },
    [activeIndex, chooseAction, visibleEntries],
  );
  const activeMode =
    activeModeId === null
      ? undefined
      : PALETTE_MODES.find((mode) => mode.id === activeModeId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0"
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (activeMode !== undefined) event.preventDefault();
        }}
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Quick palette</DialogTitle>
        {activeMode === undefined ? (
          <PaletteShell
            activeDescendantId={
              activeIndex === -1
                ? undefined
                : `${optionIdPrefix}-${activeIndex}`
            }
            accessory={
              paletteShortcut === null ? null : (
                <AppCommandShortcutPill shortcut={paletteShortcut} />
              )
            }
            inputLabel={PALETTE_PLACEHOLDER}
            listId={listId}
            listLabel="Commands"
            listRef={listRef}
            onInputChange={(value) => {
              setQuery(value);
              setHighlightedIndex(0);
              if (listRef.current !== null) listRef.current.scrollTop = 0;
            }}
            onInputKeyDown={handleKeyDown}
            placeholder={PALETTE_PLACEHOLDER}
            value={query}
          >
            {!isGroupedRoot && visibleEntries.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No matching commands
              </p>
            ) : isGroupedRoot ? (
              rootGroups.map((group, groupIndex) => {
                const labelId = `${optionIdPrefix}-${group.bucket.toLowerCase()}-label`;
                return (
                  <div
                    key={group.bucket}
                    role="group"
                    aria-labelledby={labelId}
                    data-palette-bucket={group.bucket}
                  >
                    <div
                      id={labelId}
                      className={cn(
                        CHROME_SECTION_LABEL_CLASS,
                        "px-2 pb-1",
                        groupIndex === 0 ? "pt-1" : "pt-2",
                      )}
                    >
                      {group.bucket}
                    </div>
                    {group.entries.map((entry, index) => {
                      const visibleIndex = group.startIndex + index;
                      return (
                        <PaletteRow
                          key={entry.action.id}
                          entry={entry}
                          id={`${optionIdPrefix}-${visibleIndex}`}
                          isActive={visibleIndex === activeIndex}
                          onActivate={() => setHighlightedIndex(visibleIndex)}
                          onSelect={() => chooseAction(entry.action)}
                        />
                      );
                    })}
                  </div>
                );
              })
            ) : (
              visibleEntries.map((entry, index) => (
                <PaletteRow
                  key={entry.action.id}
                  entry={entry}
                  id={`${optionIdPrefix}-${index}`}
                  isActive={index === activeIndex}
                  onActivate={() => setHighlightedIndex(index)}
                  onSelect={() => chooseAction(entry.action)}
                />
              ))
            )}
          </PaletteShell>
        ) : (
          <activeMode.View
            presentation={activeMode}
            onExit={() => {
              setActiveModeId(null);
              setQuery("");
              setHighlightedIndex(0);
            }}
            runAfterClose={runAfterClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaletteRow({
  entry,
  id,
  isActive,
  onActivate,
  onSelect,
}: {
  entry: RankedPaletteAction;
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
}) {
  const metadataGroup =
    entry.action.group === entry.action.bucket ? null : entry.action.group;
  const hasTrailing = metadataGroup !== null || entry.action.shortcut !== null;
  return (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      className={cn(
        LAUNCHER_ACTION_ROW_BASE_CLASS,
        "cursor-pointer",
        isActive && "bg-state-hover text-foreground",
      )}
      onPointerMove={onActivate}
      onClick={onSelect}
    >
      <span className="min-w-0 truncate">
        <HighlightedTitle
          title={entry.action.title}
          positions={entry.positions}
        />
      </span>
      {hasTrailing ? (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {metadataGroup === null ? null : (
            <span
              className={cn(
                "text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              {metadataGroup}
            </span>
          )}
          {entry.action.shortcut === null ? null : (
            <AppCommandShortcutPill shortcut={entry.action.shortcut} />
          )}
        </span>
      ) : null}
    </div>
  );
}

function HighlightedTitle({
  title,
  positions,
}: {
  title: string;
  positions: readonly number[];
}) {
  if (positions.length === 0) return <>{title}</>;
  const emphasized = new Set(positions);
  return (
    <>
      {[...title].map((character, index) =>
        emphasized.has(index) ? (
          <span key={index} className="font-semibold text-foreground">
            {character}
          </span>
        ) : (
          <span key={index}>{character}</span>
        ),
      )}
    </>
  );
}
