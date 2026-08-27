/**
 * Deterministic fixtures of the real bb UI with every pluggable surface marked.
 * Layout and ordering mirror the real components in apps/app (audited against
 * AppSidebar, ThreadDetailHeader, ConversationMessageContent, MessageActionBar,
 * FollowUpPromptBox/PromptBoxInternal, ThreadSecondaryPanel, RootComposeView,
 * and PluginSettings); plugin contributions render highlighted, in the exact
 * spot the host inserts them.
 *
 * The regions covered by anatomy-manifest.json (sidebar sections, sidebar
 * footer, message action bar) render FROM the manifest, and a test in
 * apps/app renders the real components and asserts the same DOM order, so an
 * app-side reorder fails tests until the manifest, and these fixtures,
 * update.
 *
 * Marks are anchors that expand the matching sidebar row and sync hover state
 * through SurfaceMapContext. The exported *_MARKS arrays are the contract with
 * surfaces.ts: surfaces.test.ts asserts every surface in a visual group is
 * marked exactly once.
 */
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowMoveDownLeftIcon,
  ArrowUp01Icon,
  ArrowRight01Icon,
  Bug01Icon,
  Copy01Icon,
  File01Icon,
  Folder01Icon,
  GitBranchIcon,
  InformationCircleIcon,
  MessageAdd01Icon,
  Mic01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  ElectricPlugsIcon,
  Search01Icon,
  Settings02Icon,
  SparklesIcon,
  PlusMinusSquare01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  ToolboxIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import {
  annotationChipClass,
  annotationChipCounterScale,
  CHIP_PLACEMENT_CLASS,
  FOCUS_RING_CLASS,
  type AnnotationChipPlacement,
} from "./annotation";
import anatomy from "./anatomy-manifest.json";

export interface SurfaceMapState {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /**
   * The surface whose sidebar row is open. Markers use it alongside
   * `activeId` so a marker and its row are never in different states.
   */
  expandedId?: string | null;
  /**
   * When set, only this surface's marker stays lit; every other region of the
   * fixture recedes. Lets one diagram serve as a per-surface illustration
   * instead of shipping a cropped image per surface.
   */
  spotlightId?: string | null;
  numberOf: (id: string) => number | null;
  /**
   * Resolves a shipped plugin's page URL, or null when this host has no page
   * for it. Supplied by the bb plugin, which can ask the running host; the
   * docs website has no host and so supplies nothing.
   */
  pluginPageHref?: (displayName: string) => string | null;
  /**
   * When provided, clicking a marker calls this instead of following the
   * `#surface-<id>` anchor — the sidebar-nav layout uses it to expand the
   * matching nav row in place.
   */
  onSelect?: (id: string) => void;
  /**
   * The slide currently on stage, so a card naming another surface can tell
   * whether that surface is on this page or another one.
   */
  currentGroupId?: string;
  /**
   * Pans to the slide holding a surface and opens its card. Absent outside
   * the carousel, where there is nothing to pan.
   */
  onGoToSurface?: (id: string) => void;
}

export const SurfaceMapContext = createContext<SurfaceMapState | null>(null);

export function useSurfaceMap(): SurfaceMapState {
  const state = useContext(SurfaceMapContext);
  if (!state) {
    throw new Error("useSurfaceMap must be used inside a SurfaceMapContext");
  }
  return state;
}

export const APP_SHELL_MARKS = [
  "nav-panel",
  "thread-list",
  "thread-row-status",
  "sidebar-footer",
  "thread-header",
  "message-directives",
  "message-actions",
  "pending-interaction",
  "code-renderers",
  "thread-panel",
  "file-opener",
  "timeline-renderers",
  "content-scripts",
] as const;

export const COMMAND_PALETTE_MARKS = ["command-palette-actions"] as const;

export const COMPOSER_MARKS = [
  "composer-banners",
  "mention-provider",
  "composer-rich-text",
  "composer-state",
  "composer-plus-menu",
  "provider-picker",
  "composer-actions",
] as const;

export const COMPOSE_MARKS = ["homepage-section", "new-thread-panel"] as const;

export const EXTENSIONS_MARKS = ["plugin-status"] as const;

export const SETTINGS_MARKS = [
  "declarative-settings",
  "settings-section",
] as const;

/* ── primitives ─────────────────────────────────────────────────────── */

/**
 * The shared engagement triple every annotation reads. `active` drives the
 * chip fill (an open card's marker stays lit); `outlined` is exclusive so two
 * outlines are never on screen to overlap; `dimmed` recedes everything but a
 * spotlighted surface.
 */
function useEngagement(id: string) {
  const { activeId, expandedId, spotlightId } = useSurfaceMap();
  return {
    active: activeId === id || expandedId === id || spotlightId === id,
    outlined:
      activeId !== null
        ? activeId === id
        : expandedId === id || spotlightId === id,
    dimmed: Boolean(spotlightId) && spotlightId !== id,
  };
}

/**
 * The engaged ring, applied to the target element itself. The ring's
 * geometry is the target's geometry by construction — never a separately
 * positioned box — so it wraps content, follows the target's own radius, and
 * survives any fixture edit.
 */
function engagedRingClass(outlined: boolean) {
  return outlined
    ? "bg-surface-selected/30 ring-1 ring-inset ring-surface-selected-border"
    : undefined;
}

function Mark({
  id,
  label,
  className,
  chip = "corner",
  showChip = true,
  onActivate,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  /** Where the numbered chip sits relative to this target — a declared
   * variant, never a per-instance offset. */
  chip?: AnnotationChipPlacement;
  /** Whether this region renders its own numbered chip. */
  showChip?: boolean;
  /** Runs the fixture interaction represented by this marker. */
  onActivate?: () => void;
  children?: ReactNode;
}) {
  const { setActiveId, numberOf, onSelect } = useSurfaceMap();
  const { active, outlined, dimmed } = useEngagement(id);
  return (
    <a
      data-guide-region={id}
      href={`#surface-${id}`}
      aria-label={`${label} — jump to details`}
      onClick={(event) => {
        onActivate?.();
        if (!onSelect) return;
        event.preventDefault();
        // A marker inside another marked region (the provider glyph in the
        // picker, the painted range in the draft) must open its own card, not
        // the enclosing one's.
        event.stopPropagation();
        onSelect(id);
      }}
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
      className={cn(
        // ring-inset keeps the outline inside this region's own bounds, so
        // it cannot bleed into a neighbor that shares an edge.
        "relative rounded-md ring-1 ring-inset transition-all",
        FOCUS_RING_CLASS,
        outlined
          ? "bg-surface-selected ring-surface-selected-border"
          : "ring-transparent hover:bg-state-hover",
        dimmed && "opacity-25",
        className,
      )}
    >
      {/* Markers ship in the prominent ink fill so they read as the page's
          interactive layer; the selected one switches to the timeline file
          accent. The ring punches the chip out of the mockup's grey bones. */}
      {showChip ? (
        <span
          aria-hidden
          data-guide-badge={id}
          className={annotationChipClass(
            active,
            // The ring is the only addition: it keeps the chip legible where it
            // overlaps the mockup's own grey bones.
            cn("absolute z-50 ring-2 ring-card", CHIP_PLACEMENT_CLASS[chip]),
          )}
        >
          {numberOf(id)}
        </span>
      ) : null}
      {children}
    </a>
  );
}

/**
 * How long the palette stays away after running the demo command — long
 * enough to read the checklist panel it opened, short enough that the
 * page's subject is never missing when the reader looks back.
 */
const RELEASE_DEMO_MS = 2400;

/** The palette row remains the real product action, separate from the badge. */
function CommandPaletteActionMark({ onRun }: { onRun: () => void }) {
  const id = "command-palette-actions";
  const { setActiveId } = useSurfaceMap();
  const { outlined, dimmed } = useEngagement(id);

  return (
    <button
      data-guide-region={id}
      type="button"
      role="option"
      aria-selected="true"
      onClick={onRun}
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
      data-guide-fixture="command-palette-action"
      className={cn(
        "flex w-full cursor-pointer items-center gap-1.5 rounded bg-state-hover px-2 py-1.5 text-left text-foreground ring-1 ring-inset transition-all",
        outlined ? "ring-surface-selected-border" : "ring-transparent",
        dimmed && "opacity-25",
      )}
    >
      <span>Run release checklist</span>
      <span className="ml-auto text-xs text-subtle-foreground">Plugins</span>
    </button>
  );
}

/**
 * An annotation whose boundary is the fixture element it describes.
 *
 * Unlike MeasuredBadge, this component measures nothing. Its interactive
 * layer fills the content wrapper, so the outline and marker move with that
 * content. The overlay is a sibling of `children`, so fixture content does
 * not have to become part of the interactive anchor.
 */
