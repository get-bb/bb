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
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { LAUNCHER_ACTION_ROW_BASE_CLASS } from "@/components/secondary-panel/launcherRow";
import {
  useAppCommandHandler,
  useAppCommandRunner,
  useAppCommandShortcuts,
} from "./AppCommandProvider";
import { AppCommandShortcutPill } from "./AppCommandShortcutHint";
import type { PaletteAction } from "@/lib/command-palette/palette-action";
import {
  buildAppCommandActions,
  PALETTE_COMMAND_IDS,
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
import { getPluginSlotSnapshot } from "@/lib/plugin-slots";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  ThreadPaletteResults,
  type ThreadPaletteNavigationItem,
} from "./ThreadPaletteResults";

type PaletteMode = "commands" | "threads";

export interface CommandPaletteProps {
  threadId: string | null;
  projectId: string | null;
}

export function CommandPalette({ threadId, projectId }: CommandPaletteProps) {
  const navigate = useNavigate();
  const runner = useAppCommandRunner();
  const shortcuts = useAppCommandShortcuts(PALETTE_COMMAND_IDS);
  const listId = useId();
  const optionIdPrefix = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<readonly PaletteAction[]>([]);
  const [threadItems, setThreadItems] = useState<
    readonly ThreadPaletteNavigationItem[]
  >([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [recents, setRecents] = useState<readonly string[]>(() =>
    readPaletteRecents(),
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
      ...buildPluginPaletteActions({
        slots: getPluginSlotSnapshot().commandPaletteActions,
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
    ],
  );

  const openPalette = useCallback(
    (mode: PaletteMode, target: EventTarget | null) => {
      openTargetRef.current = target;
      setActions(buildActions(target));
      setThreadItems([]);
      setQuery(mode === "commands" ? ">" : "");
      setHighlightedIndex(0);
      setOpen(true);
    },
    [buildActions],
  );

  useAppCommandHandler("palette.open", (invocation) => {
    const target =
      invocation.target ??
      (typeof document === "undefined" ? null : document.activeElement);
    openPalette("commands", target);
    return true;
  });

  useAppCommandHandler("thread.search", (invocation) => {
    const target =
      invocation.target ??
      (typeof document === "undefined" ? null : document.activeElement);
    openPalette("threads", target);
    return true;
  });

  const mode: PaletteMode = query.startsWith(">") ? "commands" : "threads";
  const modeQuery = mode === "commands" ? query.slice(1) : query;
  const rankedCommands = useMemo(
    () => rankPaletteActions({ actions, query: modeQuery, recentIds: recents }),
    [actions, modeQuery, recents],
  );
  const resultCount =
    mode === "commands" ? rankedCommands.length : threadItems.length;
  const activeIndex =
    resultCount === 0 ? -1 : Math.min(highlightedIndex, resultCount - 1);

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
    if (action.id === "app:thread.search") {
      setQuery("");
      setHighlightedIndex(0);
      if (listRef.current !== null) listRef.current.scrollTop = 0;
      return;
    }
    pendingRunRef.current = action.run;
    setRecents((current) => recordPaletteRecent(current, action.id));
    setOpen(false);
  }, []);

  const chooseThread = useCallback(
    (item: ThreadPaletteNavigationItem) => {
      pendingRunRef.current = () => {
        void navigate(
          getThreadRoutePath({
            projectId: item.projectId,
            threadId: item.threadId,
          }),
          item.messageSeq === null
            ? undefined
            : {
                state: {
                  searchMessageSeq: item.messageSeq,
                  searchThreadId: item.threadId,
                },
              },
        );
      };
      setOpen(false);
    },
    [navigate],
  );

  const handleAfterCloseAutoFocus = useCallback(() => {
    const pending = pendingRunRef.current;
    pendingRunRef.current = null;
    const target = openTargetRef.current;
    if (target instanceof HTMLElement && target.isConnected) {
      target.focus({ preventScroll: true });
    }
    pending?.();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (resultCount === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current + 1 >= resultCount ? 0 : current + 1,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current <= 0 ? resultCount - 1 : current - 1,
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
        setHighlightedIndex(resultCount - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (mode === "commands") {
          const choice = rankedCommands[activeIndex];
          if (choice !== undefined) chooseAction(choice.action);
          return;
        }
        const choice = threadItems[activeIndex];
        if (choice !== undefined) chooseThread(choice);
      }
    },
    [
      activeIndex,
      chooseAction,
      chooseThread,
      mode,
      rankedCommands,
      resultCount,
      threadItems,
    ],
  );

  const activeDescendant =
    activeIndex === -1
      ? undefined
      : mode === "commands"
        ? `${optionIdPrefix}-${activeIndex}`
        : threadItems[activeIndex]?.optionId;
  const inputLabel = mode === "commands" ? "Search commands" : "Search threads";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0"
        onAfterCloseAutoFocus={handleAfterCloseAutoFocus}
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">
          {mode === "commands" ? "Quick palette" : "Search threads"}
        </DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Icon
            name="Search"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeDescendant}
            aria-label={inputLabel}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={inputLabel}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (!nextQuery.startsWith(">")) setThreadItems([]);
              setHighlightedIndex(0);
              if (listRef.current !== null) listRef.current.scrollTop = 0;
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={
            mode === "commands" ? "Commands" : "Thread search results"
          }
          className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1"
        >
          {mode === "commands" && rankedCommands.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matching commands
            </p>
          ) : mode === "commands" ? (
            rankedCommands.map((entry, index) => (
              <PaletteRow
                key={entry.action.id}
                entry={entry}
                id={`${optionIdPrefix}-${index}`}
                isActive={index === activeIndex}
                onActivate={() => setHighlightedIndex(index)}
                onSelect={() => chooseAction(entry.action)}
              />
            ))
          ) : (
            <ThreadPaletteResults
              activeIndex={activeIndex}
              onActiveIndexChange={setHighlightedIndex}
              onNavigationItemsChange={setThreadItems}
              onSelect={chooseThread}
              optionIdPrefix={optionIdPrefix}
              query={modeQuery}
            />
          )}
        </div>
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
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span
          className={cn("text-muted-foreground", COARSE_POINTER_TEXT_SM_CLASS)}
        >
          {entry.action.group}
        </span>
        {entry.action.shortcut === null ? null : (
          <AppCommandShortcutPill shortcut={entry.action.shortcut} />
        )}
      </span>
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
