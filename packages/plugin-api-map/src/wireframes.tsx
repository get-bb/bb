/**
 * Miniature mockups of the real bb UI with every pluggable surface marked.
 * Layout and ordering mirror the real components in apps/app (audited against
 * AppSidebar, ThreadDetailHeader, ConversationMessageContent, MessageActionBar,
 * FollowUpPromptBox/PromptBoxInternal, ThreadSecondaryPanel, RootComposeView,
 * and PluginSettings); plugin contributions render highlighted, in the exact
 * spot the host inserts them.
 *
 * The regions covered by anatomy-manifest.json (sidebar sections, sidebar
 * footer, message action bar) render FROM the manifest, and a test in
 * apps/app renders the real components and asserts the same DOM order, so an
 * app-side reorder fails tests until the manifest, and these skeletons,
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
  useState,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
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
import { annotationChipClass } from "./annotation";
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
   * skeleton recedes. Lets one diagram serve as a per-surface illustration
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
  "thread-panel",
  "file-opener",
  "code-renderers",
  "timeline-renderers",
  "content-scripts",
  "command-palette-actions",
] as const;

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

function Mark({
  id,
  label,
  className,
  chipClassName,
  showChip = true,
  edge = false,
  onActivate,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  chipClassName?: string;
  /** Whether this region renders its own numbered chip. */
  showChip?: boolean;
  /**
   * Anchor the chip to the diagram's gutter instead of to this mark, for a
   * region that hugs an outer edge — those chips crowd the diagram's own
   * chrome when they sit inside it.
   *
   * The mechanism is the containing block: dropping `relative` here makes
   * the chip resolve against the nearest positioned ancestor, which is the
   * `relative` gutter wrapper outside the frame. An absolutely positioned
   * box is not clipped by an ancestor whose descendant its containing block
   * is not, so the chip escapes both the frame's `overflow-hidden` and the
   * scroll wrapper's `overflow-x-auto` — and `chipClassName` is then read as
   * coordinates on the gutter, not on the mark.
   */
  edge?: boolean;
  /** Runs the fixture interaction represented by this marker. */
  onActivate?: () => void;
  children?: ReactNode;
}) {
  const { activeId, setActiveId, expandedId, spotlightId, numberOf, onSelect } =
    useSurfaceMap();
  const active = activeId === id || expandedId === id || spotlightId === id;
  // The container outline is exclusive: while any region is hovered, only
  // that region outlines, so two outlines are never on screen to overlap.
  // The chip fill still follows `active`, so an open card's marker stays lit.
  const outlined =
    activeId !== null
      ? activeId === id
      : expandedId === id || spotlightId === id;
  const dimmed = Boolean(spotlightId) && spotlightId !== id;
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
        "rounded-md ring-1 ring-inset transition-all",
        edge || "relative",
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
          className={annotationChipClass(
            active,
            // The ring is the only addition: it keeps the chip legible where it
            // overlaps the mockup's own grey bones.
            cn(
              "absolute z-50 ring-2 ring-card",
              chipClassName ?? "-right-2 -top-2",
            ),
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
 * An annotation whose boundary is the fixture element it describes.
 *
 * Unlike OverlayMark, this component does not measure a rectangle against a
 * slide. Its interactive layer fills the content wrapper, so the outline and
 * marker move with that content. The overlay is a sibling of `children`, so
 * fixture content does not have to become part of the interactive anchor.
 */
function RegionMark({
  id,
  label,
  className,
  chipClassName,
  showChip = true,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  chipClassName?: string;
  /** Whether this region renders its own numbered chip. */
  showChip?: boolean;
  children: ReactNode;
}) {
  const { activeId, setActiveId, expandedId, spotlightId, numberOf, onSelect } =
    useSurfaceMap();
  const active = activeId === id || expandedId === id || spotlightId === id;
  const outlined =
    activeId !== null
      ? activeId === id
      : expandedId === id || spotlightId === id;
  const dimmed = Boolean(spotlightId) && spotlightId !== id;

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
          outlined
            ? "bg-surface-selected/30 ring-surface-selected-border"
            : "ring-transparent hover:bg-state-hover",
        )}
      >
        {showChip ? (
          <span
            aria-hidden
            className={annotationChipClass(
              active,
              cn(
                "absolute z-50 ring-2 ring-card",
                chipClassName ?? "-right-2 -top-2",
              ),
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
      className={cn(
        // bg-background: the window's content areas use the same canvas the
        // real app paints, so the sidebar (var(--sidebar)) sits against it
        // at exactly the product's own contrast in every palette. The frame
        // edge carries the separation from the page.
        "select-none overflow-hidden rounded-lg border border-border bg-background text-xs leading-none text-muted-foreground shadow-sm",
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
 * top-reserve chrome, the New-thread/search block, plugin nav rows, the
 * scrolling thread list, the footer).
 */
const SIDEBAR_SECTION_RENDERERS: Record<string, () => ReactNode> = {
  "top-reserve": () => (
    <div className="flex items-center px-2.5 pt-2">
      <MiniIcon icon={SidebarLeftIcon} />
      <span className="flex-1" />
      <MiniIcon icon={ArrowLeft01Icon} className="size-3.5" />
      <MiniIcon icon={ArrowRight01Icon} className="ml-1.5 size-3.5" />
    </div>
  ),
  "primary-actions": () => (
    <div className="flex items-center gap-2 px-2.5 py-2.5">
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
              // Top-right of the glyph and clear of it; the sidebar's padding
              // still has room for the chip before the panel's edge.
              chipClassName="-right-4 -top-2"
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
      chipClassName="-right-2 -top-2"
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

export function AppShellWireframe() {
  const [rightPanelTab, setRightPanelTab] =
    useState<AppShellRightPanelTab>("thread-panel");

  return (
    // The padding is the annotation gutter: edge-hugging markers anchor to
    // this box and sit outside the frame, so they ring the diagram instead
    // of crowding its chrome.
    // Unlike the simpler slides, this dense three-column anatomy stays at a
    // readable minimum size. The whole annotated object scrolls together in
    // a narrow pane, so the exterior sidebar badges do not detach from it.
    <div className="overflow-x-auto">
      <div className="relative min-w-[1120px] px-10 pb-4 pt-4">
        {/* The first two surfaces belong to the sidebar as a whole. Keep their
            chips in the exterior annotation gutter, matching the shipped Guide,
            while the in-frame regions remain independently clickable. */}
        <OverlayMark
          id="nav-panel"
          label="Plugin nav panels, above the thread list"
          className="left-4 top-[124px]"
        />
        <OverlayMark
          id="thread-list"
          label="The thread list, replaceable by one plugin"
          className="left-4 top-[190px]"
        />
        {/* Content scripts have no slot of their own — they run across the
            whole window, so the marker annotates the frame itself. */}
        <OverlayMark
          id="content-scripts"
          label="App-wide plugin scripts, running in the whole window"
          className="left-1/2 top-0.5 -translate-x-1/2"
          region="inset-x-10 bottom-4 top-4"
        />
        <div className="min-w-[1040px]">
          <AppShellWireframeBody
            rightPanelTab={rightPanelTab}
            onRightPanelTabSelect={setRightPanelTab}
          />
        </div>
      </div>
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
  return (
    <WindowFrame className="relative">
      <RegionMark
        id="command-palette-actions"
        label="Plugin actions in bb's quick command palette"
        className="absolute left-1/2 top-14 z-10 w-56 -translate-x-1/2 rounded-lg border border-border bg-popover p-1 shadow-md"
        chipClassName="-right-2 -top-2"
      >
        <div data-guide-fixture="command-palette-action">
          <div className="px-2 py-1 text-[9px] text-subtle-foreground">
            Commands
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-state-hover px-2 py-2 text-foreground">
            <PluginGlyph className="size-3.5" />
            Your plugin: run action
            <span className="ml-auto text-[9px] text-subtle-foreground">
              Plugins
            </span>
          </div>
        </div>
      </RegionMark>
      {/* Sized to the real window's aspect: at the diagram's 1100px width, a
          650px frame matches the ~1.7:1 footprint of an actual bb window.
          The thread list and timeline are flex-1, so the height lands there
          as open canvas. The timeline's explicit minimum keeps this loaded
          fixture aligned with the same taller skeleton geometry. */}
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
              // Top-right of the glyph, clear of it: the frame clips at its
              // own top edge (this row is the first thing under it), and
              // px-3 on the row leaves exactly 12px before the frame's edge.
              chipClassName="-top-1.5 -right-3"
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
                label="A plugin renderer supplying its timeline row body"
                className="ml-5 block space-y-1 px-2.5 py-2"
                chipClassName="-right-2 top-1/2 -translate-y-1/2"
              >
                <div className="flex items-center gap-2" aria-hidden>
                  <span className="h-1.5 w-2/3 rounded-sm bg-muted/60" />
                  <span className="h-1.5 w-12 rounded-sm bg-foreground/40" />
                </div>
              </RegionMark>
            </div>

            {/* assistant message: plain prose + directive + action bar */}
            <div className="w-[88%] space-y-2">
              <p className="leading-relaxed">
                The retries cluster in two suites. Failure rate by suite:
              </p>
              <Mark
                id="message-directives"
                label="A plugin component rendered inline by a message directive"
                className="block w-3/5 px-2.5 py-2.5"
                chipClassName="-right-2 top-0"
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
                <p className="leading-relaxed">
                  Fixed by isolating the{" "}
                  <span className="rounded-sm bg-surface-selected px-0.5">
                    Stripe mock
                  </span>{" "}
                  per test.
                </p>
              </div>
              {/* action bar, icons in anatomy-manifest order */}
              <Mark
                id="message-actions"
                label="Plugin message actions, after the host actions"
                className="inline-flex items-center gap-2 px-2 py-1.5"
              >
                {anatomy.messageActionBar.map((key) => (
                  <Fragment key={key}>
                    {MESSAGE_ACTION_RENDERERS[key]?.()}
                  </Fragment>
                ))}
              </Mark>
            </div>
          </div>

          {/* pending interaction: replaces the prompt box, not the timeline */}
          <div className="space-y-2 border-t border-border-hairline p-4">
            <Mark
              id="pending-interaction"
              label="A plugin ask-the-user form, shown in place of the composer"
              className="block border border-border bg-card p-3"
              chipClassName="-top-2 right-1.5"
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
 * The three annotated right-panel capabilities are tabs in the product. Each
 * marker selects its tab before opening the corresponding Guide card, so the
 * diagram and the explanation always describe the same visible body.
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
      "flex h-6 shrink-0 items-center rounded-md",
      activeTab === tab && "bg-state-hover",
    );

  return (
    // Plain bg-sidebar, like the real ThreadSecondaryPanel — the real panel
    // is not the app's `.fixed.bg-sidebar` element, so it does not receive
    // the themed sidebar overlay.
    <div className="flex w-[300px] shrink-0 flex-col border-l border-border-seam bg-sidebar">
      <div className="flex h-12 items-end gap-1.5 border-b border-border-hairline px-3 pb-1">
        <span className="flex h-6 items-center rounded-md px-1.5">
          <MiniIcon icon={InformationCircleIcon} className="size-3.5" />
        </span>
        <Mark
          id="code-renderers"
          label="Plugin code and diff renderers on bb's Diff tab"
          className={cn(tabClass("code-renderers"), "px-1.5")}
          chipClassName="left-1/2 -top-5 -translate-x-1/2"
          onActivate={() => onTabSelect("code-renderers")}
        >
          <span data-guide-tab="code-renderers">
            <MiniIcon icon={PlusMinusSquare01Icon} className="size-3.5" />
          </span>
        </Mark>
        <Mark
          id="thread-panel"
          label="A plugin tab in the thread side panel"
          className={cn(
            tabClass("thread-panel"),
            "gap-1.5 whitespace-nowrap pl-1.5 pr-2",
          )}
          chipClassName="left-1/2 -top-5 -translate-x-1/2"
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
          className={cn(tabClass("file-opener"), "px-1.5")}
          chipClassName="left-1/2 -top-5 -translate-x-1/2"
          onActivate={() => onTabSelect("file-opener")}
        >
          <span data-guide-tab="file-opener">
            <MiniIcon icon={File01Icon} className="size-3.5" />
          </span>
        </Mark>
        <span className="flex-1" />
        <MiniIcon icon={PlusSignIcon} className="size-3.5" />
        <MiniIcon icon={SidebarRightIcon} className="size-3.5" />
      </div>
      <div data-guide-tab-body={activeTab} className="m-3 flex-1 p-3.5">
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
          <div data-guide-fixture="file-viewer">
            <div className="flex items-center gap-1.5 pb-2 text-foreground">
              <MiniIcon icon={File01Icon} className="size-3.5" />
              notes.md
              <PluginGlyph className="ml-auto size-3.5" />
            </div>
            <p className="pb-2 text-foreground">Checkout retry notes</p>
            <p className="leading-relaxed text-subtle-foreground">
              Flakes cluster around shared test state. Reset each mock between
              cases before rerunning the suite.
            </p>
          </div>
        ) : (
          <div data-guide-fixture="diff-renderer" className="space-y-2">
            <div className="flex items-center gap-1.5 text-foreground">
              <MiniIcon icon={PlusMinusSquare01Icon} className="size-3.5" />
              checkout.test.ts
              <PluginGlyph className="ml-auto size-3.5" />
            </div>
            <div className="space-y-1 font-mono text-2xs leading-tight">
              <span className="block rounded-sm bg-danger/10 px-1.5 py-1 text-danger">
                − sharedMock.reset()
              </span>
              <span className="block rounded-sm bg-success/10 px-1.5 py-1 text-success">
                + mock.resetEach()
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the composer, close up (FollowUpPromptBox order) ───────────────── */

export function ComposerWireframe() {
  return (
    <div className="mx-auto w-full max-w-xl select-none space-y-2.5 text-xs leading-none text-muted-foreground">
      {/* banners: plugin banners render first, above the card */}
      <Mark
        id="composer-banners"
        label="Plugin composer banners, above the prompt box"
        className="flex items-center gap-2 border border-border-hairline bg-surface-raised px-3 py-2.5"
      >
        <PluginGlyph className="size-3.5" />
        <span className="text-foreground">Your banner</span>
      </Mark>
      <div
        aria-hidden
        className="flex items-center gap-2 rounded-md border border-border-hairline px-2.5 py-2"
      >
        <MiniIcon icon={GitBranchIcon} className="size-3.5" />
        Uncommitted · 3 files
      </div>

      {/* mention menu: opens above the input in the follow-up composer */}
      <Mark
        id="mention-provider"
        label="Plugin mention results in the @ typeahead"
        className="relative z-10 -mb-1 ml-4 block w-56 rounded-md border border-border bg-popover p-2 shadow-md"
        chipClassName="-right-2 -top-2"
      >
        <span className="block px-1.5 pb-1 text-xs text-subtle-foreground/75">
          Your plugin
        </span>
        <span className="flex h-6 items-center gap-1.5 rounded bg-state-hover px-1.5 text-foreground">
          <PluginGlyph className="size-3.5" />
          release-notes
        </span>
        <span className="flex h-6 items-center gap-1.5 px-1.5">
          <PluginGlyph className="size-3 opacity-60" />
          roadmap
        </span>
      </Mark>

      {/* the prompt card */}
      <div className="rounded-xl border border-border bg-background p-2.5 shadow-lift">
        {/* The editable draft: what useComposerView reads and setInputLock
            holds. Marked on the text block itself, not on the card. */}
        <Mark
          id="composer-state"
          label="The draft prompt a plugin can read and lock"
          className="block px-1 pt-1"
          chipClassName="-left-3 -top-2.5"
        >
          <p className="leading-relaxed">
            Summarize{" "}
            <span className="rounded-full border border-surface-selected-border bg-surface-selected px-1.5 py-0.5 text-foreground">
              @release-notes
            </span>{" "}
            and fix the{" "}
            <Mark
              id="composer-rich-text"
              label="A range of the draft prompt painted by a plugin rich-text effect"
              className="inline-block px-1 py-0.5"
              chipClassName="-right-2.5 -top-2.5"
            >
              <span className="rounded bg-warning/25 px-1 py-0.5 text-foreground ring-1 ring-warning/40">
                TODO
              </span>
            </Mark>{" "}
            in checkout
          </p>
        </Mark>

        {/* bottom row: + menu, model picker; then plugin actions, mic, send */}
        <div className="mt-3 flex items-center gap-2 px-0.5">
          {/* Drawn pressed: its menu is open below the card. */}
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-md border border-border bg-state-hover"
          >
            <MiniIcon icon={PlusSignIcon} className="size-3.5" />
          </span>
          <Mark
            id="provider-picker"
            label="Your agent provider in the model picker"
            className="p-1"
          >
            <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5">
              <PluginGlyph className="size-3.5" />
              <span className="text-foreground">Your model</span>
              <span className="text-subtle-foreground">High</span>
            </span>
          </Mark>
          <span className="flex-1" />
          <Mark
            id="composer-actions"
            label="Plugin composer actions, before voice and send"
            className="p-1"
            chipClassName="-top-2.5 -left-2.5"
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-state-hover">
              <PluginGlyph className="size-3.5" />
            </span>
          </Mark>
          <MiniIcon icon={Mic01Icon} className="size-3.5" />
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-3 -rotate-90 text-background"
            />
          </span>
        </div>
      </div>

      {/* + menu: opens under the + at the card's bottom-left corner. Drawn
          open — like the mention menu above — so both of the composer's
          menus, and the plugin row inside this one, are visible at once;
          something the live composer can never show. */}
      <Mark
        id="composer-plus-menu"
        label="Plugin rows in the composer's + menu"
        className="relative z-10 -mt-1 ml-3 block w-44 rounded-md border border-border bg-popover p-2 shadow-md"
        chipClassName="-right-2 -top-2"
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
      </Mark>

      {/* the strip below the card: environment left, permission mode right */}
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

/* ── annotating the real composer (bb plugin only) ──────────────────── */

/**
 * Marker for a real host component: the numbered chip, plus an optional
 * highlight rectangle over the region it points at. The highlight uses the
 * same selected-surface tokens the skeleton `Mark` regions use, so a live
 * component and a mockup light up the same way.
 */
function OverlayMark({
  id,
  label,
  className,
  region,
}: {
  id: string;
  label: string;
  /** Chip position, relative to the annotated container. */
  className?: string;
  /** Region to highlight while active, as inset utilities. */
  region?: string;
}) {
  const { activeId, setActiveId, expandedId, spotlightId, numberOf, onSelect } =
    useSurfaceMap();
  const active = activeId === id || expandedId === id || spotlightId === id;
  // Exclusive, like Mark's outline: hovering any region shows that region's
  // ring alone, so overlapping regions (the draft line contains the mention
  // pill and the painted range) never draw two rings at once.
  const outlined =
    activeId !== null
      ? activeId === id
      : expandedId === id || spotlightId === id;
  return (
    <>
      {region && outlined ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-[5] rounded-md bg-surface-selected/30 ring-1 ring-inset ring-surface-selected-border",
            region,
          )}
        />
      ) : null}
      <a
        data-guide-badge={id}
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
        // Annotation badges are the Guide's top visual layer. Menus are
        // positioned away from them, so neither surface has to cover the
        // other to remain legible.
        className={cn("absolute z-50", className)}
      >
        <span
          aria-hidden
          className={annotationChipClass(active, "ring-2 ring-card")}
        >
          {numberOf(id)}
        </span>
      </a>
    </>
  );
}

/**
 * The composer slide inside bb: the real host composer, rendered static,
 * seated in the thread chrome it actually lives in — window bar, a short
 * exchange above, the reply box at the bottom. The chrome is what gives the
 * slide its height, so the page matches the other slides without padding.
 *
 * The component is the one the plugin API actually returns
 * (experimental_NewThreadComposer); the wrapper is `inert`, so nothing
 * focuses, types, or opens. Over the editor's first line sits a drawn draft
 * with a real mention pill and a painted range — the two things a plain-text
 * seed cannot show. The composer's two menus stay collapsed; each expands
 * only while its own annotation is engaged. The + menu opens upward, as the
 * real one does when the composer sits at the bottom of the window.
 */
export function RealComposerAnnotated({ composer }: { composer: ReactNode }) {
  const { activeId, expandedId } = useSurfaceMap();
  const engaged = (id: string) => activeId === id || expandedId === id;
  return (
    // The same gutter geometry as the other window slides, so the nav above
    // and the card below sit the same distance from every frame.
    <div className="relative px-7 pb-2 pt-4">
      {/* Below ~720px the annotated composer scrolls sideways rather than
          reflowing: the overlay markers are measured against the full-width
          layout, so the diagram keeps that layout at every panel width. */}
      <div className="overflow-x-auto">
        <div className="mx-auto w-full min-w-[720px] max-w-3xl select-none text-xs leading-none text-muted-foreground">
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
                {/* banner: a plugin banner renders in this slot, above the box */}
                <Mark
                  id="composer-banners"
                  label="Plugin composer banners, above the prompt box"
                  className="mb-2.5 flex items-center gap-2 rounded-md border border-border-hairline bg-surface-raised px-3 py-3 text-sm"
                  // Flush with the banner's right edge rather than hanging
                  // past it: the typeahead below opens at the prompt box's
                  // exact width, and a chip poking out beyond that edge reads
                  // as the menu failing to cover it.
                  chipClassName="right-0 -top-2"
                >
                  <PluginGlyph className="size-3.5" />
                  <span className="text-foreground">Your banner</span>
                </Mark>

                <div className="relative">
                  <div inert>{composer}</div>

                  {/* The drawn draft, covering the editor's first line: a real
                  mention pill and a plugin-painted range. Its fill matches
                  the prompt box's own background, so it disappears into the
                  product chrome instead of reading as a pasted-on strip. */}
                  <div className="absolute left-4 right-12 top-[13px] flex h-7 items-center bg-[var(--background)] text-sm leading-none text-foreground">
                    <span aria-hidden className="whitespace-pre">
                      Summarize{" "}
                    </span>
                    <RegionMark
                      id="mention-provider"
                      label="Plugin mention results in the @ typeahead"
                      className="flex h-5.5 items-center rounded-full border border-surface-selected-border bg-surface-selected px-1.5"
                      chipClassName="left-1/2 -top-4 -translate-x-1/2"
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
                      chipClassName="left-1/2 -top-4 -translate-x-1/2"
                    >
                      <span aria-hidden>TODO</span>
                    </RegionMark>
                    <span aria-hidden className="whitespace-pre">
                      {" "}
                      in checkout.
                    </span>
                  </div>

                  {/* the draft itself: what useComposer reads and locks */}
                  <OverlayMark
                    id="composer-state"
                    label="The draft prompt a plugin can read and lock"
                    className="-left-2 top-4"
                    region="left-[12px] right-[40px] top-[9px] h-9"
                  />
                  {/* The mention pill and highlighted range carry their own
                      RegionMarks above, so their boundaries follow the
                      rendered fixture text rather than slide coordinates. */}
                  {engaged("mention-provider") ? (
                    <div
                      aria-hidden
                      // Placed like the real MentionMenu in a bottom-pinned
                      // composer: the prompt box's full width (-left-px /
                      // -right-px, over its 1px border) and above every
                      // annotation. The extra gap keeps the menu clear of the
                      // two badges over the draft line.
                      className="pointer-events-none absolute -left-px -right-px bottom-full z-20 mb-5 overflow-hidden rounded-md border border-border bg-popover pb-1 shadow-md"
                    >
                      <span className="block px-3 pb-1 pt-1.5 text-xs text-muted-foreground">
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

                  {/* + menu: chip on the + itself; opens upward while engaged,
                  the direction the real menu takes at the window's bottom */}
                  <OverlayMark
                    id="composer-plus-menu"
                    label="Plugin rows in the composer's + menu"
                    // On the button's corner but below 81px, where the +
                    // menu's bottom edge lands when it opens; higher and the
                    // menu would cut the chip in half.
                    className="left-[35px] top-[83px]"
                    region="left-[5px] top-[85px] size-10"
                  />
                  {engaged("composer-plus-menu") ? (
                    <div
                      aria-hidden
                      // Placed like the real PromptBoxActionsMenu (Radix,
                      // align="start", sideOffset 4, flipped upward at the
                      // window's bottom): left edge on the + button, bottom
                      // edge 4px above its top (the button region starts at
                      // 85px), above every annotation.
                      className="pointer-events-none absolute bottom-[calc(100%-81px)] left-[5px] z-20 w-44 rounded-md border border-border bg-popover p-1 shadow-md"
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

                  {/* agent providers: one annotation for the whole picker */}
                  <OverlayMark
                    id="provider-picker"
                    label="Your agent provider and its mark, in the model picker"
                    className="left-[184px] top-[71px]"
                    region="left-[41px] top-[85px] h-10 w-[157px]"
                  />
                  {/* The real composer intentionally suppresses globally
                      installed plugin controls. Draw this fixture-owned icon
                      in the documented slot so the annotation still points
                      at a recognizable plugin action. */}
                  <RegionMark
                    id="composer-actions"
                    label="Plugin composer actions, before voice and send"
                    className="absolute right-[81px] top-[87px] z-[5] flex size-9 items-center justify-center"
                    chipClassName="left-1/2 -top-4 -translate-x-1/2"
                  >
                    <span
                      aria-hidden
                      data-guide-fixture="plugin-composer-action"
                      className="flex size-7 items-center justify-center rounded-md bg-state-hover"
                    >
                      <PluginGlyph className="size-3.5" />
                    </span>
                  </RegionMark>
                </div>
              </div>
            </div>
          </WindowFrame>
        </div>
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
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <ComposeScreenWireframeBody composer={composer} />
        </div>
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
              chipClassName="-top-1 right-0"
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
          <Mark
            id="new-thread-panel"
            label="A plugin action in the new-thread panel launcher"
            className="flex h-6.5 items-center gap-2 px-2.5"
            edge
            chipClassName="right-1 top-[124px]"
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
            chipClassName="-right-2 -top-2"
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
            chipClassName="-right-2 -top-1"
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
          // Inside the bar's corner: the bar spans the whole frame, so a chip
          // hung past its right edge would be clipped by the frame.
          chipClassName="right-2 -top-2"
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
