import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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

const PALETTE_PLACEHOLDER = "Search commands";

export interface CommandPaletteProps {
  /** The surface's thread and project, handed to plugin rows. */
  threadId: string | null;
  projectId: string | null;
}

/**
 * Type to filter the commands that apply right now, then run one with Enter.
 * Mounted once by `AppLayout` and opened by `palette.open`.
 */
export function CommandPalette({ threadId, projectId }: CommandPaletteProps) {
  const runner = useAppCommandRunner();
  const shortcuts = useAppCommandShortcuts(PALETTE_COMMAND_IDS);
  const listId = useId();
  const optionIdPrefix = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<readonly PaletteAction[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [recents, setRecents] = useState<readonly string[]>(() =>
    readPaletteRecents(),
  );
  // Where availability, dispatch, and focus-on-close all point.
  const openTargetRef = useRef<EventTarget | null>(null);
  // Set when a row is chosen, read once focus has been restored.
  const pendingActionRef = useRef<PaletteAction | null>(null);

  useAppCommandHandler("palette.open", (invocation) => {
    const target =
      invocation.target ??
      (typeof document === "undefined" ? null : document.activeElement);
    openTargetRef.current = target;
    setActions([
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
    ]);
    setQuery("");
    setHighlightedIndex(0);
    setOpen(true);
    return true;
  });

  const ranked = useMemo(
    () => rankPaletteActions({ actions, query, recentIds: recents }),
    [actions, query, recents],
  );
  // Typing can shrink the list under the selection.
  const activeIndex =
    ranked.length === 0 ? -1 : Math.min(highlightedIndex, ranked.length - 1);

  /**
   * Focus stays in the search field, so nothing scrolls the highlighted row
   * into view on its own. Keyboard moves only: scrolling on hover would yank
   * the list out from under the pointer.
   */
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
    pendingActionRef.current = action;
    setRecents((current) => recordPaletteRecent(current, action.id));
    setOpen(false);
  }, []);

  /**
   * Restore focus before running, so a command that focuses something does not
   * have it taken back by the dialog's own restoration a tick later.
   */
  const handleCloseAutoFocus = useCallback((event: Event) => {
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    const target = openTargetRef.current;
    if (target instanceof HTMLElement && target.isConnected) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
    pending?.run();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (ranked.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current + 1 >= ranked.length ? 0 : current + 1,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current <= 0 ? ranked.length - 1 : current - 1,
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
        setHighlightedIndex(ranked.length - 1);
        return;
      }
      if (event.key === "Enter") {
        const choice = ranked[activeIndex];
        if (choice === undefined) return;
        event.preventDefault();
        chooseAction(choice.action);
      }
    },
    [activeIndex, chooseAction, ranked],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0"
        onCloseAutoFocus={handleCloseAutoFocus}
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Quick palette</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Icon
            name="Search"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            // Opened by a chord expressly to type into.
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              activeIndex === -1
                ? undefined
                : `${optionIdPrefix}-${activeIndex}`
            }
            aria-label={PALETTE_PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={PALETTE_PLACEHOLDER}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
              // `activeIndex` may not change, so the effect above cannot do
              // this: send the scrolled container back to the first row.
              if (listRef.current !== null) listRef.current.scrollTop = 0;
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1"
        >
          {ranked.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matching commands
            </p>
          ) : (
            ranked.map((entry, index) => (
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
    // A listbox option the input points at, not a focusable control.
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