function RegionMark({
  id,
  label,
  className,
  chip = "corner",
  showChip = true,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  /** Where the numbered chip sits relative to this target — a declared
   * variant, never a per-instance offset. */
  chip?: AnnotationChipPlacement;
  /** Whether this region renders its own numbered chip. */
  showChip?: boolean;
  children: ReactNode;
}) {
  const { setActiveId, numberOf, onSelect } = useSurfaceMap();
  const { active, outlined, dimmed } = useEngagement(id);

  return (
    <div
      data-guide-region={id}
      className={cn("relative", dimmed && "opacity-25", className)}
    >
      <a
        href={`#surface-${id}`}
        aria-label={`${label} — jump to details`}
        onClick={
          onSelect
            ? (event) => {
                event.preventDefault();
                onSelect(id);
              }
            : undefined
        }
        onMouseEnter={() => setActiveId(id)}
        onMouseLeave={() => setActiveId(null)}
        onFocus={() => setActiveId(id)}
        onBlur={() => setActiveId(null)}
        className={cn(
          "absolute inset-0 z-[1] rounded-md ring-1 ring-inset transition-all",
          FOCUS_RING_CLASS,
          outlined
            ? "bg-surface-selected/30 ring-surface-selected-border"
            : "ring-transparent hover:bg-state-hover",
        )}
      >
        {showChip ? (
          <span
            aria-hidden
            data-guide-badge={id}
            className={annotationChipClass(
              active,
              cn("absolute z-50 ring-2 ring-card", CHIP_PLACEMENT_CLASS[chip]),
            )}
          >
            {numberOf(id)}
          </span>
        ) : null}
      </a>
      {children}
    </div>
  );
}

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Chip diameter (annotationChipClass `size-5`) plus its breathing gap. */
const CHIP_SIZE = 20;
const CHIP_GAP = 8;

/**
 * A numbered chip whose position is measured from its anchor element instead
 * of authored. For annotations whose chip cannot live inside the target's
 * own subtree — exterior gutters, the tab lane, dialog margins — the chip
 * derives its place from the anchor's rendered box within the positioning
 * parent, so any fixture change moves the chip with it. Positions are
 * computed in layout coordinates (client deltas divided by the wrapper's
 * scale), which are invariant under the scale-together transform.
 *
 * Placement is measured at runtime, so static markup tests can assert this
 * chip exists but not where it sits — the rendered QA sweep is the placement
 * gate for these badges.
 */
