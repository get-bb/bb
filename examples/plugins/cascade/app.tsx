// bb-plugin-cascade — the frontend. One navPanel owning a scrollable-tiling
// strip of live threads.
//
// Every column renders the host's own `ThreadChat`, so this file never touches
// timeline data, drafts, streaming, or sending — it owns the strip and nothing
// else.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  definePluginApp,
  // Aliased: JSX reads a lowercase-initial name as an intrinsic element.
  experimental_NewThreadComposer as NewThreadComposer,
  ThreadChat,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import {
  acceptsDrop,
  buildRows,
  clampFocus,
  isAdjacentChild,
  PINNED_KEY,
  reorderIds,
  type CascadeColumn,
  type CascadeIndex,
  type CascadeRow,
  type GroupingMode,
} from "./lib/rows";
import { cn } from "@/lib/utils";

// niri's `preset-column-widths`, as a fraction of the viewport.
const WIDTH_PRESETS = [0.333, 0.5, 0.667] as const;
const DRAFT_WIDTH = 0.28;
// The open draft renders bb's full compose surface; its control row (project,
// environment, branch, permission mode) does not fit in the closed placeholder
// width, so an open draft takes the 1/2 preset.
const DRAFT_OPEN_WIDTH = WIDTH_PRESETS[1];
const COLUMN_GAP = 10;
// Vertical space between rows; the overview label lives in it.
const ROW_GUTTER = 120;
const DRAG_THRESHOLD = 5;
// Wheel/trackpad travel that adds up to one column or row of movement.
const WHEEL_STEP = 90;
// A gesture that pauses this long has ended: the next event starts fresh, and
// may pick a different axis.
const WHEEL_GESTURE_GAP = 220;
// A wheel notch, in lines, is worth about this many pixels.
const WHEEL_LINE_HEIGHT = 16;

const MODE_LABEL: Record<GroupingMode, string> = {
  sections: "sections",
  projects: "projects",
  hosts: "machines",
};

interface Layout {
  mode: GroupingMode;
  widths: Record<string, number>;
  focus: Record<string, number>;
  order: Record<string, string[]>;
}

interface DragState {
  column: CascadeColumn;
  fromRow: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  active: boolean;
  /** Row being hovered, or null when the pointer is over no row. */
  overRow: number | null;
  /** Insertion slot within `overRow`, or null when only the row is targeted. */
  insertAt: number | null;
}

/**
 * The nearest ancestor of `node` that can still scroll `delta` on `axis`.
 *
 * This is what keeps wheel navigation out of the way of the thread under the
 * pointer: a timeline still has messages to scroll, or a code block still has
 * line to scroll, owns the gesture. Only once it has hit its end does the
 * strip take over — the same chaining a nested scroll area does natively.
 */
function scrollableUnder(
  target: EventTarget | null,
  root: Element,
  axis: "x" | "y",
  delta: number,
): boolean {
  let node = target instanceof Element ? target : null;
  for (; node && node !== root; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const style = getComputedStyle(node);
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    if (!/auto|scroll|overlay/.test(overflow)) continue;
    const size = axis === "y" ? node.clientHeight : node.clientWidth;
    const content = axis === "y" ? node.scrollHeight : node.scrollWidth;
    if (content <= size + 1) continue;
    const position = axis === "y" ? node.scrollTop : node.scrollLeft;
    const room = delta < 0 ? position > 0 : position + size < content - 1;
    if (room) return true;
  }
  return false;
}

