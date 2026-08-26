import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ancestorsOf,
  buildTree,
  filterTree,
  type FlatEntry,
  type TreeNode,
} from "../lib/file-tree.js";
import { toast } from "sonner";
import {
  clampTreeHeight,
  readStoredTreeHeight,
  storeTreeHeight,
} from "../lib/file-tree-height.js";
import { ContextMenu, type ContextMenuState } from "./ContextMenu.js";
import { cn } from "@bb/shared-ui/lib/utils";

export interface FileTreePanelProps {
  entries: readonly FlatEntry[];
  /** Absolute path the entries are relative to; "" until the listing lands. */
  root: string;
  /** True while the listing is in flight; the panel opens before it lands. */
  isLoading: boolean;
  error: string | null;
  truncated: boolean;
  /** The file currently in the editor, revealed and highlighted. */
  activePath: string;
  /**
   * The editor's own background, so the tree reads as part of the same
   * surface as the code rather than as BB chrome laid over it. Null until the
   * code theme resolves, which falls back to BB's recessed surface token.
   */
  background: string | null;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

const INDENT_PER_LEVEL_PX = 12;

export function FileTreePanel({
  background,
  entries,
  root,
  isLoading,
  error,
  truncated,
  activePath,
  onOpenFile,
  onClose,
}: FileTreePanelProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Seeded from storage so a resize survives hiding and reshowing the panel.
  const [height, setHeight] = useState(readStoredTreeHeight);
  const heightRef = useRef(height);
  heightRef.current = height;
  // The height the user asked for, which is not always the one on screen: a
  // pane too short to honour it renders the clamped height and restores this
  // one when the pane grows again.
  const requestedHeightRef = useRef(height);
  // The height the drag started from, so the panel tracks the total pointer
  // delta. Accumulating per move event instead would drift: every move the
  // clamp absorbs would be lost, and dragging back would not return the seam
  // to the pointer.
  const dragStartHeightRef = useRef<number | null>(null);

  /** The space the tree and the editor share. */
  const availableHeight = (): number =>
    panelRef.current?.parentElement?.clientHeight ?? window.innerHeight;

  const applyHeight = (requested: number) => {
    requestedHeightRef.current = requested;
    setHeight(clampTreeHeight(requested, availableHeight()));
  };

  const startResize = () => {
    dragStartHeightRef.current = heightRef.current;
  };

  const resizeBy = (deltaY: number) => {
    applyHeight((dragStartHeightRef.current ?? heightRef.current) + deltaY);
  };

  const commitHeight = () => {
    dragStartHeightRef.current = null;
    storeTreeHeight(heightRef.current);
  };

  // A stored height can be taller than the pane the panel opens in — a short
  // window, or a secondary panel split small — and the pane can change size
  // under it. Re-fit on both rather than letting the tree take the surface.
  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (parent === null || parent === undefined) return;
    const fit = () => {
      const next = clampTreeHeight(
        requestedHeightRef.current,
        parent.clientHeight,
      );
      if (next !== heightRef.current) setHeight(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const openMenu = (event: React.MouseEvent, node: TreeNode) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: "Copy absolute path",
          onSelect: () =>
            copy(
              // The daemon may hand back a Windows root; joining with "/"
              // there would produce a path nothing on that host accepts.
              root === ""
                ? node.path
                : root.includes("\\")
                  ? `${root}\\${node.path.replace(/\//g, "\\")}`
                  : `${root}/${node.path}`,
              "Absolute path copied",
            ),
        },
        {
          label: "Copy relative path",
          onSelect: () => copy(node.path, "Relative path copied"),
        },
        {
          label: "Copy filename",
          onSelect: () => copy(node.name, "Filename copied"),
        },
      ],
    });
  };

  const tree = useMemo(() => buildTree(entries), [entries]);
  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  // Reveal the open file: every directory above it starts expanded. Re-runs
  // when the editor moves to another file, so the tree follows along.
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of ancestorsOf(activePath)) next.add(ancestor);
      return next;
    });
  }, [activePath]);

  // Scroll the revealed file into view once the rows for it exist.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activePath, entries.length]);

  const effectiveExpanded = useMemo(() => {
    if (filtered.expand.size === 0) return expanded;
    // While filtering, matches are shown regardless of what the user has
    // collapsed; their own expansion state is preserved for when the query
    // is cleared.
    return new Set([...expanded, ...filtered.expand]);
  }, [expanded, filtered.expand]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    // Sits above the toolbar, so the divider goes on the bottom edge to
    // separate the tree from the file bar beneath it.
    <div
      ref={panelRef}
      style={{
        height,
        // Rows and the filter row are transparent, so this one declaration
        // carries the whole panel. The hover and active tints over it are
        // translucent BB tokens, which composite onto it correctly.
        ...(background === null ? {} : { backgroundColor: background }),
      }}
      className={cn(
        "flex shrink-0 flex-col",
        background === null && "bg-surface-recessed",
      )}
    >
      {/*
        The tree's own bar, on the same surface token as the file bar below
        it: the two stack, and reading as one strip of chrome is what keeps
        the tree's background from looking like a third surface.
      */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 bg-surface-raised px-4">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape clears a query first, and closes only once the box is
            // empty — so it never discards a filter and the panel in one press.
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (query !== "") setQuery("");
            else onClose();
          }}
          placeholder="Filter files…"
          aria-label="Filter files"
          spellCheck={false}
          className={cn(
            // A translucent inset rather than an app surface token: the panel
            // now sits on the editor's background, and an opaque field on it
            // would be a second, unrelated surface.
            "h-6 min-w-0 flex-1 rounded-sm bg-state-hover px-2 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
          )}
        />
        <button
          type="button"
          onClick={onClose}
          title="Hide files"
          aria-label="Hide files"
          className={cn(
            "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md",
            "text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden>
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {error !== null ? (
          <Message tone="error">{error}</Message>
        ) : isLoading ? (
          <Message>Loading files…</Message>
        ) : filtered.nodes.length === 0 ? (
          <Message>
            {query.trim() === "" ? "No files" : `No files match “${query}”`}
          </Message>
        ) : (
          <Rows
            activePath={activePath}
            activeRowRef={activeRowRef}
            expanded={effectiveExpanded}
            level={0}
            nodes={filtered.nodes}
            onContextMenu={openMenu}
            onOpenFile={onOpenFile}
            onToggle={toggle}
          />
        )}
        {truncated && error === null ? (
          <Message>
            Showing the first {entries.length.toLocaleString()} entries; this
            project is larger.
          </Message>
        ) : null}
      </div>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      <ResizeHandle
        onResize={resizeBy}
        onResizeEnd={commitHeight}
        onResizeStart={startResize}
      />
    </div>
  );
}

