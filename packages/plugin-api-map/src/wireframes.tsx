import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Switch } from "@bb/shared-ui/switch";

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
  expandedId?: string | null;
  numberOf: (id: string) => number | null;
  pluginPageHref?: (displayName: string) => string | null;
  renderPluginIcon?: (displayName: string) => ReactNode;
  onSelect?: (id: string) => void;
  currentGroupId?: string;
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
  "sidebar-navigation",
  "nav-panel",
  "thread-row-status",
  "thread-list",
  "sidebar-footer",
  "thread-header",
  "timeline-renderers",
  "message-directives",
  "message-actions",
  "pending-interaction",
  "code-renderers",
  "browser-toolbar",
  "thread-panel",
  "file-opener",
  "app-overlay",
  "content-scripts",
] as const;

export const COMMAND_PALETTE_MARKS = ["command-palette-actions"] as const;

export const COMPOSER_MARKS = [
  "composer-banners",
  "composer-state",
  "mention-provider",
  "composer-rich-text",
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

function useEngagement(id: string) {
  const { activeId, expandedId } = useSurfaceMap();
  return {
    active: activeId === id || expandedId === id,
    outlined: activeId !== null ? activeId === id : expandedId === id,
  };
}

function useAnnotationHover(id: string) {
  const { setActiveId } = useSurfaceMap();
  return {
    onMouseEnter: () => setActiveId(id),
    onMouseLeave: () => setActiveId(null),
    onFocus: () => setActiveId(id),
    onBlur: () => setActiveId(null),
  };
}

function selectAnnotation(
  event: MouseEvent<HTMLAnchorElement>,
  id: string,
  onSelect: ((id: string) => void) | undefined,
  onActivate: (() => void) | undefined,
) {
  onActivate?.();
  if (!onSelect) return;
  event.preventDefault();
  event.stopPropagation();
  onSelect(id);
}

function PlacedChip({
  id,
  active,
  chip,
}: {
  id: string;
  active: boolean;
  chip: AnnotationChipPlacement;
}) {
  const { numberOf } = useSurfaceMap();
  return (
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
  );
}

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
  target = false,
  onActivate,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  chip?: AnnotationChipPlacement;
  showChip?: boolean;
  target?: boolean;
  onActivate?: () => void;
  children?: ReactNode;
}) {
  const { onSelect } = useSurfaceMap();
  const { active, outlined } = useEngagement(id);
  const hover = useAnnotationHover(id);
  return (
    <a
      data-guide-region={id}
      data-guide-target={target ? id : undefined}
      href={`#surface-${id}`}
      aria-label={`${label} — jump to details`}
      onClick={(event) => selectAnnotation(event, id, onSelect, onActivate)}
      {...hover}
      className={cn(
        "relative rounded-md ring-1 ring-inset transition-all",
        FOCUS_RING_CLASS,
        outlined
          ? "bg-surface-selected ring-surface-selected-border"
          : "ring-transparent hover:bg-state-hover",
        className,
      )}
    >
      {showChip ? <PlacedChip id={id} active={active} chip={chip} /> : null}
      {children}
    </a>
  );
}

const RELEASE_DEMO_MS = 2400;

function CommandPaletteActionMark({ onRun }: { onRun: () => void }) {
  const id = "command-palette-actions";
  const { onSelect } = useSurfaceMap();
  const { outlined } = useEngagement(id);
  const hover = useAnnotationHover(id);

  return (
    <button
      data-guide-region={id}
      type="button"
      role="option"
      aria-selected="true"
      onClick={() => {
        onRun();
        onSelect?.(id);
      }}
      {...hover}
      data-guide-fixture="command-palette-action"
      className={cn(
        "flex w-full cursor-pointer items-center gap-1.5 rounded bg-state-hover px-2 py-1.5 text-left text-foreground ring-1 ring-inset transition-all",
        outlined ? "ring-surface-selected-border" : "ring-transparent",
      )}
    >
      <span>Run release checklist</span>
      <span className="ml-auto text-xs text-subtle-foreground">Plugins</span>
    </button>
  );
}

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
  chip?: AnnotationChipPlacement;
  showChip?: boolean;
  children: ReactNode;
}) {
  const { onSelect } = useSurfaceMap();
  const { active, outlined } = useEngagement(id);
  const hover = useAnnotationHover(id);

  return (
    <div data-guide-region={id} className={cn("relative", className)}>
      <a
        href={`#surface-${id}`}
        aria-label={`${label} — jump to details`}
        onClick={
          onSelect
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(id);
              }
            : undefined
        }
        {...hover}
        className={cn(
          "absolute inset-0 z-[1] rounded-md ring-1 ring-inset transition-all",
          FOCUS_RING_CLASS,
          outlined
            ? "bg-surface-selected/30 ring-surface-selected-border"
            : "ring-transparent hover:bg-state-hover",
        )}
      >
        {showChip ? <PlacedChip id={id} active={active} chip={chip} /> : null}
      </a>
      {children}
    </div>
  );
}

export const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const CHIP_SIZE = 20;
const CHIP_GAP = 8;

