import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { cn } from "./lib/utils";
import { Disc } from "./Disc";
import { StatusGlyph } from "./StatusGlyph";
import { childrenOf, threadDisplayTitle } from "./inbox";

const MAX_DISCS = 3;
const CHILD_MENU_VIEWPORT_GUTTER = 8;

interface CompactViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  safeAreaLeft: number;
  safeAreaTop: number;
  safeAreaRight: number;
  safeAreaBottom: number;
}

function clampCompactMenuLeft({
  triggerRight,
  menuWidth,
  viewport,
}: {
  triggerRight: number;
  menuWidth: number;
  viewport: CompactViewportBounds;
}) {
  const minLeft =
    viewport.left + viewport.safeAreaLeft + CHILD_MENU_VIEWPORT_GUTTER;
  const maxLeft = Math.max(
    minLeft,
    viewport.left +
      viewport.width -
      viewport.safeAreaRight -
      CHILD_MENU_VIEWPORT_GUTTER -
      menuWidth,
  );
  return Math.min(Math.max(triggerRight - menuWidth, minLeft), maxLeft);
}

function parsePixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The home for child threads the flat list hides: a chip in the thread header
 * that opens the list of this thread's children.
 *
 * These are bb CHILD THREADS — forks, side chats, and plugin-spawned threads.
 * bb's in-turn subagents are activity counters on the parent, not threads, so
 * the label deliberately says "children".
 */