/** True when the event came from somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function statusTone(column: CascadeColumn): string {
  if (column.needsAttention) return "bg-attention";
  switch (column.displayStatus) {
    case "active":
      return "bg-success animate-pulse";
    case "error":
      return "bg-destructive";
    case "starting":
    case "provisioning":
    case "host-reconnecting":
    case "waiting-for-host":
      return "bg-attention";
    default:
      return "bg-muted-foreground/60";
  }
}

function CascadePanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();

  const [index, setIndex] = useState<CascadeIndex | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [rowIdx, setRowIdx] = useState(0);
  const [overview, setOverview] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftParent, setDraftParent] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [palette, setPalette] = useState<CascadeColumn | null>(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [busy, setBusy] = useState(false);

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // Set when a drag actually moved, so the click that ends it is not also
  // read as "zoom into this column".
  const suppressClickRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // True only while the user has deliberately asked to be in a composer
  // (pressed i/↵, or clicked straight into one).
  const composerIntentRef = useRef(false);

  /**
   * Park focus on the panel itself so the keymap is live.
   *
   * Every binding yields to a focused text box and `ThreadChat` autofocuses
   * its composer, so without this the keyboard would be dead on arrival. The
   * resulting model is the vim/niri one: the panel owns the keyboard, `i` (or
   * ↵ on a column) enters that column's composer, Escape leaves it.
   */
  const takeFocus = useCallback(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  /** Move focus into the focused column's composer. */
  const enterComposer = useCallback(() => {
    const node = panelRef.current?.querySelector<HTMLElement>(
      '[data-column][data-focused="true"] [contenteditable="true"]',
    );
    if (!node) {
      toast.error("This column has no composer yet");
      return;
    }
    composerIntentRef.current = true;
    node.focus();
  }, []);

  const leaveComposer = useCallback(() => {
    composerIntentRef.current = false;
    takeFocus();
  }, [takeFocus]);

  // A callback ref, not an effect: the viewport node only exists once the
  // index has loaded, so an effect with [] deps would observe nothing.
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) {
      observerRef.current = null;
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setViewport({ width: box.width, height: box.height });
    });
    observer.observe(node);
    observerRef.current = observer;
    const box = node.getBoundingClientRect();
    setViewport({ width: box.width, height: box.height });
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Refetches overlap: a mutation kicks one off while realtime is firing its
  // own, and the index takes 1-2.5s. Without a guard the slower response wins
  // and re-shows a thread you just archived. Every local change bumps the
  // sequence, so anything started before it is discarded on arrival.
  const indexSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = indexSeq.current;
    const next = await rpc.call("index", null);
    if (seq !== indexSeq.current) return;
    setIndex(next);
  }, [rpc]);

  /**
   * Apply a change to the local index right away.
   *
   * The index refetch costs four SDK round-trips (~1-2.5s), so waiting for it
   * leaves an archived column on screen long enough to read as broken. Every
   * mutation patches locally first and lets the refetch reconcile.
   */
  const patchThreads = useCallback(
    (fn: (threads: CascadeColumn[]) => CascadeColumn[]) => {
      indexSeq.current += 1;
      setIndex((current) =>
        current ? { ...current, threads: fn(current.threads) } : current,
      );
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const [nextIndex, nextLayout] = await Promise.all([
        rpc.call("index", null),
        rpc.call("layout", null),
      ]);
      setIndex(nextIndex);
      setLayout(nextLayout);
    })();
  }, [rpc]);

  useRealtime("index", () => {
    void refresh();
  });

  // Columns mount asynchronously and each `ThreadChat` autofocuses its
  // composer when it does, so timed focus claims lose the race — a chat whose
  // timeline lands late steals the keyboard seconds after arrival. Bounce any
  // focus the user did not ask for straight back to the panel instead. This is
  // deterministic: no timers, no guessing when the last column mounts.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onFocusIn = (event: FocusEvent) => {
      if (composerIntentRef.current) return;
      if (!isTypingTarget(event.target)) return;
      // The draft form's own textarea is ours and always intentional.
      if ((event.target as HTMLElement).closest("[data-draft-form]")) return;
      takeFocus();
    };
    panel.addEventListener("focusin", onFocusIn);
    return () => panel.removeEventListener("focusin", onFocusIn);
  }, [takeFocus, index, layout]);

  const mode = layout?.mode ?? "sections";
  const rows = useMemo<CascadeRow[]>(
    () => (index ? buildRows(index, mode, layout?.order ?? {}) : []),
    [index, mode, layout],
  );

  const projectNames = useMemo(
    () => new Map((index?.projects ?? []).map((p) => [p.id, p.name])),
    [index],
  );

  const focusOf = useCallback(
    (row: CascadeRow) => clampFocus(row, layout?.focus[row.key] ?? 0),
    [layout],
  );

  const persist = useCallback(
    (patch: Partial<Layout>) => {
      setLayout((current) => (current ? { ...current, ...patch } : current));
      void rpc.call("setLayout", patch).catch(() => {
        toast.error("Could not save layout");
      });
    },
    [rpc],
  );

  const safeRowIdx = Math.min(rowIdx, Math.max(0, rows.length - 1));
  const currentRow = rows[safeRowIdx];
  const currentFocus = currentRow ? focusOf(currentRow) : 0;
  const onDraft = currentRow
    ? currentFocus === currentRow.columns.length
    : false;
  const focusedColumn = currentRow?.columns[currentFocus] ?? null;

  const setFocus = useCallback(
    (row: CascadeRow, next: number) => {
      persist({ focus: { ...(layout?.focus ?? {}), [row.key]: next } });
    },
    [layout, persist],
  );

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !subPath || !rows.length) return;
    restored.current = true;
    const target = rows.findIndex((row) =>
      row.columns.some((column) => column.threadId === subPath),
    );
    if (target < 0) return;
    const column = rows[target]!.columns.findIndex(
      (entry) => entry.threadId === subPath,
    );
    setRowIdx(target);
    if (column >= 0) setFocus(rows[target]!, column);
  }, [rows, subPath, setFocus]);

  // ------------------------------------------------------------ mutations
  /** Apply a row's drop rule to a thread. Returns false when it is read-only. */
  const applyDrop = useCallback(
    async (column: CascadeColumn, row: CascadeRow): Promise<boolean> => {
      if (row.drop.kind === "none") {
        toast.error(
          `Can't reassign ${MODE_LABEL[mode]} — only sections and pinning are writable`,
        );
        return false;
      }
      setBusy(true);
      // Optimistic: re-key the thread so it lands in the target row now.
      patchThreads((threads) =>
        threads.map((thread) =>
          thread.threadId === column.threadId
            ? {
                ...thread,
                pinned: row.drop.kind === "pin",
                sectionId:
                  row.drop.kind === "section"
                    ? row.drop.sectionId
                    : thread.sectionId,
              }
            : thread,
        ),
      );
      try {
        if (row.drop.kind === "pin") {
          await rpc.call("setPinned", {
            threadId: column.threadId,
            pinned: true,
          });
          toast.success("Pinned");
        } else {
          // Leaving the Pinned row means unpinning — the row is exclusive.
          if (column.pinned) {
            await rpc.call("setPinned", {
              threadId: column.threadId,
              pinned: false,
            });
          }
          await rpc.call("moveThread", {
            threadId: column.threadId,
            sectionId: row.drop.sectionId,
          });
          toast.success(
            row.drop.sectionId ? `Moved to “${row.name}”` : "Cleared section",
          );
        }
        await refresh();
        return true;
      } catch {
        toast.error("Move failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [mode, rpc, refresh, patchThreads],
  );

  /** Reorder within a row. Pinned uses the server; everything else uses kv. */
  const applyReorder = useCallback(
    async (row: CascadeRow, column: CascadeColumn, insertAt: number) => {
      const ids = reorderIds(row.columns, column.threadId, insertAt);
      if (row.key === PINNED_KEY) {
        const at = ids.indexOf(column.threadId);
        try {
          await rpc.call("reorderPinned", {
            threadId: column.threadId,
            previousThreadId: ids[at - 1] ?? null,
            nextThreadId: ids[at + 1] ?? null,
          });
          await refresh();
        } catch {
          toast.error("Reorder failed");
        }
        return;
      }
      persist({ order: { ...(layout?.order ?? {}), [row.key]: ids } });
    },
    [rpc, refresh, persist, layout],
  );

  // ------------------------------------------------------------- commands
  const focusColumn = useCallback(
    (delta: number) => {
      if (!currentRow) return;
      const next = Math.max(
        0,
        Math.min(currentRow.columns.length, currentFocus + delta),
      );
      if (next !== currentRow.columns.length) setDraftOpen(false);
      setFocus(currentRow, next);
    },
    [currentRow, currentFocus, setFocus],
  );

  const focusRow = useCallback(
    (delta: number) => {
      setDraftOpen(false);
      setRowIdx(Math.max(0, Math.min(rows.length - 1, safeRowIdx + delta)));
    },
    [rows.length, safeRowIdx],
  );

  // Wheel gestures are continuous and the strip is not: a gesture banks travel
  // until it is worth a whole column or row, then spends it. `axis` is locked
  // for the length of a gesture so a slightly diagonal trackpad flick cannot
  // move sideways and downwards at once.
  const wheelRef = useRef({ x: 0, y: 0, at: 0, axis: "" as "" | "x" | "y" });

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      // Overview's card layer is a real scroll container; leave it alone.
      if (overview || palette) return;
      const viewport = event.currentTarget;

      const scale = event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : 1;
      let x = event.deltaX * scale;
      let y = event.deltaY * scale;
      // A mouse with one wheel sends shift+vertical to mean horizontal.
      if (event.shiftKey && x === 0) {
        x = y;
        y = 0;
      }

      const gesture = wheelRef.current;
      if (event.timeStamp - gesture.at > WHEEL_GESTURE_GAP) {
        gesture.x = 0;
        gesture.y = 0;
        gesture.axis = "";
      }
      gesture.at = event.timeStamp;
      if (gesture.axis === "") {
        gesture.axis = Math.abs(x) > Math.abs(y) ? "x" : "y";
      }

      const delta = gesture.axis === "x" ? x : y;
      if (delta === 0) return;
      if (scrollableUnder(event.target, viewport, gesture.axis, delta)) {
        // The thread under the pointer is still scrolling. Bank nothing, or
        // reaching the end of a long timeline would fling the strip.
        gesture.x = 0;
        gesture.y = 0;
        return;
      }

      const banked = (gesture.axis === "x" ? gesture.x : gesture.y) + delta;
      if (Math.abs(banked) < WHEEL_STEP) {
        if (gesture.axis === "x") gesture.x = banked;
        else gesture.y = banked;
        return;
      }
      gesture.x = 0;
      gesture.y = 0;
      if (gesture.axis === "x") focusColumn(Math.sign(banked));
      else focusRow(Math.sign(banked));
    },
    [overview, palette, focusColumn, focusRow],
  );

  /** Shift a column left/right inside its own row. */
  const moveColumn = useCallback(
    (delta: number) => {
      if (!currentRow || !focusedColumn) return;
      const to = currentFocus + delta;
      if (to < 0 || to >= currentRow.columns.length) return;
      void applyReorder(currentRow, focusedColumn, delta > 0 ? to + 1 : to);
      setFocus(currentRow, to);
    },
    [currentRow, focusedColumn, currentFocus, applyReorder, setFocus],
  );

  const sendToRow = useCallback(
    async (delta: number) => {
      const target = rows[safeRowIdx + delta];
      if (!target || !focusedColumn) return;
      if (await applyDrop(focusedColumn, target)) setRowIdx(safeRowIdx + delta);
    },
    [rows, safeRowIdx, focusedColumn, applyDrop],
  );

  const cycleWidth = useCallback(() => {
    if (!focusedColumn || !layout) return;
    const current = layout.widths[focusedColumn.threadId] ?? 0;
    persist({
      widths: {
        ...layout.widths,
        [focusedColumn.threadId]: (current + 1) % WIDTH_PRESETS.length,
      },
    });
  }, [focusedColumn, layout, persist]);

  const cycleMode = useCallback(() => {
    const modes: GroupingMode[] = ["sections", "projects", "hosts"];
    const next = modes[(modes.indexOf(mode) + 1) % modes.length]!;
    setRowIdx(0);
    persist({ mode: next });
    toast.success(`Rows grouped by ${MODE_LABEL[next]}`);
  }, [mode, persist]);

  const openDraft = useCallback(
    (parent: string | null) => {
      if (!currentRow) return;
      // The composer lives in the strip, so writing in it means leaving the
      // card layer.
      setOverview(false);
      setDraftParent(parent);
      setFocus(currentRow, currentRow.columns.length);
      setDraftOpen(true);
    },
    [currentRow, setFocus],
  );

  // Which project the composer opens on. The row itself decides when it can
  // (a projects row IS a project); otherwise inherit from the neighbouring
  // column, then fall back to the first known project.
  const draftProjectIdFor = useCallback(
    (row: CascadeRow): string | undefined =>
      row.kind === "projects"
        ? row.key
        : (row.columns[currentFocus - 1]?.projectId ??
          row.columns[0]?.projectId ??
          index?.projects[0]?.id),
    [currentFocus, index],
  );

  // Bumped whenever the draft opens so the composer takes the caret.
  const [draftFocusRequest, setDraftFocusRequest] = useState(0);
  useEffect(() => {
    if (draftOpen) setDraftFocusRequest((request) => request + 1);
  }, [draftOpen]);

  // The host composer resolved every selection; the row decides only where the
  // thread lands. Throwing is meaningful: the composer keeps the user's draft
  // when this rejects, and clears it when it resolves.
  const startThread = useCallback(
    async (request: NewThreadRequest) => {
      if (!currentRow) throw new Error("No row to create this thread in");
      setBusy(true);
      try {
        await rpc.call("createThread", {
          request,
          sectionId: currentRow.kind === "sections" ? currentRow.key : null,
          parentThreadId: draftParent,
          pinned: currentRow.kind === "pinned",
        });
      } catch (error) {
        toast.error("Could not start thread");
        throw error;
      } finally {
        setBusy(false);
      }
      setDraftParent(null);
      setDraftOpen(false);
      await refresh();
      toast.success("Thread started");
    },
    [draftParent, currentRow, rpc, refresh],
  );

  const renameRow = useCallback(
    async (name: string) => {
      setRenaming(false);
      if (!currentRow || currentRow.kind !== "sections") return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === currentRow.name) return;
      try {
        await rpc.call("renameSection", { id: currentRow.key, name: trimmed });
        await refresh();
        toast.success(`Renamed to “${trimmed}”`);
      } catch {
        toast.error("Rename failed");
      }
    },
    [currentRow, rpc, refresh],
  );

  const newSection = useCallback(async () => {
    try {
      await rpc.call("createSection", { name: "New section" });
      await refresh();
      toast.success("Section created — move a thread into it to see its row");
    } catch {
      toast.error("Could not create section");
    }
  }, [rpc, refresh]);

  /** Archive the focused thread, with an undo toast — never a bare destroy. */
  const closeColumn = useCallback(async () => {
    if (!focusedColumn) return;
    const { threadId, title } = focusedColumn;
    // Drop the column now; an archived thread lingering on screen reads as a
    // failed keypress.
    patchThreads((threads) =>
      threads.filter((thread) => thread.threadId !== threadId),
    );
    try {
      await rpc.call("archiveThread", { threadId });
      toast.success(`Archived “${title}”`, {
        action: {
          label: "Undo",
          onClick: () => {
            void rpc.call("unarchiveThread", { threadId }).then(refresh);
          },
        },
      });
    } catch {
      toast.error("Could not archive");
    }
    await refresh();
  }, [focusedColumn, rpc, refresh, patchThreads]);

  // --------------------------------------------------------- move palette
  const paletteTargets = useMemo(
    () => rows.filter((row) => acceptsDrop(row) && row.key !== currentRow?.key),
    [rows, currentRow],
  );

  const commitPalette = useCallback(async () => {
    const column = palette;
    const target = paletteTargets[paletteIdx];
    setPalette(null);
    if (!column || !target) return;
    const to = rows.indexOf(target);
    if (await applyDrop(column, target)) setRowIdx(to);
  }, [palette, paletteTargets, paletteIdx, rows, applyDrop]);

  // -------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Every binding yields to a focused text box. That is what makes the
      // bare-letter keymap safe next to a live composer in each column.
      if (isTypingTarget(event.target)) {
        // Escape leaves the composer and hands the keymap back.
        if (event.key === "Escape") {
          (event.target as HTMLElement).blur();
          leaveComposer();
        }
        return;
      }
      if (drag) return;

      const key = event.key;
      const mod = event.ctrlKey || event.metaKey;

      if (palette) {
        event.preventDefault();
        if (key === "Escape") return setPalette(null);
        if (key === "Enter") return void commitPalette();
        if (key === "j" || key === "ArrowDown")
          return setPaletteIdx(
            (i) => (i + 1) % Math.max(1, paletteTargets.length),
          );
        if (key === "k" || key === "ArrowUp")
          return setPaletteIdx(
            (i) =>
              (i - 1 + paletteTargets.length) %
              Math.max(1, paletteTargets.length),
          );
        return;
      }

      if (draftOpen) {
        // The composer's pickers are portalled popovers that also dismiss on
        // Escape. Closing the draft in the same keystroke would throw away the
        // user's prompt just because they backed out of the model menu, so
        // Escape only cancels the draft when no popover is open.
        const popoverOpen =
          document.querySelector("[data-radix-popper-content-wrapper]") !==
          null;
        if (key === "Escape" && !popoverOpen) setDraftOpen(false);
        return;
      }

      switch (key) {
        case "h":
        case "ArrowLeft":
          event.preventDefault();
          return event.shiftKey ? moveColumn(-1) : focusColumn(-1);
        case "l":
        case "ArrowRight":
          event.preventDefault();
          return event.shiftKey ? moveColumn(1) : focusColumn(1);
        case "H":
          event.preventDefault();
          return moveColumn(-1);
        case "L":
          event.preventDefault();
          return moveColumn(1);
        case "k":
        case "ArrowUp":
          event.preventDefault();
          if (mod && event.shiftKey) return void sendToRow(-1);
          return focusRow(-1);
        case "j":
        case "ArrowDown":
          event.preventDefault();
          if (mod && event.shiftKey) return void sendToRow(1);
          return focusRow(1);
        case "K":
          event.preventDefault();
          return void sendToRow(-1);
        case "J":
          event.preventDefault();
          return void sendToRow(1);
        case "r":
          return cycleWidth();
        case "o":
          return setOverview((value) => !value);
        case "g":
          return cycleMode();
        case "n":
          event.preventDefault();
          return openDraft(null);
        case "N":
          event.preventDefault();
          return openDraft(focusedColumn?.threadId ?? null);
        case "S":
          return void newSection();
        case "m":
          if (!focusedColumn) return;
          setPaletteIdx(0);
          return setPalette(focusedColumn);
        case "c":
        case "F2":
          if (currentRow?.kind !== "sections") {
            toast.error(`${MODE_LABEL[mode]} aren't renameable`);
            return;
          }
          return setRenaming(true);
        case "q":
          return void closeColumn();
        case "i":
          event.preventDefault();
          // The composers are in the strip, under the card layer, so the first
          // press comes back out of overview.
          if (overview) return setOverview(false);
          return enterComposer();
        case "Enter":
          event.preventDefault();
          // In overview ↵ zooms to the focused column — h/j/k/l still move the
          // selection while zoomed out, so you can pick a thread and drop into
          // it without reaching for the mouse. Press it again to reach the
          // composer.
          if (overview) return setOverview(false);
          // On the draft slot ↵ opens the new-thread form; on a column it
          // drops into that thread's composer.
          return onDraft ? openDraft(null) : enterComposer();
        case "Escape":
          if (overview) setOverview(false);
          return;
        default:
          if (/^[1-9]$/.test(key)) {
            const target = Number(key) - 1;
            if (target < rows.length) setRowIdx(target);
          }
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    drag,
    palette,
    paletteTargets,
    commitPalette,
    draftOpen,
    overview,
    onDraft,
    rows.length,
    currentRow,
    focusedColumn,
    mode,
    focusColumn,
    focusRow,
    moveColumn,
    sendToRow,
    cycleWidth,
    cycleMode,
    openDraft,
    newSection,
    closeColumn,
    takeFocus,
    leaveComposer,
    enterComposer,
  ]);

  // ---------------------------------------------------------------- layout
  const stride = viewport.height + ROW_GUTTER;
  const overviewScale = rows.length
    ? Math.min(0.5, (viewport.height - 48) / (rows.length * stride))
    : 1;

  const widthOf = useCallback(
    (threadId: string) =>
      WIDTH_PRESETS[layout?.widths[threadId] ?? 0]! * viewport.width,
    [layout, viewport.width],
  );

  const draftWidthFor = useCallback(
    (row: CascadeRow) =>
      (draftOpen && currentRow?.key === row.key
        ? DRAFT_OPEN_WIDTH
        : DRAFT_WIDTH) * viewport.width,
    [draftOpen, currentRow?.key, viewport.width],
  );

  const stripWidths = useCallback(
    (row: CascadeRow) =>
      row.columns
        .map((column) => widthOf(column.threadId))
        .concat([draftWidthFor(row)]),
    [widthOf, draftWidthFor],
  );

  const stripOffset = useCallback(
    (row: CascadeRow, focus: number): number => {
      const widths = stripWidths(row);
      if (overview) {
        const total = widths.reduce(
          (sum, width) => sum + width + COLUMN_GAP,
          -COLUMN_GAP,
        );
        return viewport.width / 2 - total / 2;
      }
      let x = 0;
      for (let i = 0; i < focus; i += 1) x += widths[i]! + COLUMN_GAP;
      return viewport.width / 2 - (x + widths[focus]! / 2);
    },
    [stripWidths, overview, viewport.width],
  );

  // ------------------------------------------------------------------ drag
  const beginDrag = useCallback(
    (event: ReactPointerEvent, column: CascadeColumn, fromRow: number) => {
      // Only the header is a drag handle: the body is a live chat, and
      // hijacking pointerdown there would break text selection.
      if (event.button !== 0) return;
      setDrag({
        column,
        fromRow,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        overRow: null,
        insertAt: null,
      });
    },
    [],
  );

  useEffect(() => {
    if (!drag) return;

    const resolveTarget = (x: number, y: number) => {
      // The rail is always a valid drop target, so a move never requires
      // opening overview first.
      const pips = railRef.current?.querySelectorAll("[data-row-pip]") ?? [];
      for (let i = 0; i < pips.length; i += 1) {
        const box = pips[i]!.getBoundingClientRect();
        if (
          x >= box.left &&
          x <= box.right &&
          y >= box.top &&
          y <= box.bottom
        ) {
          return { overRow: i, insertAt: null };
        }
      }

      // Hit-test whichever layer the user can actually see: the card layer in
      // overview, the strip otherwise. Both label their rows and columns the
      // same way, and getBoundingClientRect resolves the strip's transform, so
      // either one answers in plain screen coordinates.
      const surface = overview ? overlayRef.current : worldRef.current;
      const rowNodes = surface?.querySelectorAll("[data-row]") ?? [];
      for (let i = 0; i < rowNodes.length; i += 1) {
        const box = rowNodes[i]!.getBoundingClientRect();
        if (!(y >= box.top && y <= box.bottom)) continue;

        // Within a row, find the insertion slot from column midpoints.
        const columnNodes = rowNodes[i]!.querySelectorAll("[data-column]");
        let insertAt = columnNodes.length;
        for (let c = 0; c < columnNodes.length; c += 1) {
          const cbox = columnNodes[c]!.getBoundingClientRect();
          if (x < cbox.left + cbox.width / 2) {
            insertAt = c;
            break;
          }
        }
        return { overRow: i, insertAt };
      }
      return { overRow: null, insertAt: null };
    };

    const onMove = (event: PointerEvent) => {
      setDrag((current) => {
        if (!current) return current;
        const active =
          current.active ||
          Math.hypot(
            event.clientX - current.startX,
            event.clientY - current.startY,
          ) > DRAG_THRESHOLD;
        if (!active) return { ...current, x: event.clientX, y: event.clientY };
        const target = resolveTarget(event.clientX, event.clientY);
        return {
          ...current,
          x: event.clientX,
          y: event.clientY,
          active: true,
          ...target,
        };
      });
    };

    const onUp = () => {
      setDrag((current) => {
        if (!current) return null;
        const { active, column, fromRow, overRow, insertAt } = current;
        suppressClickRef.current = active;
        if (active && overRow !== null) {
          const target = rows[overRow];
          if (target) {
            if (overRow === fromRow) {
              if (insertAt !== null)
                void applyReorder(target, column, insertAt);
            } else {
              void applyDrop(column, target).then((moved) => {
                if (moved) setRowIdx(overRow);
              });
            }
          }
        }
        return null;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, rows, overview, applyDrop, applyReorder]);

  // Keyboard row moves happen in the overlay too, and its rows scroll, so keep
  // the focused one on screen.
  useEffect(() => {
    if (!overview) return;
    overlayRef.current
      ?.querySelectorAll("[data-row]")
      [safeRowIdx]?.scrollIntoView({ block: "nearest" });
  }, [overview, safeRowIdx]);

  if (!index || !layout) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading threads…
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No threads yet.
      </div>
    );
  }

  const dragging = drag?.active ? drag : null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        // A click landing straight in a composer is a deliberate request for
        // it; anything else keeps the keymap.
        composerIntentRef.current = isTypingTarget(event.target);
      }}
      className="flex h-full min-h-0 flex-col select-none outline-none"
    >
      {/* toolbar */}
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border/60 bg-sidebar px-2.5 text-sm">
        {renaming ? (
          <input
            autoFocus
            defaultValue={currentRow?.name ?? ""}
            className="h-6 w-48 rounded border border-ring bg-background px-1.5 text-sm outline-none"
            onBlur={(event) => void renameRow(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter")
                void renameRow(event.currentTarget.value);
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button
            className="rounded px-1.5 py-0.5 font-medium hover:bg-accent"
            title={
              currentRow?.kind === "sections"
                ? "Rename section (c)"
                : "Only sections can be renamed"
            }
            onClick={() =>
              currentRow?.kind === "sections"
                ? setRenaming(true)
                : toast.error(`${MODE_LABEL[mode]} aren't renameable`)
            }
          >
            {currentRow?.name}
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {onDraft
            ? "new thread"
            : `${currentFocus + 1} / ${currentRow?.columns.length}`}
        </span>
        <div className="flex-1" />
        <ToolbarButton onClick={cycleMode}>
          rows: {MODE_LABEL[mode]}
        </ToolbarButton>
        <ToolbarButton onClick={cycleWidth} disabled={!focusedColumn}>
          width
        </ToolbarButton>
        <ToolbarButton onClick={() => void newSection()}>
          + section
        </ToolbarButton>
        <ToolbarButton active={overview} onClick={() => setOverview((v) => !v)}>
          overview
        </ToolbarButton>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* row rail — the workspace switcher, and always a drop target */}
        <nav
          ref={railRef}
          className="flex w-[132px] flex-none flex-col gap-1 overflow-y-auto border-r border-border/60 bg-sidebar p-1.5"
        >
          {rows.map((row, i) => {
            const isDropTarget =
              dragging?.overRow === i && dragging.fromRow !== i;
            return (
              <button
                key={row.key}
                data-row-pip
                onClick={() => setRowIdx(i)}
                title={`${row.name} — ${row.columns.length} thread${row.columns.length === 1 ? "" : "s"}`}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                  isDropTarget && acceptsDrop(row)
                    ? "border-success bg-success/15"
                    : isDropTarget
                      ? "border-destructive bg-destructive/10"
                      : i === safeRowIdx
                        ? "border-primary/35 bg-primary/15"
                        : "border-transparent hover:bg-accent",
                )}
              >
                {/* The index earns its place — 1-9 jumps to a row. */}
                <span className="w-3 flex-none font-mono text-[10px] text-muted-foreground/70">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {row.name}
                </span>
              </button>
            );
          })}
        </nav>

        <div
          ref={viewportRef}
          onWheel={onWheel}
          className="relative min-w-0 flex-1 overflow-hidden"
        >
          {/* The strip. In overview it stays mounted and keeps streaming; it
              only shrinks and dims, and the card layer above takes the input.
              Nothing unmounts, so leaving overview reloads no timelines. */}
          <div
            className={cn(
              "absolute inset-0 origin-center transition-all duration-300 ease-out",
              overview && "pointer-events-none opacity-20",
            )}
            style={{ transform: `scale(${overview ? overviewScale : 1})` }}
          >
            <div
              ref={worldRef}
              className="absolute inset-0 transition-transform duration-300 ease-out"
              style={{
                transform: `translateY(${
                  overview
                    ? -((rows.length - 1) / 2) * stride
                    : -safeRowIdx * stride
                }px)`,
              }}
            >
              {rows.map((row, ri) => {
                const focus = focusOf(row);
                const current = ri === safeRowIdx;
                const showInsert =
                  dragging?.overRow === ri && dragging.insertAt !== null;
                return (
                  <section
                    key={row.key}
                    data-row
                    className={cn(
                      "absolute inset-x-0 h-full transition-opacity duration-200",
                      !overview && !current && "pointer-events-none opacity-0",
                      overview &&
                        "rounded-2xl outline-dashed outline-2 outline-offset-8",
                      overview &&
                        (current
                          ? "outline-primary/35"
                          : "outline-foreground/10"),
                      dragging?.overRow === ri &&
                        dragging.fromRow !== ri &&
                        (acceptsDrop(row)
                          ? "outline-solid outline-success"
                          : "outline-solid outline-destructive"),
                    )}
                    style={{ top: ri * stride }}
                  >
                    <div
                      className="absolute inset-y-0 flex items-stretch gap-2.5 py-3 transition-transform duration-300 ease-out"
                      style={{
                        transform: `translateX(${stripOffset(row, focus)}px)`,
                      }}
                    >
                      {row.columns.map((column, ci) => (
                        <div key={column.threadId} className="flex">
                          {showInsert && dragging.insertAt === ci && (
                            <InsertMarker />
                          )}
                          <article
                            data-column
                            data-focused={current && ci === focus}
                            onMouseDown={() => {
                              setRowIdx(ri);
                              setDraftOpen(false);
                              setFocus(row, ci);
                            }}
                            onClick={() => {
                              // Clicking a column in overview zooms to it. A
                              // drag that ends over this column must not.
                              if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                              }
                              if (overview) setOverview(false);
                            }}
                            style={{ width: widthOf(column.threadId) }}
                            className={cn(
                              "relative flex flex-none flex-col overflow-hidden rounded-lg border bg-card transition-all",
                              current && ci === focus
                                ? "border-primary/35 shadow-lg ring-1 ring-primary/35"
                                : "border-border opacity-75 shadow-sm",
                              dragging?.column.threadId === column.threadId &&
                                "opacity-35",
                              isAdjacentChild(row.columns, ci) &&
                                "before:absolute before:-left-[11px] before:top-[26px] before:h-px before:w-[11px] before:bg-border",
                            )}
                          >
                            <header
                              onPointerDown={(event) =>
                                beginDrag(event, column, ri)
                              }
                              className="flex min-h-[38px] flex-none cursor-grab items-center gap-2 border-b border-border/60 bg-foreground/[0.02] px-2.5 py-2 active:cursor-grabbing"
                            >
                              <span
                                className={cn(
                                  "h-[7px] w-[7px] flex-none rounded-full",
                                  statusTone(column),
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {column.title}
                              </span>
                              {column.pinned && (
                                <span className="flex-none text-[10px] text-attention">
                                  ★
                                </span>
                              )}
                              {column.branchName && (
                                <span className="max-w-[40%] flex-none truncate font-mono text-[10px] text-muted-foreground">
                                  {column.branchName}
                                </span>
                              )}
                            </header>
                            {/* The host owns everything below: timeline,
                                streaming, composer, attachments, send/steer. */}
                            <div className="min-h-0 flex-1 select-text">
                              <ThreadChat
                                threadId={column.threadId}
                                variant="compact"
                                layout="contained"
                              />
                            </div>
                          </article>
                        </div>
                      ))}

                      {showInsert &&
                        dragging.insertAt === row.columns.length && (
                          <InsertMarker />
                        )}

                      <article
                        style={{ width: draftWidthFor(row) }}
                        onMouseDown={() => {
                          setRowIdx(ri);
                          setFocus(row, row.columns.length);
                          setDraftOpen(true);
                        }}
                        className={cn(
                          "flex flex-none flex-col overflow-hidden rounded-lg border border-dashed bg-foreground/[0.03]",
                          current && focus === row.columns.length
                            ? "border-input bg-card"
                            : "border-input/70 opacity-75",
                        )}
                      >
                        {current &&
                        focus === row.columns.length &&
                        draftOpen ? (
                          // `data-draft-form` marks this composer as one the
                          // user asked for, so the panel's focus guard leaves
                          // it alone (see the focusin handler above).
                          <div
                            data-draft-form
                            // No Escape-to-close here: the composer's own
                            // pickers dismiss on Escape, and closing the draft
                            // out from under one would throw away the draft.
                            // The panel keymap already hands focus back, and
                            // moving focus off the draft column closes it.
                            className="flex min-h-0 flex-1 flex-col justify-end gap-2 p-2.5"
                          >
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {draftParent ? "Child thread" : "New thread"} in{" "}
                              <b>{row.name}</b>
                            </span>
                            <NewThreadComposer
                              defaultProjectId={draftProjectIdFor(row)}
                              focusRequest={draftFocusRequest}
                              draftKey={`cascade:${row.key}`}
                              placeholder="What should this thread do?"
                              onSubmit={startThread}
                            />
                          </div>
                        ) : (
                          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                            <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-dashed border-input text-base">
                              +
                            </span>
                            <span>
                              New thread in <b>{row.name}</b>
                            </span>
                          </div>
                        )}
                      </article>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          {/* overview — the card layer.
              Zoomed out, a column is 80px wide and 350 tall, so a title inside
              it wraps into an unreadable tower however large the type is. The
              cards therefore leave the scaled world entirely and draw at
              normal size, in the same rows and the same order, over the strip
              they describe. */}
          {overview && (
            <div
              ref={overlayRef}
              className="absolute inset-0 z-20 overflow-y-auto bg-background/70 p-3"
            >
              {rows.map((row, ri) => {
                const focus = focusOf(row);
                const current = ri === safeRowIdx;
                const showInsert =
                  dragging?.overRow === ri && dragging.insertAt !== null;
                return (
                  <section
                    key={row.key}
                    data-row
                    className={cn(
                      "mb-1 rounded-xl border p-2 transition-colors",
                      current
                        ? "border-primary/35 bg-primary/[0.06]"
                        : "border-transparent",
                      dragging?.overRow === ri &&
                        dragging.fromRow !== ri &&
                        (acceptsDrop(row)
                          ? "border-success bg-success/10"
                          : "border-destructive bg-destructive/10"),
                    )}
                  >
                    <div className="mb-1.5 flex items-center gap-2 px-0.5">
                      <span className="w-3 flex-none font-mono text-[10px] text-muted-foreground/70">
                        {ri + 1}
                      </span>
                      <span className="text-xs font-medium">{row.name}</span>
                      <span className="rounded border border-border bg-foreground/[0.06] px-1.5 font-mono text-[10px] text-muted-foreground">
                        {row.kind === "pinned"
                          ? "pinned"
                          : row.kind === "unsectioned"
                            ? "none"
                            : MODE_LABEL[mode]}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/70">
                        {row.columns.length}
                      </span>
                    </div>
                    <div className="flex items-stretch gap-2">
                      {row.columns.map((column, ci) => (
                        <div key={column.threadId} className="flex min-w-0">
                          {showInsert && dragging.insertAt === ci && (
                            <InsertMarker />
                          )}
                          <OverviewCard
                            column={column}
                            projectName={
                              projectNames.get(column.projectId) ?? null
                            }
                            focused={current && ci === focus}
                            dragged={
                              dragging?.column.threadId === column.threadId
                            }
                            onMouseDown={() => {
                              setRowIdx(ri);
                              setDraftOpen(false);
                              setFocus(row, ci);
                            }}
                            onPointerDown={(event) =>
                              beginDrag(event, column, ri)
                            }
                            onClick={() => {
                              // A drag that ends over a card is not a click
                              // asking to zoom into it.
                              if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                              }
                              setOverview(false);
                            }}
                          />
                        </div>
                      ))}
                      {showInsert &&
                        dragging.insertAt === row.columns.length && (
                          <InsertMarker />
                        )}
                      <button
                        onClick={() => {
                          setRowIdx(ri);
                          setFocus(row, row.columns.length);
                          setOverview(false);
                          setDraftOpen(true);
                        }}
                        className={cn(
                          "flex min-h-[68px] w-[132px] flex-none items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground hover:text-foreground",
                          current && focus === row.columns.length
                            ? "border-primary/35 ring-1 ring-primary/35"
                            : "border-input/70 hover:border-input",
                        )}
                      >
                        + New thread
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* move palette */}
          {palette && (
            <div className="absolute inset-0 z-30 flex justify-center bg-background/80 pt-[12vh] backdrop-blur-sm">
              <div className="h-fit w-[380px] max-w-[92%] overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                <div className="border-b border-border/60 px-3 py-2 text-sm text-muted-foreground">
                  Move <b className="text-foreground">{palette.title}</b> to…
                </div>
                <div className="max-h-[320px] overflow-auto p-1.5">
                  {paletteTargets.length === 0 ? (
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                      Rows are grouped by {MODE_LABEL[mode]} — press{" "}
                      <b className="text-foreground">g</b> for sections
                    </div>
                  ) : (
                    paletteTargets.map((row, i) => (
                      <button
                        key={row.key}
                        onClick={() => {
                          setPaletteIdx(i);
                          void commitPalette();
                        }}
                        onMouseEnter={() => setPaletteIdx(i)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                          i === paletteIdx &&
                            "bg-primary/15 ring-1 ring-inset ring-primary/35",
                        )}
                      >
                        <span>{row.name}</span>
                        {row.kind === "pinned" && (
                          <span className="text-[10px] text-muted-foreground">
                            pin
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {row.columns.length}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-border/60 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
                  PATCH /threads · {"{ sectionId }"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* drag ghost */}
      {dragging && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-primary/35 bg-card px-2.5 py-1.5 text-sm font-medium shadow-xl"
          style={{ left: dragging.x, top: dragging.y }}
        >
          {dragging.column.title}
        </div>
      )}

      <footer className="flex h-8 flex-none items-center gap-1.5 overflow-x-auto whitespace-nowrap border-t border-border/60 bg-sidebar px-2.5 text-[10px] text-muted-foreground">
        <Key>h</Key>
        <Key>l</Key> columns
        <Sep />
        <Key>j</Key>
        <Key>k</Key> rows
        <Sep />
        <Key>⇧</Key>+<Key>hl</Key> reorder
        <Sep />
        <Key>⇧</Key>+<Key>jk</Key> move to row
        <Sep />
        <Key>i</Key>/<Key>↵</Key> composer
        <Sep />
        <Key>esc</Key> back
        <Sep />
        <Key>r</Key> width
        <Sep />
        <Key>o</Key> overview
        <Sep />
        <Key>n</Key> new
        <Sep />
        <Key>⇧N</Key> child
        <Sep />
        <Key>m</Key> move to…
        <Sep />
        <Key>g</Key> group by
        <Sep />
        <Key>c</Key> rename
        <Sep />
        <Key>⇧S</Key> section
        <Sep />
        <Key>q</Key> archive
        <Sep />
        <Key>1-9</Key> row
      </footer>
    </div>
  );
}

/**
 * One thread in the overview layer.
 *
 * Deliberately a fixed, landscape card at normal type size rather than a
 * scaled-down column: a title needs width, and the column shape has none to
 * give at overview scale. It shrinks (never grows) so a crowded row still fits
 * across the panel without a scrollbar.
 */
function OverviewCard({
  column,
  projectName,
  focused,
  dragged,
  onMouseDown,
  onPointerDown,
  onClick,
}: {
  column: CascadeColumn;
  projectName: string | null;
  focused: boolean;
  dragged: boolean;
  onMouseDown: () => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onClick: () => void;
}) {
  return (
    <article
      data-column
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      onClick={onClick}
      title={column.title}
      className={cn(
        // Height comes from the content, not a constant: a two-line title
        // with a branch under it must not clip. `items-stretch` on the row
        // then squares every card in it off against the tallest.
        "flex min-h-[68px] w-[186px] min-w-[92px] shrink cursor-grab flex-col gap-1 overflow-hidden rounded-lg border bg-card px-2.5 py-1.5 active:cursor-grabbing",
        focused
          ? "border-primary/35 shadow-md ring-1 ring-primary/35"
          : "border-border hover:border-input",
        dragged && "opacity-35",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-[7px] w-[7px] flex-none rounded-full",
            statusTone(column),
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
          {projectName ?? "No project"}
        </span>
        {column.pinned && (
          <span className="flex-none text-[10px] text-attention">★</span>
        )}
      </div>
      <span className="line-clamp-2 text-[13px] font-medium leading-tight">
        {column.title}
      </span>
      {column.branchName !== null && (
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {column.branchName}
        </span>
      )}
    </article>
  );
}

const InsertMarker = () => (
  <span className="my-3 -mx-1 w-0.5 flex-none rounded-full bg-primary" />
);

function ToolbarButton({
  children,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-[22px] rounded-md border px-2 text-[10px] transition-colors disabled:opacity-50",
        active
          ? "border-primary/35 bg-primary/15 text-foreground"
          : "border-border bg-foreground/[0.04] text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <span className="rounded border border-border bg-foreground/[0.06] px-1 py-px font-mono text-[10px] text-muted-foreground">
    {children}
  </span>
);

const Sep = () => <span className="opacity-35">·</span>;

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "cascade",
    title: "Cascade",
    icon: "Columns3",
    path: "cascade",
    component: CascadePanel,
  });
});