function MeasuredBadge({
  id,
  label,
  anchor,
  at,
  align = "center",
  flush = false,
  onActivate,
  clipTo,
}: {
  id: string;
  label: string;
  anchor: string;
  at: "start" | "end" | "above" | "lane";
  align?: "start" | "center" | "end";
  flush?: boolean;
  onActivate?: () => void;
  clipTo?: string;
}) {
  const { numberOf, onSelect } = useSurfaceMap();
  const { active } = useEngagement(id);
  const hover = useAnnotationHover(id);
  const ref = useRef<HTMLAnchorElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useBrowserLayoutEffect(() => {
    const element = ref.current;
    const container = element?.offsetParent;
    if (!element || !(container instanceof HTMLElement)) return;
    const scope =
      container.closest<HTMLElement>("[data-map-section]") ?? container;
    const target = scope.querySelector<HTMLElement>(anchor);
    if (!target) return;

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
      node = element.parentElement;
      while (node) {
        x -= node.scrollLeft;
        y -= node.scrollTop;
        node = node.parentElement;
      }
      return { x, y };
    };
    const measure = () => {
      const strategy = container.closest<HTMLElement>(
        "[data-guide-responsive-strategy]",
      );
      const counterScale = annotationChipCounterScale(
        Number(strategy?.dataset.guideScale ?? "1"),
      );
      const chipBox = CHIP_SIZE * counterScale;
      const edgeGap = flush
        ? parseFloat(getComputedStyle(container).borderLeftWidth || "0")
        : CHIP_GAP;
      const chipGap = edgeGap * counterScale;
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
      const clip = clipTo ? scope.querySelector<HTMLElement>(clipTo) : null;
      if (clip) {
        const clipOrigin = layoutOrigin(clip);
        const left = targetOrigin.x - clipOrigin.x;
        if (left < 0 || left + target.offsetWidth > clip.clientWidth) {
          setPosition(null);
          return;
        }
      }
      const centerY = local.top + local.height / 2 - chipBox / 2;
      const anchoredY =
        align === "start"
          ? local.top
          : align === "end"
            ? local.top + local.height - chipBox
            : centerY;
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
      const clamp = (value: number, extent: number) =>
        Math.max(0, Math.min(value, Math.max(0, extent - chipBox)));
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
      if (!flush) {
        next.left = clamp(next.left, container.offsetWidth);
      }
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
    scope.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      scope.removeEventListener("scroll", measure, true);
    };
  }, [anchor, at, align, flush, clipTo]);

  return (
    <a
      ref={ref}
      data-guide-badge={id}
      data-guide-badge-placement={at}
      data-guide-badge-align={align}
      href={`#surface-${id}`}
      aria-label={`${label} — jump to details`}
      onClick={(event) => selectAnnotation(event, id, onSelect, onActivate)}
      {...hover}
      className={cn("pointer-events-auto absolute z-50", FOCUS_RING_CLASS)}
      style={position ?? { visibility: "hidden" }}
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

function MiniIcon({ icon, className }: { icon: IconName; className?: string }) {
  return (
    <Icon
      name={icon}
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

function PluginGlyph({ className }: { className?: string }) {
  return (
    <Icon
      name="Plug02"
      className={cn("size-4 shrink-0 text-foreground", className)}
    />
  );
}

function ProviderGlyph() {
  const { renderPluginIcon } = useSurfaceMap();
  return (
    renderPluginIcon?.("Claude Code provider") ?? (
      <Icon name="Code" className="size-3.5" />
    )
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

const SIDEBAR_THREADS: readonly { title: string; glyph?: "spin" | "dot" }[] = [
  { title: "Fix flaky checkout tests", glyph: "spin" },
  { title: "Refactor settings page" },
  { title: "Ship dark mode", glyph: "dot" },
];

const FOOTER_ITEM_RENDERERS: Record<string, () => ReactNode> = {
  settings: () => <MiniIcon icon="Settings" className="size-4" />,
  "plugin-footer-items": () => (
    <span className="flex items-center gap-1.5">
      <span className="flex size-5.5 items-center justify-center rounded-md">
        <PluginGlyph className="size-3.5" />
      </span>
      <span className="flex size-5.5 items-center justify-center rounded-md bg-state-hover">
        <PluginGlyph className="size-3.5" />
      </span>
    </span>
  ),
  "bug-report": () => <MiniIcon icon="Bug" className="size-4" />,
};

const SIDEBAR_SECTION_RENDERERS: Record<string, () => ReactNode> = {
  "top-reserve": () => (
    <div
      data-guide-fixture="sidebar-top-reserve"
      className="flex h-12 items-center justify-end px-2"
    >
      <MiniIcon icon="ChevronLeft" className="size-3.5" />
      <MiniIcon icon="ChevronRight" className="ml-1.5 size-3.5" />
    </div>
  ),
  "sidebar-navigation": () => (
    <RegionMark
      id="sidebar-navigation"
      label="The sidebar navigation controls, replaceable by one plugin"
      showChip={false}
    >
      <div
        data-guide-fixture="sidebar-navigation-primary-actions"
        className="space-y-0.5 px-2 py-2"
      >
        <span className="flex h-6.5 items-center gap-2 rounded-md px-2 text-foreground">
          <MiniIcon icon="MessageSquarePlus" className="text-foreground" />
          New thread
        </span>
        <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
          <MiniIcon icon="Search" />
          Search threads
        </span>
        <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
          <MiniIcon icon="Plug02" />
          Plugins
        </span>
        <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
          <MiniIcon icon="Zap" />
          Skills
        </span>
      </div>
      <Mark
        id="nav-panel"
        label="Plugin nav panels, above the thread list"
        className="mx-1.5 z-[2] block space-y-0.5 px-2 pb-2"
        showChip={false}
      >
        <span className="flex h-6.5 items-center gap-2 rounded-md bg-sidebar-accent px-2 font-medium text-sidebar-foreground">
          <PluginGlyph />
          Your panel
        </span>
      </Mark>
    </RegionMark>
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
          <MiniIcon icon="ChevronRight" className="size-3.5" />
        </span>
      ))}
    </RegionMark>
  ),
  footer: () => (
    <Mark
      id="sidebar-footer"
      label="Plugin footer items can run actions or reveal content"
      className="mx-1.5 mb-1.5 flex w-44 flex-col gap-1.5 p-1.5"
    >
      <span className="block w-full overflow-hidden rounded-md border border-border bg-surface-raised-solid">
        <span className="flex h-6 items-center gap-1 border-b border-border px-1.5">
          <span className="flex size-4 items-center justify-center rounded bg-state-hover text-2xs text-foreground">
            A
          </span>
          <span className="flex size-4 items-center justify-center rounded text-2xs">
            B
          </span>
          <span className="ml-auto text-2xs">×</span>
        </span>
        <span className="block space-y-1.5 p-2">
          <span className="flex items-center justify-between text-2xs">
            <span>5-hour limit</span>
            <span className="text-warning">18% left</span>
          </span>
          <span className="block h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full w-4/5 rounded-full bg-warning" />
          </span>
        </span>
      </span>
      <span className="flex w-full items-center gap-2 px-1 py-0.5">
        {anatomy.sidebarFooter.map((key) => (
          <Fragment key={key}>{FOOTER_ITEM_RENDERERS[key]?.()}</Fragment>
        ))}
      </span>
    </Mark>
  ),
};

const MESSAGE_ACTION_RENDERERS: Record<string, () => ReactNode> = {
  copy: () => <MiniIcon icon="Copy" className="size-3.5" />,
  edit: () => <MiniIcon icon="Edit" className="size-3.5" />,
  "add-to-chat": () => (
    <MiniIcon icon="MessageSquarePlus" className="size-3.5" />
  ),
  "send-to-main-thread": () => (
    <MiniIcon icon="ArrowTurnBackward" className="size-3.5" />
  ),
  fork: () => <MiniIcon icon="Fork" className="size-3.5" />,
  "plugin-actions": () => <PluginGlyph className="size-3.5" />,
};

export const ANATOMY_RENDERER_KEYS = {
  appSidebar: Object.keys(SIDEBAR_SECTION_RENDERERS),
  sidebarFooter: Object.keys(FOOTER_ITEM_RENDERERS),
  messageActionBar: Object.keys(MESSAGE_ACTION_RENDERERS),
};

export type AppShellRightPanelTab =
  | "browser-toolbar"
  | "thread-panel"
  | "file-opener"
  | "code-renderers";

function RightPanelTabLaneBadges({ mobile }: { mobile: boolean }) {
  const clipTo = mobile ? '[data-guide-fixture="right-panel-tab-strip"]' : undefined;
  return (
    <>
      <MeasuredBadge
        id="code-renderers"
        label="Plugin code and diff renderers on bb's Diff tab"
        anchor='[data-guide-region="code-renderers"]'
        clipTo={clipTo}
        at="lane"
      />
      <MeasuredBadge
        id="browser-toolbar"
        label="Plugin controls beside the Browser address bar"
        anchor='[data-guide-tab="browser-toolbar"]'
        clipTo={clipTo}
        at="lane"
      />
      <MeasuredBadge
        id="thread-panel"
        label="A plugin tab in the thread side panel"
        anchor='[data-guide-region="thread-panel"]'
        clipTo={clipTo}
        at="lane"
      />
      <MeasuredBadge
        id="file-opener"
        label="A plugin file viewer or editor tab"
        anchor='[data-guide-region="file-opener"]'
        clipTo={clipTo}
        at="lane"
      />
    </>
  );
}

export function CommandPaletteWireframe({
  mobile = false,
}: {
  mobile?: boolean;
}) {
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [releasePanelOpen, setReleasePanelOpen] = useState(false);
  const restoreTimer = useRef<number | undefined>(undefined);

  const openPalette = () => setPaletteOpen(true);
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
      className={cn("relative pb-2 pt-4", mobile ? "px-3" : "px-7")}
    >
      <WindowFrame>
        <div className="relative min-h-[500px]">
          <div
            data-guide-fixture="command-palette-thread"
            className="flex min-h-[500px] bg-background"
          >
            {mobile ? null : (
              <aside className="flex w-48 shrink-0 flex-col border-r border-border-seam bg-sidebar px-2.5 py-3">
                <div className="flex items-center gap-1.5 px-1 text-foreground">
                  <TrafficLights />
                  <span className="ml-auto" />
                  <MiniIcon icon="PanelLeft" className="size-3.5" />
                </div>
                <div className="mt-5 flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground">
                  <MiniIcon icon="MessageSquarePlus" className="size-3.5" />
                  New thread
                </div>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <MiniIcon icon="Search" className="size-3.5" />
                  Search threads
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
                  <MiniIcon icon="Settings" className="size-3.5" />
                  Settings
                </div>
              </aside>
            )}

            <main
              className={cn(
                "min-w-0 flex-1 flex-col",
                mobile && releasePanelOpen && !paletteOpen ? "hidden" : "flex",
              )}
            >
              <header className="flex h-12 items-center gap-2 border-b border-border-hairline px-4">
                <span className="truncate text-foreground">
                  Ship release candidate
                </span>
                <MiniIcon icon="MoreHorizontal" className="size-3.5" />
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={openPalette}
                  aria-label="Open Quick palette (Shift Command P)"
                  data-guide-fixture="command-palette-shortcut"
                  className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-hairline px-2 text-subtle-foreground hover:bg-state-hover hover:text-foreground"
                >
                  <MiniIcon icon="Search" className="size-3.5" />
                  <span>Quick palette</span>
                  {mobile ? null : (
                    <kbd className="rounded bg-surface-recessed px-1.5 py-0.5 font-mono text-2xs text-foreground">
                      ⇧⌘P
                    </kbd>
                  )}
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
                      <MiniIcon icon="GitBranch" className="size-3.5" />
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
                className={cn(
                  "flex shrink-0 flex-col border-l border-border-seam bg-sidebar",
                  mobile ? "w-full" : "w-60",
                )}
              >
                <div className="flex h-12 items-center gap-1.5 border-b border-border-hairline px-3">
                  <span className="flex size-7 items-center justify-center rounded-md">
                    <MiniIcon icon="Info" className="size-3.5" />
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
                className={cn(
                  "absolute grid grid-cols-[minmax(0,1fr)] gap-0 overflow-visible rounded-lg border border-border bg-background shadow-sm",
                  mobile
                    ? "bottom-0 left-7 right-0 pb-4"
                    : "left-1/2 top-[12%] w-full max-w-xl -translate-x-1/2",
                )}
              >
                <div className="flex items-center gap-2 border-b px-3 text-sm">
                  <MiniIcon
                    icon="Search"
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
                <MeasuredBadge
                  id="command-palette-actions"
                  label="Plugin actions in bb's quick command palette"
                  anchor='[data-guide-region="command-palette-actions"]'
                  at="start"
                  flush
                />
              </div>
            </div>
          ) : null}
        </div>
      </WindowFrame>
    </div>
  );
}