export function SubagentsChip({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const { threads } = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const safeAreaProbeRef = useRef<HTMLSpanElement>(null);
  const [compactViewport, setCompactViewport] =
    useState<CompactViewportBounds | null>(null);
  const [compactMenuLeft, setCompactMenuLeft] = useState(
    CHILD_MENU_VIEWPORT_GUTTER,
  );
  const [compactMenuTop, setCompactMenuTop] = useState(
    CHILD_MENU_VIEWPORT_GUTTER,
  );
  const [compactMenuMaxHeight, setCompactMenuMaxHeight] = useState<
    string | undefined
  >();

  const updateCompactViewport = useCallback(() => {
    const visualViewport = window.visualViewport;
    const safeAreaProbe = safeAreaProbeRef.current;
    const safeArea = safeAreaProbe ? getComputedStyle(safeAreaProbe) : null;
    const next: CompactViewportBounds = {
      left: visualViewport?.offsetLeft ?? 0,
      top: visualViewport?.offsetTop ?? 0,
      width: visualViewport?.width ?? window.innerWidth,
      height: visualViewport?.height ?? window.innerHeight,
      safeAreaLeft: parsePixelValue(safeArea?.paddingLeft ?? ""),
      safeAreaTop: parsePixelValue(safeArea?.paddingTop ?? ""),
      safeAreaRight: parsePixelValue(safeArea?.paddingRight ?? ""),
      safeAreaBottom: parsePixelValue(safeArea?.paddingBottom ?? ""),
    };
    setCompactViewport((current) =>
      current?.left === next.left &&
      current.top === next.top &&
      current.width === next.width &&
      current.height === next.height &&
      current.safeAreaLeft === next.safeAreaLeft &&
      current.safeAreaTop === next.safeAreaTop &&
      current.safeAreaRight === next.safeAreaRight &&
      current.safeAreaBottom === next.safeAreaBottom
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open || !isCompactViewport) return;

    updateCompactViewport();
    const viewport = window.visualViewport;
    window.addEventListener("resize", updateCompactViewport);
    viewport?.addEventListener("resize", updateCompactViewport);
    viewport?.addEventListener("scroll", updateCompactViewport);
    return () => {
      window.removeEventListener("resize", updateCompactViewport);
      viewport?.removeEventListener("resize", updateCompactViewport);
      viewport?.removeEventListener("scroll", updateCompactViewport);
    };
  }, [isCompactViewport, open, updateCompactViewport]);

  useLayoutEffect(() => {
    if (!open || !isCompactViewport || !compactViewport) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = menu.getBoundingClientRect().width;
    if (menuWidth <= 0) return;
    setCompactMenuLeft(
      clampCompactMenuLeft({
        triggerRight: triggerRect.right,
        menuWidth,
        viewport: compactViewport,
      }),
    );
    const minTop =
      compactViewport.top +
      compactViewport.safeAreaTop +
      CHILD_MENU_VIEWPORT_GUTTER;
    const viewportBottom =
      compactViewport.top +
      compactViewport.height -
      compactViewport.safeAreaBottom -
      CHILD_MENU_VIEWPORT_GUTTER;
    const top = Math.min(
      Math.max(triggerRect.bottom + CHILD_MENU_VIEWPORT_GUTTER, minTop),
      Math.max(minTop, viewportBottom),
    );
    setCompactMenuTop(top);
    setCompactMenuMaxHeight(
      `min(32rem, ${Math.max(0, viewportBottom - top)}px)`,
    );
  }, [compactViewport, isCompactViewport, open]);

  const children = childrenOf(threads, threadId);
  if (children.length === 0) return null;

  const needsYou = children.some((child) => child.hasPendingInteraction);
  const label = needsYou ? "Needs you" : `${children.length} children`;

  return (
    <span className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`${children.length} child threads`}
        onClick={() => {
          if (!open && isCompactViewport) updateCompactViewport();
          setOpen((value) => !value);
        }}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full border border-border px-2 text-2xs text-muted-foreground",
          "hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        <DiscCluster threads={children} />
        {isCompactViewport ? null : <span className="truncate">{label}</span>}
      </button>
      {isCompactViewport ? (
        <span
          ref={safeAreaProbeRef}
          data-child-menu-safe-area-probe=""
          aria-hidden
          className="pointer-events-none fixed invisible size-0"
          style={{
            paddingLeft: "env(safe-area-inset-left)",
            paddingTop: "env(safe-area-inset-top)",
            paddingRight: "env(safe-area-inset-right)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        />
      ) : null}
      {open ? (
        <>
          {/* Click-away. Wide headers anchor the menu to this chip; compact
              headers pin it to the viewport so it cannot run off-screen. */}
          <span
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Child threads"
            className={cn(
              "z-50 flex max-h-[min(32rem,calc(100dvh-6rem))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg",
              isCompactViewport ? "fixed" : "absolute right-0 top-9",
            )}
            style={
              isCompactViewport
                ? {
                    left: compactMenuLeft,
                    top: compactMenuTop,
                    maxHeight: compactMenuMaxHeight,
                    maxWidth: compactViewport
                      ? Math.max(
                          0,
                          compactViewport.width -
                            compactViewport.safeAreaLeft -
                            compactViewport.safeAreaRight -
                            CHILD_MENU_VIEWPORT_GUTTER * 2,
                        )
                      : undefined,
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
              <span className="text-xs font-semibold">Children</span>
              <span className="ml-auto text-2xs text-muted-foreground">
                {children.length}
              </span>
            </div>
            <ul className="flex min-h-0 touch-pan-y flex-col gap-px overflow-y-auto overscroll-contain p-1.5 pt-0.5 [-webkit-overflow-scrolling:touch]">
              {children.map((child) => (
                <li key={child.id} className="list-none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      actions.open(child.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <Disc thread={child} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs">
                        {threadDisplayTitle(child)}
                      </span>
                      <span className="truncate text-2xs text-muted-foreground">
                        {child.originKind ?? "thread"}
                      </span>
                    </span>
                    <StatusGlyph
                      indicator={child.indicator}
                      label={child.indicatorLabel}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </span>
  );
}

function DiscCluster({ threads }: { threads: readonly PluginSidebarThread[] }) {
  const shown = threads.slice(0, MAX_DISCS);
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((thread, index) => (
        <span key={thread.id} className={cn(index > 0 && "-ml-1.5")}>
          <Disc thread={thread} />
        </span>
      ))}
      {threads.length > MAX_DISCS ? (
        <span className="-ml-1.5">
          <Disc thread={null} />
        </span>
      ) : null}
    </span>
  );
}