/**
 * The draggable seam between the tree and the editor, in the same idiom as
 * BB's own pane dividers: a hairline that is the border, plus a taller
 * transparent hit target straddling it so the pointer does not have to find
 * one pixel.
 */
function ResizeHandle({
  onResize,
  onResizeEnd,
  onResizeStart,
}: {
  onResize: (deltaY: number) => void;
  onResizeEnd: () => void;
  onResizeStart: () => void;
}) {
  const dividerRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags; a right-click here opens the app menu.
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const divider = dividerRef.current;
    if (divider !== null) divider.dataset.dragging = "true";
    onResizeStart();
    // Capture on the hit target so the drag survives the pointer leaving it —
    // which it does immediately, since the seam moves out from under it.
    target.setPointerCapture(pointerId);

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      onResize(moveEvent.clientY - startY);
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      if (divider !== null) delete divider.dataset.dragging;
      onResizeEnd();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  };

  return (
    <div
      ref={dividerRef}
      role="separator"
      aria-label="Resize the file tree"
      aria-orientation="horizontal"
      tabIndex={0}
      onKeyDown={(event) => {
        // The keyboard path a pointer-only divider owes: same clamping, one
        // row at a time, so the tree is reachable without a pointer.
        if (event.key === "ArrowUp") onResize(-KEYBOARD_RESIZE_STEP_PX);
        else if (event.key === "ArrowDown") onResize(KEYBOARD_RESIZE_STEP_PX);
        else return;
        event.preventDefault();
        onResizeEnd();
      }}
      className={cn(
        "relative z-10 h-px shrink-0 cursor-row-resize bg-border transition-colors",
        "hover:bg-ring/40 data-[dragging]:bg-ring/40",
        "focus-visible:bg-ring focus-visible:outline-none",
      )}
    >
      <div
        aria-hidden
        onPointerDown={handlePointerDown}
        className="absolute -top-1.5 left-0 h-3 w-full cursor-row-resize touch-none bg-transparent"
      />
    </div>
  );
}

/** One row of the tree, so a keyboard resize moves by something meaningful. */
const KEYBOARD_RESIZE_STEP_PX = 24;

/** Clipboard write with the same toast treatment as the toolbar's path copy. */
function copy(text: string, successMessage: string): void {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(successMessage))
    .catch(() => toast.error("Failed to copy"));
}

function Rows({
  activePath,
  activeRowRef,
  expanded,
  level,
  nodes,
  onContextMenu,
  onOpenFile,
  onToggle,
}: {
  activePath: string;
  activeRowRef: React.RefObject<HTMLButtonElement | null>;
  expanded: ReadonlySet<string>;
  level: number;
  nodes: readonly TreeNode[];
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onOpenFile: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.kind === "directory";
        const isOpen = isDirectory && expanded.has(node.path);
        const isActive = !isDirectory && node.path === activePath;
        return (
          <div key={node.path}>
            <button
              type="button"
              ref={isActive ? activeRowRef : undefined}
              onClick={() =>
                isDirectory ? onToggle(node.path) : onOpenFile(node.path)
              }
              onContextMenu={(event) => onContextMenu(event, node)}
              title={node.path}
              aria-expanded={isDirectory ? isOpen : undefined}
              aria-current={isActive ? "true" : undefined}
              style={{ paddingLeft: 8 + level * INDENT_PER_LEVEL_PX }}
              className={cn(
                "flex h-6 w-full cursor-pointer items-center gap-1 pr-2 text-left text-sm",
                "hover:bg-state-hover",
                isActive
                  ? "bg-state-hover font-medium text-file-accent"
                  : "text-foreground",
              )}
            >
              <span className="flex size-3 shrink-0 items-center justify-center text-subtle-foreground">
                {isDirectory ? <Chevron isOpen={isOpen} /> : null}
              </span>
              <span className="truncate">{node.name}</span>
            </button>
            {isDirectory && isOpen ? (
              <Rows
                activePath={activePath}
                activeRowRef={activeRowRef}
                expanded={expanded}
                level={level + 1}
                nodes={node.children}
                onContextMenu={onContextMenu}
                onOpenFile={onOpenFile}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-3 transition-transform", isOpen && "rotate-90")}
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Message({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