export function AppShellWireframe({
  mobile = false,
  mobileScene = "navigation",
}: {
  mobile?: boolean;
  mobileScene?: "navigation" | "conversation" | "panel";
}) {
  const [rightPanelTab, setRightPanelTab] =
    useState<AppShellRightPanelTab>("browser-toolbar");
  const { expandedId } = useSurfaceMap();

  useEffect(() => {
    if (
      expandedId === "browser-toolbar" ||
      expandedId === "code-renderers" ||
      expandedId === "thread-panel" ||
      expandedId === "file-opener"
    ) {
      setRightPanelTab(expandedId);
    }
  }, [expandedId]);

  const scene = mobile ? mobileScene : "desktop";

  return (
    <div
      key={scene}
      data-guide-mobile-scene={mobile ? scene : undefined}
      className={
        mobile
          ? "relative w-full px-6 pb-0 pt-[26px]"
          : "relative w-full px-10 pb-0 pt-[26px]"
      }
    >
      {scene === "desktop" || scene === "navigation" ? (
        <>
          <MeasuredBadge
            id="nav-panel"
            label="Plugin nav panels, above the thread list"
            anchor='[data-guide-region="nav-panel"]'
            at="start"
          />
          <MeasuredBadge
            id="sidebar-navigation"
            label="The sidebar navigation controls, replaceable by one plugin"
            anchor='[data-guide-region="sidebar-navigation"]'
            at="start"
            align="start"
          />
          <MeasuredBadge
            id="thread-list"
            label="The thread list, replaceable by one plugin"
            anchor='[data-guide-region="thread-list"]'
            at="start"
          />
        </>
      ) : null}
      {scene === "desktop" || scene === "conversation" ? (
        <>
          <MeasuredBadge
            id="thread-header"
            label="Plugin thread-header control, left end of the action row"
            anchor='[data-guide-region="thread-header"]'
            at="above"
          />
          <MeasuredBadge
            id="content-scripts"
            label="App-wide plugin scripts, running in the whole window"
            anchor="[data-guide-frame]"
            at="end"
            align="end"
          />
        </>
      ) : null}
      {scene === "desktop" || scene === "panel" ? (
        <RightPanelTabLaneBadges
          key={rightPanelTab}
          mobile={mobile}
        />
      ) : null}
      <AppShellWireframeBody
        scene={scene}
        rightPanelTab={rightPanelTab}
        onRightPanelTabSelect={setRightPanelTab}
      />
    </div>
  );
}