function MeasuredBadge({
  id,
  label,
  anchor,
  at,
  align = "center",
  onActivate,
}: {
  id: string;
  label: string;
  /** Selector for the anchor element, resolved inside the positioning parent. */
  anchor: string;
  /**
   * start/end: the exterior gutter columns beside the positioning parent,
   * vertically tracking the anchor; above: floating over the anchor; lane:
   * the reserved band above the window frame, horizontally tracking it.
   */
  at: "start" | "end" | "above" | "lane";
  /** Vertical alignment against the anchor for start/end placements. */
  align?: "center" | "end";
  /** Runs the fixture interaction represented by this badge. */
  onActivate?: () => void;
}) {
  const { setActiveId, numberOf, onSelect } = useSurfaceMap();
  const { active } = useEngagement(id);
  const ref = useRef<HTMLAnchorElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useBrowserLayoutEffect(() => {
    const element = ref.current;
    const container = element?.offsetParent;
    if (!element || !(container instanceof HTMLElement)) return;
    // Anchors can live outside the positioning parent (a sibling frame), so
    // resolve within the slide; ids repeat across slides, so never wider.
    const scope =
      container.closest<HTMLElement>("[data-map-section]") ?? container;
    const target = scope.querySelector<HTMLElement>(anchor);
    if (!target) return;

    // Layout offsets, never client rects: offsetLeft/offsetTop are
    // transform-independent, so the math is exact even while the fixture's
    // scale transition is mid-glide (a client-rect ÷ target-scale reading
    // is only valid at rest, and nothing re-fires when a pure transform
    // settles). Target and container may live in sibling subtrees (the
    // exterior layer), so both accumulate to the document and subtract.
    // Known ≤1px caveat: offsetLeft/offsetTop do not include the borders of
    // positioned intermediate offsetParents (WindowFrame's 1px border is one
    // hop for in-frame anchors) — negligible today, but a thick-bordered
    // frame would need border-width compensation here.
    const layoutOrigin = (element: HTMLElement) => {
      let x = 0;
      let y = 0;
      let node: HTMLElement | null = element;
      while (node) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node =
          node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
      }
      return { x, y };
    };
    const measure = () => {
      // Chips counter-scale to stay legible inside a shrunken fixture, so
      // every gap and clamp below is measured against the chip's effective
      // footprint, not its authored one. The element keeps its authored
      // layout box and grows about its own center, so the final left/top
      // shifts back by half the difference.
      const strategy = container.closest<HTMLElement>(
        "[data-guide-responsive-strategy]",
      );
      const counterScale = annotationChipCounterScale(
        Number(strategy?.dataset.guideScale ?? "1"),
      );
      const chipBox = CHIP_SIZE * counterScale;
      const chipGap = CHIP_GAP * counterScale;
      const chipTuck = 4 * counterScale;
      const recenter = (chipBox - CHIP_SIZE) / 2;
      const containerOrigin = layoutOrigin(container);
      const targetOrigin = layoutOrigin(target);
      const local = {
        left: targetOrigin.x - containerOrigin.x,
        top: targetOrigin.y - containerOrigin.y,
        width: target.offsetWidth,
        height: target.offsetHeight,
      };
      const centerY = local.top + local.height / 2 - chipBox / 2;
      const anchoredY =
        align === "end" ? local.top + local.height - chipBox : centerY;
      // The exterior columns and the lane derive from the window frame's own
      // box: chips sit just outside the frame edge (inside the slide gutter,
      // so nothing clips them) and the lane centers in the band the gutter
      // reserves above the frame. Without a frame, the container stands in.
      const frame = container.querySelector<HTMLElement>("[data-guide-frame]");
      const frameOrigin = frame ? layoutOrigin(frame) : containerOrigin;
      const frameWidth = frame ? frame.offsetWidth : container.offsetWidth;
      const frameLocal = {
        left: frameOrigin.x - containerOrigin.x,
        right: frameOrigin.x - containerOrigin.x + frameWidth,
        top: frameOrigin.y - containerOrigin.y,
      };
      const next =
        at === "start"
          ? { left: frameLocal.left - chipBox - chipGap, top: anchoredY }
          : at === "end"
            ? { left: frameLocal.right + chipGap, top: anchoredY }
            : at === "above"
              ? {
                  left: local.left + local.width / 2 - chipBox / 2,
                  top: local.top - chipBox - chipTuck,
                }
              : {
                  left: local.left + local.width / 2 - chipBox / 2,
                  top: Math.max(0, (frameLocal.top - chipBox) / 2),
                };
      // A container inside a clipping window frame (the palette dialog)
      // cannot hang chips past that frame's edge — they would clip to
      // nothing. Clamp into the frame's interior instead; the chip then
      // rides the container's edge when the frame leaves no margin.
      const clippingFrame =
        container.closest<HTMLElement>("[data-guide-frame]");
      if (clippingFrame) {
        const clipOrigin = layoutOrigin(clippingFrame);
        const clipLeft = clipOrigin.x - containerOrigin.x;
        next.left = Math.min(
          Math.max(next.left, clipLeft + chipTuck),
          clipLeft + clippingFrame.offsetWidth - chipBox - chipTuck,
        );
      }
      // The annotation gutter is authored for a chip at its own size, so a
      // counter-scaled chip can outgrow it. A chip that left the slide would
      // be clipped away entirely; riding the frame edge keeps it visible and
      // clickable, which is what the chip is for. The gutter still holds it
      // whenever the fixture is roomy enough not to counter-scale much.
      const clamp = (value: number, extent: number) =>
        Math.max(0, Math.min(value, Math.max(0, extent - chipBox)));
      next.left = clamp(next.left, container.offsetWidth);
      next.top = clamp(next.top, container.offsetHeight);
      next.left += recenter;
      next.top += recenter;
      setPosition((current) =>
        current &&
        Math.abs(current.left - next.left) < 0.5 &&
        Math.abs(current.top - next.top) < 0.5
          ? current
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(target);
    const scaleWrapper = container.closest<HTMLElement>(
      "[data-guide-responsive-strategy]",
    );
    if (scaleWrapper) observer.observe(scaleWrapper);
    return () => observer.disconnect();
  }, [anchor, at, align]);

  return (
    <a
      ref={ref}
      data-guide-badge={id}
      data-guide-badge-placement={at}
      href={`#surface-${id}`}
      aria-label={`${label} — jump to details`}
      onClick={(event) => {
        onActivate?.();
        if (!onSelect) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(id);
      }}
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
      className={cn("pointer-events-auto absolute z-50", FOCUS_RING_CLASS)}
      style={position ?? undefined}
    >
      <span
        aria-hidden
        className={annotationChipClass(active, "ring-2 ring-card")}
      >
        {numberOf(id)}
      </span>
    </a>
  );
}

function MiniIcon({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

/** A plugin-contributed control: electric-plug glyph, drawn in the ink color. */
function PluginGlyph({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ElectricPlugsIcon}
      className={cn("size-4 shrink-0 text-foreground", className)}
    />
  );
}

function WindowFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-guide-frame
      className={cn(
        // A raised surface, not the raw canvas: in dark themes shadows
        // vanish and a same-canvas frame dissolves into the page (the
        // standard dark-mode answer is a surface step — Material elevation,
        // macOS windows). The token derives from --canvas/--ink, so light
        // themes get a subtle lift and custom palettes stay tinted.
        "select-none overflow-hidden rounded-lg border border-border bg-surface-raised-solid text-xs leading-none text-muted-foreground shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TrafficLights() {
  return (
    <span aria-hidden className="flex items-center gap-1.5">
      <span className="size-2 rounded-full bg-muted" />
      <span className="size-2 rounded-full bg-muted" />
      <span className="size-2 rounded-full bg-muted" />
    </span>
  );
}

/* ── the main app window ────────────────────────────────────────────── */

const SIDEBAR_THREADS: readonly { title: string; glyph?: "spin" | "dot" }[] = [
  { title: "Fix flaky checkout tests", glyph: "spin" },
  { title: "Refactor settings page" },
  { title: "Ship dark mode", glyph: "dot" },
];

/**
 * Sidebar footer icons, in anatomy-manifest order: Settings, then plugin
 * footer actions, then Report a bug (mirrors AppSidebar's SidebarFooter).
 */
const FOOTER_ITEM_RENDERERS: Record<string, () => ReactNode> = {
  settings: () => <MiniIcon icon={Settings02Icon} className="size-4" />,
  "plugin-footer-actions": () => (
    <span className="flex size-5.5 items-center justify-center rounded-md bg-state-hover">
      <PluginGlyph className="size-3.5" />
    </span>
  ),
  "bug-report": () => <MiniIcon icon={Bug01Icon} className="size-4" />,
};

/**
 * Sidebar sections, in anatomy-manifest order (mirrors AppSidebar.tsx:
 * top-reserve chrome, the New-thread/search-action block, plugin nav rows, the
 * scrolling thread list, the footer).
 */
const SIDEBAR_SECTION_RENDERERS: Record<string, () => ReactNode> = {
  "top-reserve": () => (
    <div
      data-guide-fixture="sidebar-top-reserve"
      className="flex h-12 items-center justify-end px-2"
    >
      <MiniIcon icon={ArrowLeft01Icon} className="size-3.5" />
      <MiniIcon icon={ArrowRight01Icon} className="ml-1.5 size-3.5" />
    </div>
  ),
  "primary-actions": () => (
    <div
      data-guide-fixture="sidebar-primary-actions"
      className="flex items-center gap-2 px-2.5 py-2.5"
    >
      <span className="flex h-6.5 flex-1 items-center gap-2 rounded-md px-2 text-foreground">
        <MiniIcon icon={PlusSignIcon} className="text-foreground" />
        New thread
      </span>
      <MiniIcon icon={Search01Icon} />
    </div>
  ),
  "plugin-nav": () => (
    <Mark
      id="nav-panel"
      label="Plugin nav panels, above the thread list"
      className="mx-1.5 px-1.5 pb-2.5 pt-1"
      showChip={false}
    >
      <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
        <MiniIcon icon={ToolboxIcon} />
        Extensions
      </span>
      {/* The active row uses the sidebar's own accent, exactly like the
          real nav row (PluginNavSidebarItems). */}
      <span className="flex h-6.5 items-center gap-2 rounded-md bg-sidebar-accent px-2 font-medium text-sidebar-foreground">
        <PluginGlyph />
        Your panel
      </span>
    </Mark>
  ),
  "thread-list": () => (
    <RegionMark
      id="thread-list"
      label="The thread list, replaceable by one plugin"
      className="mx-1.5 flex-1 px-1.5 py-1.5"
      showChip={false}
    >
      <span className="block px-2 pb-1 pt-1.5 text-xs text-subtle-foreground/75">
        Pinned
      </span>
      {SIDEBAR_THREADS.map((thread) => (
        <span
          key={thread.title}
          className="flex h-6.5 items-center gap-2 rounded-md px-2"
        >
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          {thread.glyph === "spin" ? (
            // A running status on the row: the glyph a plugin's thread row
            // status replaces. Its own marker, inside the thread list's.
            <Mark
              id="thread-row-status"
              label="A thread row status set by a plugin"
              className="z-[2] flex size-5 shrink-0 items-center justify-center"
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full border border-muted-foreground border-t-transparent"
              />
            </Mark>
          ) : thread.glyph === "dot" ? (
            <span aria-hidden className="size-2 rounded-full bg-success" />
          ) : null}
        </span>
      ))}
      <span className="block px-2 pb-1 pt-2 text-xs text-subtle-foreground/75">
        Projects
      </span>
      {["acme-app", "dotfiles"].map((project) => (
        <span
          key={project}
          className="flex h-6.5 items-center gap-1.5 rounded-md px-2"
        >
          <span className="min-w-0 truncate">{project}</span>
          <MiniIcon icon={ArrowRight01Icon} className="size-3.5" />
        </span>
      ))}
    </RegionMark>
  ),
  footer: () => (
    <Mark
      id="sidebar-footer"
      label="Plugin footer buttons, between Settings and Report a bug"
      className="mx-1.5 mb-1.5 flex w-fit items-center gap-2 px-2.5 py-2"
    >
      {anatomy.sidebarFooter.map((key) => (
        <Fragment key={key}>{FOOTER_ITEM_RENDERERS[key]?.()}</Fragment>
      ))}
    </Mark>
  ),
};

/**
 * Message action bar icons, in anatomy-manifest order: the five host actions,
 * then plugin actions (mirrors MessageActionBar.tsx).
 */
const MESSAGE_ACTION_RENDERERS: Record<string, () => ReactNode> = {
  copy: () => <MiniIcon icon={Copy01Icon} className="size-3.5" />,
  edit: () => <MiniIcon icon={PencilEdit01Icon} className="size-3.5" />,
  "add-to-chat": () => <MiniIcon icon={PlusSignIcon} className="size-3.5" />,
  "send-to-main-thread": () => (
    <MiniIcon icon={ArrowLeft01Icon} className="size-3.5" />
  ),
  fork: () => <MiniIcon icon={GitBranchIcon} className="size-3.5" />,
  "plugin-actions": () => <PluginGlyph className="size-3.5" />,
};

/** Registry coverage, checked against the manifest by surfaces.test.ts. */
export const ANATOMY_RENDERER_KEYS = {
  appSidebar: Object.keys(SIDEBAR_SECTION_RENDERERS),
  sidebarFooter: Object.keys(FOOTER_ITEM_RENDERERS),
  messageActionBar: Object.keys(MESSAGE_ACTION_RENDERERS),
};

export type AppShellRightPanelTab =
  | "thread-panel"
  | "file-opener"
  | "code-renderers";

/**
 * The three right-panel tab chips ride the lane the gutter reserves above the
 * window frame, each measured from its own tab element — the lane layer no
 * longer duplicates the panel's geometry.
 */
function RightPanelTabLaneBadges({
  onTabSelect,
}: {
  onTabSelect: (tab: AppShellRightPanelTab) => void;
}) {
  return (
    <>
      <MeasuredBadge
        id="code-renderers"
        label="Plugin code and diff renderers on bb's Diff tab"
        anchor='[data-guide-region="code-renderers"]'
        at="lane"
        onActivate={() => onTabSelect("code-renderers")}
      />
      <MeasuredBadge
        id="thread-panel"
        label="A plugin tab in the thread side panel"
        anchor='[data-guide-region="thread-panel"]'
        at="lane"
        onActivate={() => onTabSelect("thread-panel")}
      />
      <MeasuredBadge
        id="file-opener"
        label="A plugin file viewer or editor tab"
        anchor='[data-guide-region="file-opener"]'
        at="lane"
        onActivate={() => onTabSelect("file-opener")}
      />
    </>
  );
}

/**
 * A whole-window command-palette flow. The fixture starts with the palette
 * open over a real thread-shaped backdrop; running the plugin row closes it
 * and opens the plugin's thread-panel tab, just as the registered action can.
 */
export function CommandPaletteWireframe() {
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [releasePanelOpen, setReleasePanelOpen] = useState(false);
  const restoreTimer = useRef<number | undefined>(undefined);

  const openPalette = () => setPaletteOpen(true);
  // Running the command closes the palette just long enough to show its
  // outcome — the checklist panel opening — then the palette restores
  // itself. The palette is this page's subject, so it can never be left
  // dismissed; the panel stays open behind it as the run's lasting effect.
  const runReleaseChecklist = () => {
    setPaletteOpen(false);
    setReleasePanelOpen(true);
    window.clearTimeout(restoreTimer.current);
    restoreTimer.current = window.setTimeout(
      () => setPaletteOpen(true),
      RELEASE_DEMO_MS,
    );
  };
  useEffect(() => () => window.clearTimeout(restoreTimer.current), []);

  return (
    <div
      data-guide-fixture="command-palette-flow"
      data-guide-state={paletteOpen ? "palette-open" : "release-checklist-open"}
      className="relative px-7 pb-2 pt-4"
    >
      <WindowFrame>
        <div className="relative min-h-[500px]">
          <div
            data-guide-fixture="command-palette-thread"
            className="flex min-h-[500px] bg-background"
          >
            <aside className="flex w-48 shrink-0 flex-col border-r border-border-seam bg-sidebar px-2.5 py-3">
              <div className="flex items-center gap-1.5 px-1 text-foreground">
                <TrafficLights />
                <span className="ml-auto" />
                <MiniIcon icon={SidebarLeftIcon} className="size-3.5" />
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground">
                <MiniIcon icon={PlusSignIcon} className="size-3.5" />
                New thread
              </div>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
                <MiniIcon icon={Search01Icon} className="size-3.5" />
                Search
              </div>
              <div className="mt-3 px-2 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
                Threads
              </div>
              <div className="mt-1 rounded-md bg-state-hover px-2 py-2 text-foreground">
                Ship release candidate
              </div>
              <div className="px-2 py-2">Fix flaky checkout tests</div>
              <div className="px-2 py-2">Update onboarding copy</div>
              <div className="mt-auto flex items-center gap-2 border-t border-border-hairline px-2 pt-3">
                <MiniIcon icon={Settings02Icon} className="size-3.5" />
                Settings
              </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
              <header className="flex h-12 items-center gap-2 border-b border-border-hairline px-4">
                <span className="truncate text-foreground">
                  Ship release candidate
                </span>
                <MiniIcon icon={MoreHorizontalIcon} className="size-3.5" />
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={openPalette}
                  aria-label="Open Quick palette (Shift Command P)"
                  data-guide-fixture="command-palette-shortcut"
                  className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-hairline px-2 text-subtle-foreground hover:bg-state-hover hover:text-foreground"
                >
                  <MiniIcon icon={Search01Icon} className="size-3.5" />
                  <span>Quick palette</span>
                  <kbd className="rounded bg-surface-recessed px-1.5 py-0.5 font-mono text-2xs text-foreground">
                    ⇧⌘P
                  </kbd>
                </button>
              </header>

              <div className="flex-1 space-y-5 px-6 py-6">
                <div className="flex justify-end">
                  <span className="max-w-[76%] rounded-xl border border-border-seam bg-surface-recessed px-3 py-2 leading-relaxed text-foreground">
                    Prepare this branch for the release candidate.
                  </span>
                </div>
                <div className="max-w-[88%] space-y-3 leading-relaxed">
                  <p className="text-foreground">
                    The release build is ready for final checks. I verified the
                    focused tests and collected the latest UI evidence.
                  </p>
                  <div className="space-y-2 rounded-lg border border-border-hairline bg-surface-raised-solid p-3">
                    <div className="flex items-center gap-2 text-foreground">
                      <MiniIcon icon={GitBranchIcon} className="size-3.5" />
                      release/2026-08-25
                    </div>
                    <div className="h-1.5 w-4/5 rounded-sm bg-muted/60" />
                    <div className="h-1.5 w-3/5 rounded-sm bg-muted/60" />
                  </div>
                </div>
              </div>

              <div className="mx-5 mb-5 rounded-xl border border-border bg-card px-3 py-3 text-subtle-foreground shadow-sm">
                Ask for a follow-up…
              </div>
            </main>

            {releasePanelOpen ? (
              <aside
                data-guide-fixture="release-checklist-panel"
                className="flex w-60 shrink-0 flex-col border-l border-border-seam bg-sidebar"
              >
                <div className="flex h-12 items-center gap-1.5 border-b border-border-hairline px-3">
                  <span className="flex size-7 items-center justify-center rounded-md">
                    <MiniIcon
                      icon={InformationCircleIcon}
                      className="size-3.5"
                    />
                  </span>
                  <span
                    role="tab"
                    aria-selected="true"
                    data-guide-fixture="release-checklist-tab"
                    className="flex h-7 items-center gap-1.5 rounded-md bg-state-hover px-2 text-foreground"
                  >
                    <PluginGlyph className="size-3.5" />
                    Release checklist
                  </span>
                </div>
                <div className="space-y-4 p-4">
                  <div>
                    <p className="font-medium text-foreground">
                      Release checklist
                    </p>
                    <p className="mt-1 leading-relaxed text-subtle-foreground">
                      Final checks for this thread and branch.
                    </p>
                  </div>
                  {[
                    ["Tests and typecheck", "Passed"],
                    ["UI evidence", "Ready"],
                    ["Mergeability", "Clean"],
                  ].map(([label, status]) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 border-t border-border-hairline pt-3"
                    >
                      <span className="size-2 rounded-full bg-success" />
                      <span className="min-w-0 flex-1 text-foreground">
                        {label}
                      </span>
                      <span className="text-2xs text-subtle-foreground">
                        {status}
                      </span>
                    </div>
                  ))}
                </div>
              </aside>
            ) : null}
          </div>

          {paletteOpen ? (
            <div
              data-guide-fixture="command-palette-overlay"
              className="absolute inset-0 z-10 bg-black/40"
            >
              <div
                data-guide-fixture="command-palette-dialog"
                className="absolute left-1/2 top-[12%] grid w-full max-w-xl -translate-x-1/2 grid-cols-[minmax(0,1fr)] gap-0 overflow-visible rounded-lg border border-border bg-background shadow-sm"
              >
                <div className="flex items-center gap-2 border-b px-3 text-sm">
                  <MiniIcon
                    icon={Search01Icon}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <input
                    aria-label="Search commands"
                    readOnly
                    value=">release"
                    className="h-11 min-w-0 flex-1 bg-transparent text-foreground outline-none"
                  />
                </div>
                <div
                  role="listbox"
                  aria-label="Commands"
                  className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1 text-sm"
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left">
                    Open release notes
                    <span className="ml-auto text-muted-foreground">
                      Navigation
                    </span>
                  </span>
                  <CommandPaletteActionMark onRun={runReleaseChecklist} />
                  <span className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left">
                    Copy thread link
                    <span className="ml-auto text-muted-foreground">
                      Thread
                    </span>
                  </span>
                </div>
                {/* The numbered chip rides the row it annotates, measured from
                    the row's own box so palette content changes move it. */}
                <MeasuredBadge
                  id="command-palette-actions"
                  label="Plugin actions in bb's quick command palette"
                  anchor='[data-guide-region="command-palette-actions"]'
                  at="start"
                />
              </div>
            </div>
          ) : null}
        </div>
      </WindowFrame>
    </div>
  );
}

export function AppShellWireframe() {
  const { expandedId } = useSurfaceMap();
  const [rightPanelTab, setRightPanelTab] =
    useState<AppShellRightPanelTab>("thread-panel");

  // Card arrows can select these annotations without clicking their tab
  // markers. Keep the fixture body synchronized with whichever card is open
  // so every sequential step still demonstrates the surface it describes.
  useEffect(() => {
    if (
      expandedId === "thread-panel" ||
      expandedId === "file-opener" ||
      expandedId === "code-renderers"
    ) {
      setRightPanelTab(expandedId);
    }
  }, [expandedId]);

  return (
    // The padding is the annotation gutter: edge-hugging markers anchor to
    // this box and sit outside the frame, so they ring the diagram instead
    // of crowding its chrome.
    // Unlike the simpler slides, this dense three-column anatomy stays at a
    // readable minimum size. ProductMap supplies the single scroll owner so
    // the exterior gutter and all badges move with the frame.
    <div className="relative w-full px-10 pb-0 pt-[26px]">
      {/* The first two surfaces belong to the sidebar as a whole. Their chips
            ride the exterior gutter column, each measured from the region it
            annotates, while the in-frame regions remain independently
            clickable. */}
      <MeasuredBadge
        id="nav-panel"
        label="Plugin nav panels, above the thread list"
        anchor='[data-guide-region="nav-panel"]'
        at="start"
      />
      <MeasuredBadge
        id="thread-list"
        label="The thread list, replaceable by one plugin"
        anchor='[data-guide-region="thread-list"]'
        at="start"
      />
      {/* Content scripts have no slot of their own — they run across the
            whole window, so the badge and the engaged tint annotate the frame
            itself. */}
      <MeasuredBadge
        id="content-scripts"
        label="App-wide plugin scripts, running in the whole window"
        anchor="[data-guide-frame]"
        at="end"
        align="end"
      />
      <RightPanelTabLaneBadges onTabSelect={setRightPanelTab} />
      <AppShellWireframeBody
        rightPanelTab={rightPanelTab}
        onRightPanelTabSelect={setRightPanelTab}
      />
    </div>
  );
}

function AppShellWireframeBody({
  rightPanelTab,
  onRightPanelTabSelect,
}: {
  rightPanelTab: AppShellRightPanelTab;
  onRightPanelTabSelect: (tab: AppShellRightPanelTab) => void;
}) {
  const { expandedId } = useSurfaceMap();
  const [assistantMessageHovered, setAssistantMessageHovered] = useState(false);
  const contentScripts = useEngagement("content-scripts");
  const messageActionsSelected = expandedId === "message-actions";
  const messageActionRowVisible =
    assistantMessageHovered || messageActionsSelected;

  return (
    <WindowFrame className="relative">
      {/* Content scripts run across the whole window, so their target — and
          the engaged tint — is the frame itself, never a separately authored
          region. */}
      <span
        aria-hidden
        data-guide-target="content-scripts"
        className={cn(
          "pointer-events-none absolute inset-0 z-[5] rounded-lg",
          engagedRingClass(contentScripts.outlined),
        )}
      />
      {/* AppLayout owns this trigger as a pinned overlay. AppSidebar's top
          reserve deliberately contains only history navigation. */}
      <span
        aria-hidden
        data-guide-fixture="sidebar-trigger-overlay"
        className="absolute left-2 top-2.5 z-[4] flex size-7 items-center justify-center rounded-md"
      >
        <MiniIcon icon={SidebarLeftIcon} className="size-4" />
      </span>
      {/* Keep product chrome and the pending form at their real density. At
          bb's 1028px desktop viewport the 500px floor leaves every card above
          the fold; each extra viewport pixel then restores one pixel of blank
          canvas until the original 650px minimum is reached. Real content may
          still grow past that minimum rather than being clipped. */}
      <div className="flex min-h-[650px] items-stretch">
        {/* ── sidebar, sections in anatomy-manifest order ── */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border-seam bg-sidebar text-sidebar-foreground">
          {anatomy.appSidebar.map((key) => (
            <Fragment key={key}>{SIDEBAR_SECTION_RENDERERS[key]?.()}</Fragment>
          ))}
        </div>

        {/* ── thread view ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* header: title left; plugin action leads the right action row */}
          <div className="flex h-12 items-center gap-2 border-b border-border-hairline px-4">
            <span className="truncate text-foreground">
              Fix flaky checkout tests
            </span>
            <MiniIcon icon={MoreHorizontalIcon} className="size-3.5" />
            <span className="flex-1" />
            <Mark
              id="thread-header"
              label="Plugin thread-header control, left end of the action row"
              className="flex h-6.5 items-center gap-1 px-2"
            >
              <PluginGlyph className="size-3.5" />
            </Mark>
          </div>

          {/* timeline */}
          <div
            data-guide-fixture="app-window-timeline"
            className="min-h-[510px] flex-1 space-y-7 overflow-hidden px-5 py-6"
          >
            {/* user message: right-aligned bubble */}
            <div className="flex justify-end">
              <span className="max-w-[70%] rounded-xl border border-border-seam bg-surface-recessed px-2.5 py-2 leading-snug text-foreground">
                Fix the flaky checkout tests
              </span>
            </div>

            {/* plugin-owned row: bb retains the header while the plugin
                renderer supplies the expanded body beneath it */}
            <div className="w-[78%] space-y-1">
              <span className="flex items-center gap-1.5 text-foreground">
                <PluginGlyph className="size-3.5" />
                Re-ran checkout suite
                <span className="text-subtle-foreground">Completed</span>
              </span>
              <RegionMark
                id="timeline-renderers"
                label="Plugin-owned content inside a timeline entry"
                className="ml-5 block space-y-1 px-2.5 py-2"
                chip="side"
              >
                <div className="flex items-center gap-2" aria-hidden>
                  <span className="h-1.5 w-2/3 rounded-sm bg-muted/60" />
                  <span className="h-1.5 w-12 rounded-sm bg-foreground/40" />
                </div>
              </RegionMark>
            </div>

            {/* assistant message: plain prose + directive + action bar */}
            <div
              data-guide-fixture="assistant-message"
              onMouseEnter={() => setAssistantMessageHovered(true)}
              onMouseLeave={() => setAssistantMessageHovered(false)}
              onFocusCapture={() => setAssistantMessageHovered(true)}
              onBlurCapture={() => setAssistantMessageHovered(false)}
              className="w-[88%] space-y-2"
            >
              <p className="leading-relaxed">
                The retries cluster in two suites. Failure rate by suite:
              </p>
              <Mark
                id="message-directives"
                label="A plugin component rendered inline by a message directive"
                className="block w-3/5 px-2.5 py-2.5"
              >
                <span className="flex items-end gap-1.5" aria-hidden>
                  <span className="h-4 w-3.5 rounded-sm bg-muted" />
                  <span className="h-8 w-3.5 rounded-sm bg-foreground/40" />
                  <span className="h-2.5 w-3.5 rounded-sm bg-muted" />
                  <span className="h-6 w-3.5 rounded-sm bg-muted" />
                  <span className="h-2 w-3.5 rounded-sm bg-muted" />
                </span>
                <span className="mt-1.5 flex items-center gap-1.5">
                  <PluginGlyph className="size-3.5" />
                  ::your-directive
                </span>
              </Mark>
              <div className="space-y-1.5">
                {messageActionsSelected ? (
                  <div
                    aria-hidden
                    data-guide-fixture="message-action-selection-toolbar"
                    className="inline-flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 text-2xs text-foreground shadow-md"
                  >
                    <span className="flex items-center gap-1 rounded px-1.5 py-0.5">
                      <MiniIcon icon={MessageAdd01Icon} className="size-3.5" />
                      Add to chat
                    </span>
                    <span className="mx-0.5 h-4 w-px bg-border" />
                    <span className="flex items-center gap-1 rounded bg-state-hover px-1.5 py-0.5">
                      <PluginGlyph className="size-3.5" />
                      Your action
                    </span>
                  </div>
                ) : null}
                <p className="leading-relaxed">
                  Fixed by isolating the{" "}
                  <span
                    data-guide-fixture="message-action-selected-text"
                    className={cn(
                      "rounded-sm px-0.5",
                      messageActionsSelected &&
                        "bg-file-accent/25 text-foreground",
                    )}
                  >
                    Stripe mock
                  </span>{" "}
                  per test.
                </p>
              </div>
              {/* Reserve the real action row's height so hover never shifts
                  the message or the entries below it. */}
              <div className="flex h-7 items-start">
                <Mark
                  id="message-actions"
                  label="Plugin message actions, after the host actions"
                  className="inline-flex items-center px-2 py-1.5"
                >
                  <span
                    data-guide-fixture="message-action-hover-row"
                    className={cn(
                      "inline-flex items-center gap-2 transition-opacity",
                      messageActionRowVisible ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {anatomy.messageActionBar.map((key) => (
                      <Fragment key={key}>
                        {MESSAGE_ACTION_RENDERERS[key]?.()}
                      </Fragment>
                    ))}
                  </span>
                </Mark>
              </div>
            </div>
          </div>

          {/* pending interaction: replaces the prompt box, not the timeline */}
          <div className="space-y-2 border-t border-border-hairline p-4">
            <Mark
              id="pending-interaction"
              label="A plugin ask-the-user form, shown in place of the composer"
              className="block border border-border bg-card p-3"
            >
              <span className="flex items-center gap-1.5 text-foreground">
                <PluginGlyph className="size-3.5" />
                Pick a release channel
              </span>
              <span className="mt-2 flex gap-1.5" aria-hidden>
                <span className="h-5.5 flex-1 rounded-md border border-border" />
                <span className="flex h-5.5 items-center rounded-md border border-border px-2">
                  Cancel
                </span>
                <span className="flex h-5.5 items-center rounded-md bg-foreground px-2 text-background">
                  Submit
                </span>
              </span>
            </Mark>
          </div>
        </div>

        <AppShellRightPanel
          activeTab={rightPanelTab}
          onTabSelect={onRightPanelTabSelect}
        />
      </div>
    </WindowFrame>
  );
}

/**
 * The three annotated right-panel capabilities are tabs in the product. Their
 * numbered controls live in AppShellWireframe's exterior top layer; the host
 * row below stays at the product's real 48px height. Each marker selects its
 * tab before opening the corresponding Guide card, so the diagram and the
 * explanation always describe the same visible body.
 */
export function AppShellRightPanel({
  activeTab,
  onTabSelect,
}: {
  activeTab: AppShellRightPanelTab;
  onTabSelect: (tab: AppShellRightPanelTab) => void;
}) {
  const tabClass = (tab: AppShellRightPanelTab) =>
    cn(
      "flex h-7 shrink-0 items-center rounded-md",
      activeTab === tab && "bg-state-hover",
    );

  return (
    // Plain bg-sidebar, like the real ThreadSecondaryPanel — the real panel
    // is not the app's `.fixed.bg-sidebar` element, so it does not receive
    // the themed sidebar overlay.
    <div className="flex w-[380px] shrink-0 flex-col border-l border-border-seam bg-sidebar">
      <div
        data-guide-fixture="right-panel-tab-strip"
        className="flex h-12 items-center gap-1.5 border-b border-border-hairline px-3"
      >
        <span
          data-guide-fixture="right-panel-fixed-tabs"
          className="flex shrink-0 items-center gap-1.5"
        >
          <span
            data-guide-tab="info"
            className="flex h-6 items-center rounded-md px-1.5"
          >
            <MiniIcon icon={InformationCircleIcon} className="size-3.5" />
          </span>
          <Mark
            id="code-renderers"
            label="Plugin code and diff renderers on bb's Diff tab"
            className={cn(
              tabClass("code-renderers"),
              "gap-1.5 whitespace-nowrap pl-1.5 pr-2",
            )}
            showChip={false}
            onActivate={() => onTabSelect("code-renderers")}
          >
            <span data-guide-tab="code-renderers" className="contents">
              <MiniIcon icon={PlusMinusSquare01Icon} className="size-3.5" />
              <span className="text-foreground">Diff</span>
            </span>
          </Mark>
        </span>
        <span
          data-guide-fixture="right-panel-content-tabs"
          className="flex min-w-0 items-center gap-1.5"
        >
          <Mark
            id="thread-panel"
            label="A plugin tab in the thread side panel"
            className={cn(
              tabClass("thread-panel"),
              "gap-1.5 whitespace-nowrap pl-1.5 pr-2",
            )}
            showChip={false}
            onActivate={() => onTabSelect("thread-panel")}
          >
            <span data-guide-tab="thread-panel" className="contents">
              <PluginGlyph className="size-3.5" />
              <span className="text-foreground">Your tab</span>
            </span>
          </Mark>
          <Mark
            id="file-opener"
            label="A plugin file viewer or editor tab"
            className={cn(
              tabClass("file-opener"),
              "gap-1.5 whitespace-nowrap pl-1.5 pr-2",
            )}
            showChip={false}
            onActivate={() => onTabSelect("file-opener")}
          >
            <span data-guide-tab="file-opener" className="contents">
              <MiniIcon icon={File01Icon} className="size-3.5" />
              <span className="text-foreground">retry-notes.md</span>
            </span>
          </Mark>
        </span>
        <span className="flex-1" />
        <MiniIcon icon={PlusSignIcon} className="size-3.5" />
        <MiniIcon icon={SidebarRightIcon} className="size-3.5" />
      </div>
      <div data-guide-tab-body={activeTab} className="min-h-0 flex-1 p-4">
        {activeTab === "thread-panel" ? (
          <div data-guide-fixture="thread-panel" className="space-y-2">
            <div className="flex items-center gap-1.5 text-foreground">
              <PluginGlyph className="size-3.5" />
              Release checklist
            </div>
            <p className="leading-relaxed text-subtle-foreground">
              Your plugin owns this tab and receives the thread it was opened
              from.
            </p>
            <span className="block h-2 w-4/5 rounded-sm bg-muted/60" />
            <span className="block h-2 w-3/5 rounded-sm bg-muted/60" />
          </div>
        ) : activeTab === "file-opener" ? (
          <div data-guide-fixture="file-viewer" className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs text-subtle-foreground">
              <MiniIcon icon={File01Icon} className="size-3.5" />
              <span>docs</span>
              <span>/</span>
              <span className="text-foreground">retry-notes.md</span>
            </div>
            <article className="space-y-3 rounded-lg border border-border-hairline bg-background p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Checkout retry notes
                </h3>
                <span className="ml-auto flex items-center gap-1 rounded bg-surface-recessed px-1.5 py-1 text-2xs text-subtle-foreground">
                  <PluginGlyph className="size-3" />
                  Custom viewer
                </span>
              </div>
              <p className="leading-relaxed text-subtle-foreground">
                Flakes cluster around shared test state. Reset each mock between
                cases before rerunning the suite.
              </p>
              <div className="rounded-md border-l-2 border-file-accent bg-surface-recessed px-3 py-2 leading-relaxed text-foreground">
                Next: isolate the Stripe mock per test.
              </div>
            </article>
          </div>
        ) : (
          <div data-guide-fixture="diff-renderer" className="space-y-3">
            <div className="flex items-center gap-1.5 text-foreground">
              <MiniIcon icon={PlusMinusSquare01Icon} className="size-3.5" />
              <span className="font-medium">tests/checkout.test.ts</span>
              <span className="ml-auto flex items-center gap-1 rounded bg-surface-recessed px-1.5 py-1 text-2xs text-subtle-foreground">
                <PluginGlyph className="size-3" />
                Custom diff
              </span>
            </div>
            <div className="overflow-hidden rounded-md border border-border-hairline bg-background font-mono text-2xs leading-relaxed">
              <div className="border-b border-border-hairline bg-surface-recessed px-2 py-1.5 text-subtle-foreground">
                @@ -18,7 +18,8 @@ describe(&quot;checkout&quot;)
              </div>
              <div className="grid grid-cols-[24px_24px_1fr] px-2 py-1 text-subtle-foreground">
                <span>18</span>
                <span>18</span>
                <span>beforeEach(() =&gt; &#123;</span>
              </div>
              <div className="grid grid-cols-[24px_24px_1fr] bg-danger/10 px-2 py-1 text-danger">
                <span>19</span>
                <span></span>
                <span>− sharedMock.reset()</span>
              </div>
              <div className="grid grid-cols-[24px_24px_1fr] bg-success/10 px-2 py-1 text-success">
                <span></span>
                <span>19</span>
                <span>+ stripeMock.reset()</span>
              </div>
              <div className="grid grid-cols-[24px_24px_1fr] bg-success/10 px-2 py-1 text-success">
                <span></span>
                <span>20</span>
                <span>+ inventoryMock.reset()</span>
              </div>
              <div className="grid grid-cols-[24px_24px_1fr] px-2 py-1 text-subtle-foreground">
                <span>20</span>
                <span>21</span>
                <span>&#125;)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── close-up composer anatomy ─────────────────────────────────────── */

/**
 * The close-up composer is seated in the thread chrome it actually lives in:
 * window bar, a short exchange above, and the reply box at the bottom. The
 * fixture owns the exact geometry so installed plugin customizations cannot
 * move, rewrite, or add controls inside the Guide illustration.
 *
 * Composer controls sit against clipping and transient surfaces, so their
 * chips live in one Guide-owned sibling layer outside the WindowFrame — each
 * measured from the target it annotates, so a fixture change moves its chip
 * with it. The composer's two menus stay collapsed; each expands only while
 * its own annotation is engaged, anchored to the element the real menu flips
 * against. The + menu opens upward, as the real one does when the composer
 * sits at the bottom of the window.
 */
export function RealComposerAnnotated() {
  const banners = useEngagement("composer-banners");
  const mention = useEngagement("mention-provider");
  return (
    // The same gutter geometry as the other window slides, so the nav above
    // and the card below sit the same distance from every frame.
    <div className="relative px-7 pb-2 pt-4">
      {/* ProductMap keeps the full-width anatomy and its markers inside the
          same scale-together wrapper at every panel width. */}
      <div className="relative w-full select-none text-xs leading-none text-muted-foreground">
        <div
          data-guide-annotation-layer="composer-controls"
          className="pointer-events-none absolute inset-0 z-50"
        >
          <MeasuredBadge
            id="composer-banners"
            label="Plugin composer banners, above the prompt box"
            anchor='[data-guide-target="composer-banners"]'
            at="end"
          />
          <MeasuredBadge
            id="composer-state"
            label="The draft prompt a plugin can read and lock"
            anchor='[data-guide-target="composer-state"]'
            at="start"
          />
          <MeasuredBadge
            id="composer-plus-menu"
            label="Plugin rows in the composer's + menu"
            anchor='[data-guide-target="composer-plus-menu"]'
            at="start"
          />
          <MeasuredBadge
            id="provider-picker"
            label="Your agent provider and its mark, in the model picker"
            anchor='[data-guide-target="provider-picker"]'
            at="above"
          />
          <MeasuredBadge
            id="composer-actions"
            label="Plugin composer actions, before voice and send"
            anchor='[data-guide-target="composer-actions"]'
            at="above"
          />
        </div>
        <WindowFrame>
          <div className="flex min-h-[506px] flex-col">
            {/* thread chrome: header and a short exchange, unannotated */}
            {/* Full-scale chrome (text-sm rows, 44px header, 16px icons): the
              real composer renders at product size below, so the drawn
              thread around it holds the same scale instead of miniature. */}
            <div
              aria-hidden
              className="flex h-11 items-center gap-2 border-b border-border-hairline px-4 text-sm"
            >
              <span className="truncate text-foreground">
                Ship the release notes
              </span>
              <MiniIcon icon={MoreHorizontalIcon} className="size-3.5" />
              <span className="flex-1" />
            </div>
            <div
              aria-hidden
              className="flex-1 space-y-4 px-4 py-4 text-sm leading-relaxed"
            >
              <div className="flex justify-end">
                <span className="max-w-[70%] rounded-xl border border-border-seam bg-surface-recessed px-3 py-2 text-foreground">
                  Draft the release notes
                </span>
              </div>
              <p className="w-[88%]">
                Drafted. Two rough edges left in checkout — reply with what to
                fold in.
              </p>
            </div>

            {/* the reply box, pinned to the bottom like the real one, at the
              real product's footprint: the actual composer spans ~two thirds
              of the thread column, not edge to edge. */}
            <div className="px-4 pb-4">
              {/* banner: a plugin banner renders in this slot, above the box.
                  The mention menu anchors to it — the real MentionMenu flips
                  above the composer, seating itself over this slot — so its
                  clearance derives from the banner's own box. */}
              <div
                data-guide-target="composer-banners"
                className={cn(
                  "relative mb-2.5 flex items-center gap-2 rounded-md border border-border-hairline bg-surface-raised px-3 py-3 text-sm",
                  engagedRingClass(banners.outlined),
                )}
              >
                {mention.outlined ? (
                  <div
                    aria-hidden
                    data-guide-transient-for="mention-provider"
                    className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-1 overflow-hidden rounded-md border border-border bg-popover pb-1 text-xs shadow-md"
                  >
                    <span className="block px-3 pb-1 pt-1.5 text-muted-foreground">
                      Your plugin
                    </span>
                    <span className="mx-1 flex h-7 items-center gap-1.5 rounded-md bg-state-hover px-2 text-foreground">
                      <PluginGlyph className="size-3.5" />
                      release-notes
                    </span>
                    <span className="mx-1 flex h-7 items-center gap-1.5 px-2">
                      <PluginGlyph className="size-3.5 opacity-60" />
                      roadmap
                    </span>
                  </div>
                ) : null}
                <PluginGlyph className="size-3.5" />
                <span className="text-foreground">Your banner</span>
              </div>

              <StaticEmbeddedComposer />
            </div>
          </div>
        </WindowFrame>
      </div>
    </div>
  );
}

/**
 * Product-shaped prompt-box chrome, drawn in flow: the draft line and the
 * control row are the box's own content, so every target's ring and chip
 * derive from elements the layout itself positions — no hand-synced
 * coordinate pair between an overlay and a reservation.
 */
function StaticEmbeddedComposer() {
  const draft = useEngagement("composer-state");
  const plus = useEngagement("composer-plus-menu");
  const picker = useEngagement("provider-picker");
  const actions = useEngagement("composer-actions");
  return (
    <div data-guide-fixture="embedded-composer" className="space-y-2">
      <div className="relative flex h-[126px] flex-col rounded-xl border border-border bg-background px-2 pb-2 pt-3 shadow-lift">
        {/* + menu: opens upward while engaged, the direction the real menu
            takes at the window's bottom, seated flush against the box it
            flips from (the real PromptBoxActionsMenu's sideOffset). The
            draft-line chips it would cover hide while it is open — the
            tour-platform convention — so the menu never floats to clear
            them. */}
        {plus.outlined ? (
          <div
            aria-hidden
            data-guide-transient-for="composer-plus-menu"
            className="pointer-events-none absolute bottom-full left-2 z-20 mb-1 w-44 rounded-md border border-border bg-popover p-1 shadow-md"
          >
            <span className="flex h-6 items-center gap-1.5 px-1.5">
              <MiniIcon icon={File01Icon} className="size-3.5" />
              Attach files
            </span>
            <span className="flex h-6 items-center gap-1.5 px-1.5">
              <MiniIcon icon={ToolboxIcon} className="size-3.5" />
              Skills
            </span>
            <span className="flex h-6 items-center gap-1.5 rounded bg-state-hover px-1.5 text-foreground">
              <PluginGlyph className="size-3.5" />
              Your action
            </span>
          </div>
        ) : null}

        {/* The drawn draft: the editor's first line, in flow. A real mention
            pill and a plugin-painted range ride inside it, each its own
            annotation whose boundary follows the rendered text. */}
        <div
          data-guide-target="composer-state"
          className={cn(
            "mx-2 flex h-7 items-center rounded-md text-sm leading-none text-foreground",
            engagedRingClass(draft.outlined),
          )}
        >
          <span aria-hidden className="whitespace-pre">
            Summarize{" "}
          </span>
          <RegionMark
            id="mention-provider"
            label="Plugin mention results in the @ typeahead"
            className="flex h-5.5 items-center rounded-full border border-surface-selected-border bg-surface-selected px-1.5"
            chip="outside-above"
            showChip={!plus.outlined}
          >
            <span aria-hidden>@release-notes</span>
          </RegionMark>
          <span aria-hidden className="whitespace-pre">
            {" "}
            and fix the{" "}
          </span>
          <RegionMark
            id="composer-rich-text"
            label="Plugin highlighting, painted over the draft prompt"
            className="flex h-5.5 items-center rounded bg-warning/25 px-1 ring-1 ring-warning/40"
            chip="outside-above"
            showChip={!plus.outlined}
          >
            <span aria-hidden>TODO</span>
          </RegionMark>
          <span aria-hidden className="whitespace-pre">
            {" "}
            in checkout.
          </span>
        </div>

        {/* bottom controls, at the real product's sizes and order */}
        <div className="mt-auto flex h-10 items-center gap-1">
          <span
            data-guide-target="composer-plus-menu"
            className={cn(
              "flex size-10 items-center justify-center rounded-md",
              engagedRingClass(plus.outlined),
            )}
          >
            <MiniIcon icon={PlusSignIcon} className="size-4" />
          </span>
          <span
            data-guide-target="provider-picker"
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-md px-2 text-foreground",
              engagedRingClass(picker.outlined),
            )}
          >
            <MiniIcon icon={SparklesIcon} className="size-3.5" />
            Fable 5<span className="text-subtle-foreground">High</span>
          </span>
          <span className="flex-1" />
          <span
            data-guide-target="composer-actions"
            data-guide-fixture="plugin-composer-action"
            className={cn(
              "flex size-9 items-center justify-center rounded-md bg-state-hover",
              engagedRingClass(actions.outlined),
            )}
          >
            <PluginGlyph className="size-3.5" />
          </span>
          <span className="flex size-9 items-center justify-center">
            <MiniIcon icon={Mic01Icon} className="size-4" />
          </span>
          <span
            data-guide-icon="CornerDownLeft"
            className="flex size-9 items-center justify-center rounded-md bg-foreground"
          >
            <MiniIcon
              icon={ArrowMoveDownLeftIcon}
              className="size-3.5 text-background"
            />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5" aria-hidden>
        <span className="flex items-center gap-1.5">
          <MiniIcon icon={Folder01Icon} className="size-3.5" />
          acme-app · worktree
        </span>
        <span>Full Access</span>
      </div>
    </div>
  );
}

/* ── the new-thread screen (RootComposeView order) ──────────────────── */

export function ComposeScreenWireframe({
  composer,
}: {
  /** The host's real composer, when available; replaces the mock one. */
  composer?: ReactNode;
} = {}) {
  return (
    // Padded for the same annotation gutter as the app-window diagram.
    <div className="relative px-7 pb-2 pt-4">
      <MeasuredBadge
        id="new-thread-panel"
        label="A plugin action in the new-thread panel launcher"
        anchor='[data-guide-region="new-thread-panel"]'
        at="end"
      />
      <div>
        <ComposeScreenWireframeBody composer={composer} />
      </div>
    </div>
  );
}

function ComposeScreenWireframeBody({ composer }: { composer?: ReactNode }) {
  return (
    <WindowFrame>
      <div className="flex items-center gap-2 border-b border-border-hairline px-3 py-2">
        <TrafficLights />
      </div>
      {/* Proportions mirror RootComposeView: a centered reading column
          (max-w-[760px] in the real app) inside a much wider main area,
          content top-aligned, empty canvas below. */}
      <div className="flex min-h-[485px] items-stretch">
        <div className="min-w-0 flex-1 px-6 pb-6 pt-4">
          <div className="mx-auto w-full max-w-[560px] space-y-2.5">
            {/* the composer, no greeting above it (RootComposeView order):
              the real one when the host lends it, the mock otherwise.
              Inert either way — this is a diagram, and a live menu opening
              here would cover the marked section below it. Width-capped to
              the real home page's ratio: the product's composer spans about
              two thirds of the content area, not the whole column. */}
            {composer ? <div inert>{composer}</div> : <MockHomeComposer />}

            {/* plugin homepage sections render last, below everything */}
            <Mark
              id="homepage-section"
              label="A plugin homepage section, below the composer"
              className="mt-4 block px-3 py-2.5"
            >
              <span className="flex items-center gap-1.5 pb-2 font-medium text-foreground">
                <PluginGlyph className="size-3.5" />
                Your section
              </span>
              <span className="grid grid-cols-3 gap-2" aria-hidden>
                {["Release 1.4", "Bug triage", "Design QA"].map((card) => (
                  <span
                    key={card}
                    className="space-y-1.5 rounded-md border border-border-hairline bg-surface-raised p-2.5"
                  >
                    <span className="block text-foreground">{card}</span>
                    <span className="block h-1.5 w-4/5 rounded-sm bg-muted/60" />
                    <span className="block h-1.5 w-3/5 rounded-sm bg-muted/60" />
                  </span>
                ))}
              </span>
            </Mark>
          </div>
        </div>

        {/* right panel: no Info/Diff pins here; the new-tab launcher */}
        <div className="w-[210px] shrink-0 border-l border-border-seam bg-sidebar p-2">
          <span className="block px-1.5 pb-1.5 pt-1 text-xs text-subtle-foreground/75">
            Actions
          </span>
          <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
            <MiniIcon icon={Search01Icon} className="size-3.5" />
            Open browser
          </span>
          <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
            <MiniIcon icon={TerminalIcon} className="size-3.5" />
            Start terminal
          </span>
          {/* The row hugs the frame's right edge, so its chip rides the
              exterior gutter column, measured from the row itself. */}
          <Mark
            id="new-thread-panel"
            label="A plugin action in the new-thread panel launcher"
            className="flex h-6.5 items-center gap-2 px-2.5"
            showChip={false}
          >
            <PluginGlyph className="size-3.5" />
            <span className="text-foreground">Your action</span>
          </Mark>
        </div>
      </div>
    </WindowFrame>
  );
}

/* ── the plugin settings page (PluginSettings.tsx order) ────────────── */

export function SettingsWireframe() {
  return (
    <WindowFrame>
      {/* Page chrome: the settings area's own title bar (SettingsView). */}
      <div className="flex items-center gap-2 border-b border-border-hairline px-3 py-2.5">
        <TrafficLights />
        <span className="pl-1 font-medium text-foreground">Settings</span>
      </div>

      <div className="mx-auto min-h-[470px] w-full max-w-[520px] space-y-4 px-4 pb-5 pt-4">
        {/* Header: icon, name, one-line description (PluginSettings.tsx). */}
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center">
            <PluginGlyph className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              Hello
            </span>
            <span className="block truncate pt-1 text-subtle-foreground">
              A friendly example plugin.
            </span>
          </span>
        </div>

        {/* One "Configuration" heading covers both settings surfaces on the
            real page: the recessed panel holds the form bb generates from the
            plugin's declared fields, and any settingsSection components render
            beneath it. The markers distinguish them. */}
        <div className="space-y-2">
          <span className="block text-subtle-foreground">Configuration</span>
          <Mark
            id="declarative-settings"
            label="The form bb generates from the fields you declare"
            className="block bg-surface-recessed-solid p-3"
          >
            <span className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-foreground">
                  API key
                  <span className="rounded border border-border px-1.5 py-0.5 text-xs">
                    secret
                  </span>
                </span>
                <span className="block pt-1 leading-relaxed">
                  Stored server-side; never sent to the browser.
                </span>
              </span>
              <span
                aria-hidden
                className="flex h-6 w-32 shrink-0 items-center rounded-md border border-border bg-card px-2 text-xs text-subtle-foreground"
              >
                ••••••••
              </span>
            </span>
            <span className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block text-foreground">
                  Case-sensitive search
                </span>
                <span className="block pt-1 leading-relaxed">
                  Match capitalisation when looking things up.
                </span>
              </span>
              <span
                aria-hidden
                className="mt-0.5 flex h-4.5 w-8 shrink-0 items-center rounded-full bg-foreground/60 p-0.5"
              >
                <span className="ml-auto size-3.5 rounded-full bg-background" />
              </span>
            </span>
            <span className="flex justify-end pt-2">
              <span className="flex h-6 items-center rounded-md border border-border bg-card px-2 text-foreground">
                Save settings
              </span>
            </span>
          </Mark>

          {/* settingsSection slots render under the generated form. */}
          <Mark
            id="settings-section"
            label="A React component you write, under the generated form"
            className="block px-1 pb-2 pt-2"
          >
            <span className="flex items-center gap-1.5 pb-2 font-medium text-foreground">
              <PluginGlyph className="size-3.5" />
              Your section
            </span>
            <span
              aria-hidden
              className="block space-y-2 rounded-md border border-border bg-card p-2.5"
            >
              <span className="flex items-center justify-between">
                <span className="text-foreground">Connected as @acme-bot</span>
                <span className="flex h-5.5 items-center rounded-md border border-border px-2 text-foreground">
                  Test connection
                </span>
              </span>
              <span className="block h-2 w-2/3 rounded-sm bg-muted/60" />
            </span>
          </Mark>
        </div>

        {/* The page's closing section, verbatim from PluginSettings.tsx. */}
        <div className="space-y-2 border-t border-border-hairline pt-4">
          <span className="block text-subtle-foreground">Plugin details</span>
          <span className="flex items-center gap-1 leading-relaxed">
            Release, capabilities, and health live on
            <span className="text-foreground underline underline-offset-2">
              its plugin page
            </span>
            <MiniIcon icon={ArrowRight01Icon} className="size-3.5" />
          </span>
        </div>
      </div>
    </WindowFrame>
  );
}

/* ── the plugin's page in Extensions (ToolsView + PluginDetail) ───────── */

/**
 * The Extensions detail page for one installed plugin. The one pluggable
 * thing on it is the health banner: a plugin that reports needs-configuration
 * gets a warning bar at the top of the pane (PluginBannerBar, rendered by
 * PluginDetailBanners outside the scroll page), above the header and the
 * section stack bb builds from the manifest and registrations.
 */
export function ExtensionsPluginPageWireframe() {
  return (
    <WindowFrame>
      <div className="flex h-10 items-center gap-2 border-b border-border-hairline px-3 text-sm">
        <TrafficLights />
        <span className="text-foreground">Extensions</span>
      </div>
      <div className="flex min-h-[470px] flex-col">
        {/* Banner: full pane width, recessed, with a rule under it; the
            icon/title/detail row lines up with the page gutter below. */}
        <Mark
          id="plugin-status"
          label="The needs-configuration banner bb shows for a plugin that reports it"
          className="flex items-start gap-2 border-b border-border bg-surface-recessed/55 px-5 py-2.5 text-sm"
          // The banner hugs the clipping frame edge, so the chip keeps to
          // the inside corner.
          chip="corner-inset"
        >
          <MiniIcon
            icon={Settings02Icon}
            className="mt-0.5 size-4 text-warning"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              Needs configuration
            </span>
            <span className="block pt-0.5 text-xs leading-relaxed text-muted-foreground">
              Set an API key in Settings. Reloads when you save.
            </span>
          </span>
          <span className="flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-foreground">
            Reload
          </span>
        </Mark>

        <div className="mx-auto w-full max-w-[560px] space-y-4 px-4 pb-5 pt-4">
          {/* Header: icon, name, publisher badge; the enable toggle and menu
              at the right (PluginDetail header). */}
          <div className="flex items-center gap-2.5">
            <PluginGlyph className="size-4" />
            <span className="text-sm font-semibold text-foreground">Hello</span>
            <span className="rounded border border-border px-1.5 py-0.5 text-xs">
              BB Official
            </span>
            <span className="flex-1" />
            <span
              aria-hidden
              className="flex h-4.5 w-8 items-center rounded-full bg-foreground/60 p-0.5"
            >
              <span className="ml-auto size-3.5 rounded-full bg-background" />
            </span>
            <MiniIcon icon={MoreHorizontalIcon} className="size-3.5" />
          </div>
          <span className="block font-mono text-xs text-subtle-foreground">
            ~/.bb/plugins/hello
          </span>

          <div className="space-y-1.5 border-t border-border-hairline pt-3">
            <span className="block text-subtle-foreground">About</span>
            <span className="block text-foreground">
              A friendly example plugin.
            </span>
          </div>

          <div className="space-y-1.5 border-t border-border-hairline pt-3">
            <span className="block text-subtle-foreground">Configuration</span>
            <span className="flex items-center gap-1 leading-relaxed">
              Configure it on
              <span className="text-foreground underline underline-offset-2">
                its Settings page
              </span>
              <MiniIcon icon={ArrowRight01Icon} className="size-3.5" />
            </span>
          </div>

          <div className="space-y-1.5 border-t border-border-hairline pt-3">
            <span className="block text-subtle-foreground">Capabilities</span>
            <span
              aria-hidden
              className="block divide-y divide-border-hairline rounded-md border border-border-hairline"
            >
              {[
                ["Settings", "API key, Case-sensitive search"],
                ["bb hello", "Say hello from the terminal"],
              ].map(([name, what]) => (
                <span
                  key={name}
                  className="flex items-center gap-3 px-2.5 py-1.5"
                >
                  <span className="w-24 shrink-0 text-foreground">{name}</span>
                  <span className="truncate">{what}</span>
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

/** The stand-in composer for surfaces with no bb behind them (the docs site). */
function MockHomeComposer() {
  return (
    <>
      <div className="rounded-xl border border-border bg-background p-3 shadow-lift">
        <p className="px-1 pt-1 leading-relaxed text-subtle-foreground">
          Ask anything. @ to mention files, folders, or sections
        </p>
        <div aria-hidden className="h-10" />
        <div className="flex items-center gap-2 px-0.5" aria-hidden>
          <span className="flex size-6 items-center justify-center rounded-md border border-border">
            <MiniIcon icon={PlusSignIcon} className="size-3.5" />
          </span>
          <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-foreground">
            <MiniIcon icon={SparklesIcon} className="size-3.5" />
            Fable 5 · High
          </span>
          <span className="flex-1" />
          <MiniIcon icon={Mic01Icon} className="size-3.5" />
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <MiniIcon icon={ArrowUp01Icon} className="size-3 text-background" />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5" aria-hidden>
        <span className="flex items-center gap-1.5">
          <MiniIcon icon={Folder01Icon} className="size-3.5" />
          acme-app
          <span className="text-subtle-foreground">· worktree</span>
        </span>
        <span>Full Access</span>
      </div>
    </>
  );
}