function AppShellWireframeBody({
  scene,
  rightPanelTab,
  onRightPanelTabSelect,
}: {
  scene: "desktop" | "conversation" | "navigation" | "panel";
  rightPanelTab: AppShellRightPanelTab;
  onRightPanelTabSelect: (tab: AppShellRightPanelTab) => void;
}) {
  const { expandedId } = useSurfaceMap();
  const [assistantMessageHovered, setAssistantMessageHovered] = useState(false);
  const contentScripts = useEngagement("content-scripts");
  const messageActionsSelected = expandedId === "message-actions";
  const messageActionRowVisible =
    scene === "conversation" || assistantMessageHovered || messageActionsSelected;

  if (scene === "navigation") {
    return (
      <WindowFrame className="flex min-h-[500px] bg-background">
        <div className="flex w-[76%] flex-col border-r border-border-seam bg-sidebar text-sidebar-foreground">
          <div className="flex h-12 items-center gap-3 px-3 text-sm">
            <MiniIcon icon="PanelLeft" />
            Navigation
          </div>
          {anatomy.appSidebar
            .filter((key) => key !== "top-reserve")
            .map((key) => (
              <Fragment key={key}>
                {SIDEBAR_SECTION_RENDERERS[key]?.()}
              </Fragment>
            ))}
        </div>
      </WindowFrame>
    );
  }
  if (scene === "panel") {
    return (
      <WindowFrame>
        <AppShellRightPanel
          compact
          activeTab={rightPanelTab}
          onTabSelect={onRightPanelTabSelect}
        />
      </WindowFrame>
    );
  }
  const mobile = scene === "conversation";
  return (
    <WindowFrame className="relative overflow-visible">
      <span
        aria-hidden
        data-guide-target="content-scripts"
        className={cn(
          "pointer-events-none absolute inset-0 z-[5] rounded-lg",
          engagedRingClass(contentScripts.outlined),
        )}
      />
      {mobile ? null : (
        <span
          aria-hidden
          data-guide-fixture="sidebar-trigger-overlay"
          className="absolute left-2 top-2.5 z-[4] flex size-7 items-center justify-center rounded-md"
        >
          <MiniIcon icon="PanelLeft" className="size-4" />
        </span>
      )}
      <div
        className={
          mobile
            ? "flex min-h-[500px] items-stretch"
            : "flex min-h-[650px] items-stretch"
        }
      >
        {mobile ? null : (
          <div className="flex w-[300px] shrink-0 flex-col border-r border-border-seam bg-sidebar text-sidebar-foreground">
            {anatomy.appSidebar.map((key) => (
              <Fragment key={key}>
                {SIDEBAR_SECTION_RENDERERS[key]?.()}
              </Fragment>
            ))}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-2 border-b border-border-hairline px-4">
            {mobile ? (
              <MiniIcon icon="PanelLeft" className="size-5" />
            ) : null}
            <span className="truncate text-foreground">
              Fix flaky checkout tests
            </span>
            <MiniIcon icon="MoreHorizontal" className="size-3.5" />
            <span className="flex-1" />
            <Mark
              id="thread-header"
              label="Plugin thread-header control, left end of the action row"
              className="flex h-6.5 items-center gap-1 px-2"
              showChip={false}
            >
              <PluginGlyph className="size-3.5" />
            </Mark>
            {mobile ? (
              <MiniIcon icon="PanelRight" className="size-5" />
            ) : null}
          </div>

          <div
            data-guide-fixture="app-window-timeline"
            className={
              mobile
                ? "flex-1 space-y-7 overflow-hidden px-4 py-6 text-sm leading-relaxed"
                : "min-h-[510px] flex-1 space-y-7 overflow-hidden px-5 py-6"
            }
          >
            <div className="flex justify-end">
              <span className="max-w-[70%] rounded-xl border border-border-seam bg-surface-recessed px-2.5 py-2 leading-snug text-foreground">
                Fix the flaky checkout tests
              </span>
            </div>

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
                      <MiniIcon icon="MessageSquarePlus" className="size-3.5" />
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

        {mobile ? null : (
          <AppShellRightPanel
            activeTab={rightPanelTab}
            onTabSelect={onRightPanelTabSelect}
          />
        )}
      </div>

      <Mark
        id="app-overlay"
        label="App-wide floating plugin interface"
        className={cn(
          "z-[6] flex w-44 items-center gap-2 border border-border bg-popover px-3 py-2 text-foreground shadow-md",
          mobile ? "relative ml-auto mr-4 mb-4" : "absolute bottom-24 right-12",
        )}
      >
        <PluginGlyph className="size-4 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate font-medium">Floating widget</span>
          <span className="block truncate text-2xs text-subtle-foreground">
            2 agents active
          </span>
        </span>
      </Mark>
    </WindowFrame>
  );
}

export function AppShellRightPanel({
  compact = false,
  activeTab,
  onTabSelect,
}: {
  compact?: boolean;
  activeTab: AppShellRightPanelTab;
  onTabSelect: (tab: AppShellRightPanelTab) => void;
}) {
  const tabStripRef = useRef<HTMLDivElement>(null);
  useBrowserLayoutEffect(() => {
    if (!compact) return;
    const strip = tabStripRef.current;
    const label = strip?.querySelector<HTMLElement>(
      `[data-guide-tab="${activeTab}"]`,
    );
    const tab = label?.closest<HTMLElement>("a, button");
    if (!strip || !tab) return;
    const stripBounds = strip.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    if (tabBounds.left < stripBounds.left) {
      strip.scrollLeft += tabBounds.left - stripBounds.left - 12;
    } else if (tabBounds.right > stripBounds.right) {
      strip.scrollLeft += tabBounds.right - stripBounds.right + 12;
    }
  }, [activeTab, compact]);

  const tabClass = (tab: AppShellRightPanelTab) =>
    cn(
      "flex h-7 shrink-0 items-center rounded-md",
      activeTab === tab && "bg-state-hover",
    );

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col bg-sidebar",
        compact
          ? "min-h-[360px] w-full"
          : "w-[380px] border-l border-border-seam",
      )}
    >
      <div
        ref={tabStripRef}
        data-guide-fixture="right-panel-tab-strip"
        className={cn(
          "flex h-12 items-center gap-1.5 border-b border-border-hairline px-3",
          compact && "overflow-x-auto",
        )}
      >
        <span
          data-guide-fixture="right-panel-fixed-tabs"
          className="flex shrink-0 items-center gap-1.5"
        >
          <span
            data-guide-tab="info"
            className="flex h-6 items-center rounded-md px-1.5"
          >
            <MiniIcon icon="Info" className="size-3.5" />
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
              <MiniIcon icon="FileDiff" className="size-3.5" />
              <span className="text-foreground">Diff</span>
            </span>
          </Mark>
        </span>
        <span
          data-guide-fixture="right-panel-content-tabs"
          className={cn(
            "flex items-center gap-1.5",
            compact ? "shrink-0" : "min-w-0",
          )}
        >
          <Mark
            id="browser-toolbar"
            label="Plugin controls beside the Browser address bar"
            className={cn(
              tabClass("browser-toolbar"),
              "gap-1.5 whitespace-nowrap px-2 text-foreground",
            )}
            showChip={false}
            onActivate={() => onTabSelect("browser-toolbar")}
          >
            <span data-guide-tab="browser-toolbar">Browser</span>
          </Mark>
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
              <MiniIcon icon="FileText" className="size-3.5" />
              <span className="text-foreground">retry-notes.md</span>
            </span>
          </Mark>
        </span>
        <span className="flex-1" />
        <MiniIcon icon="Plus" className="size-3.5" />
        <MiniIcon icon="PanelRight" className="size-3.5" />
      </div>
      <div
        data-guide-tab-body={activeTab}
        className={cn(
          "min-h-0 flex-1 p-4",
          compact && "text-sm leading-relaxed",
        )}
      >
        {activeTab === "browser-toolbar" ? (
          <div data-guide-fixture="browser-toolbar" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border-hairline pb-3">
              <MiniIcon icon="ChevronLeft" className="size-3.5" />
              <div className="min-w-0 flex-1 truncate rounded-md bg-surface-recessed px-2 py-1.5 text-subtle-foreground">
                https://example.com
              </div>
              <Mark
                id="browser-toolbar"
                label="Plugin controls beside the Browser address bar"
                className="flex size-7 items-center justify-center"
                showChip={false}
              >
                <PluginGlyph className="size-3.5" />
              </Mark>
            </div>
            <div className="space-y-3 rounded-md border border-border-hairline bg-background p-4">
              <span className="block h-2 w-2/5 rounded-sm bg-foreground/50" />
              <span className="block h-2 w-4/5 rounded-sm bg-muted/60" />
              <span className="block h-2 w-3/5 rounded-sm bg-muted/60" />
            </div>
          </div>
        ) : activeTab === "thread-panel" ? (
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
              <MiniIcon icon="FileText" className="size-3.5" />
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
              <MiniIcon icon="FileDiff" className="size-3.5" />
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

export function RealComposerAnnotated({
  mobile = false,
}: {
  mobile?: boolean;
}) {
  const banners = useEngagement("composer-banners");
  const mention = useEngagement("mention-provider");
  return (
    <div className={cn("relative pb-2 pt-4", mobile ? "px-3" : "px-7")}>
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
            at="above"
          />
          <MeasuredBadge
            id="composer-plus-menu"
            label="Plugin rows in the composer's + menu"
            anchor='[data-guide-target="composer-plus-menu"]'
            at="above"
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
            <div
              aria-hidden
              className="flex h-11 items-center gap-2 border-b border-border-hairline px-4 text-sm"
            >
              <span className="truncate text-foreground">
                Ship the release notes
              </span>
              <MiniIcon icon="MoreHorizontal" className="size-3.5" />
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

            <div className="px-4 pb-4">
              <Mark
                id="composer-banners"
                label="Plugin composer banners, above the prompt box"
                showChip={false}
                target
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
              </Mark>

              <StaticEmbeddedComposer mobile={mobile} />
            </div>
          </div>
        </WindowFrame>
      </div>
    </div>
  );
}

function StaticEmbeddedComposer({ mobile = false }: { mobile?: boolean }) {
  const draft = useEngagement("composer-state");
  const plus = useEngagement("composer-plus-menu");
  const picker = useEngagement("provider-picker");
  const actions = useEngagement("composer-actions");
  return (
    <div data-guide-fixture="embedded-composer" className="space-y-2">
      <div className={cn("relative flex flex-col rounded-xl border border-border bg-background px-2 pb-2 pt-7 shadow-lift", mobile ? "min-h-48 gap-7" : "h-36")}>
        {plus.outlined ? (
          <div
            aria-hidden
            data-guide-transient-for="composer-plus-menu"
            className="pointer-events-none absolute bottom-full left-2 z-20 mb-1 w-44 rounded-md border border-border bg-popover p-1 shadow-md"
          >
            <span className="flex h-6 items-center gap-1.5 px-1.5">
              <MiniIcon icon="Paperclip" className="size-3.5" />
              Attach files
            </span>
            <span className="flex h-6 items-center gap-1.5 px-1.5">
              <MiniIcon icon="Zap" className="size-3.5" />
              Skills
            </span>
            <span className="flex h-6 items-center gap-1.5 rounded bg-state-hover px-1.5 text-foreground">
              <PluginGlyph className="size-3.5" />
              Your action
            </span>
          </div>
        ) : null}

        <div
          className={cn(
            "mx-2 flex items-center rounded-md text-sm leading-none text-foreground",
            mobile ? "min-h-7 flex-wrap gap-y-7" : "h-7",
            engagedRingClass(draft.outlined),
          )}
        >
          <Mark
            id="composer-state"
            label="The draft prompt a plugin can read and lock"
            showChip={false}
            target
            className="whitespace-pre"
          >
            Summarize{" "}
          </Mark>
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

        <div className="mt-auto flex h-10 items-center gap-1">
          <Mark
            id="composer-plus-menu"
            label="Plugin rows in the composer's + menu"
            showChip={false}
            target
            className={cn(
              "flex size-10 items-center justify-center rounded-md",
              engagedRingClass(plus.outlined),
            )}
          >
            <MiniIcon icon="Plus" className="size-4" />
          </Mark>
          <Mark
            id="provider-picker"
            label="Your agent provider and its mark, in the model picker"
            showChip={false}
            target
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-md px-2 text-foreground",
              engagedRingClass(picker.outlined),
            )}
          >
            <ProviderGlyph />
            Fable 5
            {mobile ? null : (
              <span className="text-subtle-foreground">High</span>
            )}
          </Mark>
          <span className="flex-1" />
          <Mark
            id="composer-actions"
            label="Plugin composer actions, before voice and send"
            showChip={false}
            target
            className={cn(
              "flex size-9 items-center justify-center rounded-md bg-state-hover",
              engagedRingClass(actions.outlined),
            )}
          >
            <span data-guide-fixture="plugin-composer-action">
              <PluginGlyph className="size-3.5" />
            </span>
          </Mark>
          <span className="flex size-9 items-center justify-center">
            <MiniIcon icon="Mic" className="size-4" />
          </span>
          <span
            data-guide-icon="CornerDownLeft"
            className="flex size-9 items-center justify-center rounded-md bg-foreground"
          >
            <MiniIcon
              icon="CornerDownLeft"
              className="size-3.5 text-background"
            />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5" aria-hidden>
        <span className="flex items-center gap-1.5">
          <MiniIcon icon="Folder" className="size-3.5" />
          acme-app · worktree
        </span>
        <span>Full Access</span>
      </div>
    </div>
  );
}

export function ComposeScreenWireframe({
  mobile = false,
  panel = false,
}: {
  mobile?: boolean;
  panel?: boolean;
}) {
  if (mobile) {
    return (
      <div className="px-3 pt-4">
        <WindowFrame>
          <div className="flex h-12 items-center gap-3 border-b border-border-seam px-3 text-sm">
            <MiniIcon icon="PanelLeft" className="size-5" />
            <span className="min-w-0 flex-1">New thread</span>
            <MiniIcon icon="PanelRight" className="size-5" />
          </div>
          {panel ? (
            <div
              data-guide-mobile-scene="panel"
              className="min-h-[450px] space-y-3 p-4 text-sm"
            >
              <div className="text-subtle-foreground">Actions</div>
              <div className="flex items-center gap-2 py-2">
                <MiniIcon icon="Globe" />
                Open browser
              </div>
              <div className="flex items-center gap-2 py-2">
                <MiniIcon icon="Terminal" />
                Start terminal
              </div>
              <Mark
                id="new-thread-panel"
                label="A plugin action in the new-thread panel launcher"
                className="flex items-center gap-2 px-3 py-3"
              >
                <PluginGlyph />
                Your action
              </Mark>
            </div>
          ) : (
            <div className="flex min-h-[450px] flex-col justify-end gap-4 p-4 text-sm leading-relaxed">
              <div className="text-xs text-subtle-foreground">
                Recent threads
              </div>
              <div>Fix flaky checkout tests</div>
              <Mark
                id="homepage-section"
                label="A plugin homepage section, in the home content above the mobile composer"
                className="block border border-border-seam p-3"
              >
                <span className="flex items-center gap-2 font-medium">
                  <PluginGlyph />
                  Your section
                </span>
                <span className="mt-3 block">
                  Release 1.4 · Bug triage · Design QA
                </span>
              </Mark>
              <MockHomeComposer />
            </div>
          )}
        </WindowFrame>
      </div>
    );
  }
  return (
    <div className="relative px-7 pb-2 pt-4">
      <MeasuredBadge
        id="new-thread-panel"
        label="A plugin action in the new-thread panel launcher"
        anchor='[data-guide-region="new-thread-panel"]'
        at="end"
      />
      <div>
        <WindowFrame>
          <div className="flex items-center gap-2 border-b border-border-hairline px-3 py-2">
            <TrafficLights />
          </div>
          <div className="flex min-h-[485px] items-stretch">
            <div className="min-w-0 flex-1 px-6 pb-6 pt-4">
              <div className="mx-auto w-full max-w-[560px] space-y-2.5">
                <MockHomeComposer />

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

            <div className="w-[210px] shrink-0 border-l border-border-seam bg-sidebar p-2">
              <span className="block px-1.5 pb-1.5 pt-1 text-xs text-subtle-foreground/75">
                Actions
              </span>
              <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
                <MiniIcon icon="Globe" className="size-3.5" />
                Open browser
              </span>
              <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
                <MiniIcon icon="Terminal" className="size-3.5" />
                Start terminal
              </span>
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
      </div>
    </div>
  );
}

export function SettingsWireframe({ mobile = false }: { mobile?: boolean }) {
  return (
    <WindowFrame>
      <div className="flex items-center gap-2 border-b border-border-hairline px-3 py-2.5">
        {mobile ? (
          <MiniIcon icon="PanelLeft" className="size-5" />
        ) : (
          <TrafficLights />
        )}
        <span className="pl-1 font-medium text-foreground">Settings</span>
      </div>

      <div className="mx-auto min-h-[470px] w-full max-w-[520px] space-y-4 px-4 pb-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center">
            <PluginGlyph className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              Hello
            </span>
            <span className="block truncate pt-1 text-subtle-foreground">
              A friendly example plugin.
            </span>
          </span>
          <Switch
            checked
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none"
          />
        </div>

        <div className="space-y-2">
          <span className="block text-subtle-foreground">Configuration</span>
          <Mark
            id="declarative-settings"
            label="The form bb generates from the fields you declare"
            className="block bg-surface-recessed-solid p-3"
          >
            <span
              className={cn(
                "flex items-start justify-between gap-3 py-1.5",
                mobile && "flex-wrap",
              )}
            >
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
                [set]
              </span>
            </span>
            <span
              className={cn(
                "flex items-start justify-between gap-3 py-1.5",
                mobile && "flex-wrap",
              )}
            >
              <span className="min-w-0">
                <span className="block text-foreground">
                  Case-sensitive search
                </span>
                <span className="block pt-1 leading-relaxed">
                  Match capitalisation when looking things up.
                </span>
              </span>
              <Switch
                checked
                aria-hidden
                tabIndex={-1}
                className="pointer-events-none mt-0.5"
              />
            </span>
            <span
              className={cn(
                "flex items-start justify-between gap-3 py-1.5",
                mobile && "flex-wrap",
              )}
            >
              <span className="min-w-0">
                <span className="block text-foreground">Retry attempts</span>
                <span className="block pt-1 leading-relaxed">
                  Maximum retries before stopping.
                </span>
              </span>
              <span
                aria-hidden
                className="flex h-6 w-32 shrink-0 items-center rounded-md border border-border bg-card px-2 text-xs text-foreground"
              >
                3
              </span>
            </span>
            <span className="block py-1.5">
              <span className="block text-foreground">Custom instructions</span>
              <span className="block pt-1 leading-relaxed">
                Added to every agent task on this host.
              </span>
              <span
                aria-hidden
                className="mt-2 block h-12 rounded-md border border-border bg-card px-2 py-1.5 text-subtle-foreground"
              >
                Keep answers concise and run focused tests.
              </span>
            </span>
          </Mark>

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
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground">Connected as @acme-bot</span>
                <span className="flex h-5.5 items-center rounded-md border border-border px-2 text-foreground">
                  Test connection
                </span>
              </span>
              <span className="block h-2 w-2/3 rounded-sm bg-muted/60" />
            </span>
          </Mark>
        </div>

        <div className="space-y-2 border-t border-border-hairline pt-4">
          <span className="block text-subtle-foreground">Plugin details</span>
          <span className="flex flex-wrap items-center gap-1 leading-relaxed">
            Release, capabilities, and health live on
            <span className="text-foreground underline underline-offset-2">
              its plugin page
            </span>
            <MiniIcon icon="ChevronRight" className="size-3.5" />
          </span>
        </div>
      </div>
    </WindowFrame>
  );
}

export function ExtensionsPluginPageWireframe({
  mobile = false,
}: {
  mobile?: boolean;
}) {
  return (
    <WindowFrame>
      <div className="flex h-10 items-center gap-2 border-b border-border-hairline px-3 text-sm">
        {mobile ? (
          <MiniIcon icon="PanelLeft" className="size-5" />
        ) : (
          <TrafficLights />
        )}
        <span className="text-foreground">Plugins</span>
      </div>
      <div className="flex min-h-[470px] flex-col">
        <Mark
          id="plugin-status"
          label="The needs-configuration banner bb shows for a plugin that reports it"
          className="flex items-center gap-2 border-b border-border bg-surface-recessed/55 px-5 py-1.5 text-xs"
          chip="corner-inset"
        >
          <MiniIcon icon="Settings" className="size-3.5 text-warning" />
          <span className="min-w-0 flex-1 font-medium text-foreground">
            Needs configuration
          </span>
          <span className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-2.5 text-xs font-normal text-muted-foreground">
            Open settings
            <MiniIcon icon="ChevronRight" className="size-3" />
          </span>
        </Mark>

        <div className="mx-auto w-full max-w-[560px] space-y-4 px-4 pb-5 pt-4">
          <div className="flex items-center gap-2.5">
            <PluginGlyph className="size-4" />
            <span className="text-sm font-semibold text-foreground">Hello</span>
            <span className="rounded border border-border px-1.5 py-0.5 text-xs">
              BB Official
            </span>
            <span className="flex-1" />
            <Switch
              checked
              aria-hidden
              tabIndex={-1}
              className="pointer-events-none"
            />
            <MiniIcon icon="MoreHorizontal" className="size-3.5" />
          </div>
          <span className="block font-mono text-xs text-subtle-foreground">
            ~/.bb/plugins/hello
          </span>

          <div className="space-y-1.5 border-t border-border-hairline pt-3">
            <span className="block text-foreground">
              A friendly example plugin.
            </span>
          </div>

          <div className="space-y-1.5 border-t border-border-hairline pt-3">
            <span className="block text-subtle-foreground">Configuration</span>
            <span className="flex flex-wrap items-center gap-1 leading-relaxed">
              This plugin is configured from
              <span className="text-foreground underline underline-offset-2">
                its Settings page
              </span>
              <MiniIcon icon="ChevronRight" className="size-3.5" />
            </span>
          </div>

          <div className="space-y-1.5 border-t border-border-hairline pt-3">
            <span className="block text-subtle-foreground">Release</span>
            <span className="block divide-y divide-border-hairline rounded-md border border-border-hairline">
              {[
                ["Delivery", "Updates with bb"],
                ["Version", "0.1.0"],
              ].map(([label, value]) => (
                <span
                  key={label}
                  className="flex items-center gap-3 px-2.5 py-1.5"
                >
                  <span className="w-24 shrink-0 text-foreground">{label}</span>
                  <span>{value}</span>
                </span>
              ))}
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
            <MiniIcon icon="Plus" className="size-3.5" />
          </span>
          <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-foreground">
            <ProviderGlyph />
            Fable 5 · High
          </span>
          <span className="flex-1" />
          <MiniIcon icon="Mic" className="size-3.5" />
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <MiniIcon
              icon="CornerDownLeft"
              className="size-3.5 text-background"
            />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5" aria-hidden>
        <span className="flex items-center gap-1.5">
          <MiniIcon icon="Folder" className="size-3.5" />
          acme-app
          <span className="text-subtle-foreground">· worktree</span>
        </span>
        <span>Full Access</span>
      </div>
    </>
  );
}
