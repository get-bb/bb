import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "@bb/shared-ui/icon";
import { HugeiconsIcon } from "@hugeicons/react";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";

import { cn } from "./cn";
import { SurfaceCard, useSurfaceCard } from "./surface-card";
import { surfaceIcon } from "./plugin-icons";
import {
  fixtureResponsiveStrategy,
  GROUP_BY_SURFACE_ID,
  SURFACE_GROUPS,
  SURFACES_BY_ID,
  type PluginSurface,
  type SurfaceGroup,
} from "./surfaces";
import {
  annotationChipCounterScale,
  CHIP_COUNTER_SCALE_PROPERTY,
  ExperimentalBadge,
  FOCUS_RING_CLASS,
  renderSurfaceCopy,
} from "./annotation";
import {
  SCROLLBAR_HIDDEN_CLASS,
  scrollEdgeFadeStyle,
  useScrollEdges,
} from "./scroll-edges";
import {
  AppShellWireframe,
  CommandPaletteWireframe,
  ComposeScreenWireframe,
  ExtensionsPluginPageWireframe,
  RealComposerAnnotated,
  SettingsWireframe,
  SurfaceMapContext,
  useBrowserLayoutEffect,
  useSurfaceMap,
} from "./wireframes";

export const SURFACE_NUMBERS: ReadonlyMap<string, number> = new Map(
  SURFACE_GROUPS.filter((group) => group.id !== "headless").flatMap((group) =>
    group.surfaces.map((surface, index) => [surface.id, index + 1] as const),
  ),
);

type GuideSlide = Omit<SurfaceGroup, "id"> & {
  id: string;
  groupId: SurfaceGroup["id"];
  appShellScene?: "navigation" | "conversation" | "panel";
  homePanel?: boolean;
};

const DESKTOP_SLIDES: GuideSlide[] = SURFACE_GROUPS.map((group) => ({
  ...group,
  groupId: group.id,
}));
const MOBILE_SLIDES: GuideSlide[] = DESKTOP_SLIDES.flatMap((group) => {
  if (group.id === "composer") {
    return [{
      ...group,
      blurb: "Plugins can add banners, actions, providers, and rich text to the prompt box.",
    }];
  }
  if (group.id === "app-shell") {
    return [
      {
        ...group,
        title: "Sidebar",
        blurb: "Plugins can add navigation, thread status, and footer controls.",
        appShellScene: "navigation" as const,
        surfaces: group.surfaces.filter((surface) => [
          "sidebar-navigation", "nav-panel", "thread-row-status", "thread-list", "sidebar-footer",
        ].includes(surface.id)),
      },
      {
        ...group,
        id: "app-shell-thread",
        title: "Thread",
        blurb: "Plugins can extend the thread header, conversation, and composer.",
        appShellScene: "conversation" as const,
        surfaces: group.surfaces.filter((surface) => [
          "thread-header", "timeline-renderers", "message-directives", "message-actions",
          "pending-interaction", "app-overlay", "content-scripts",
        ].includes(surface.id)),
      },
      {
        ...group,
        id: "app-shell-panel",
        title: "Side panel",
        blurb: "Explore plugin controls and content in the side panel’s tabs.",
        appShellScene: "panel" as const,
        surfaces: group.surfaces.filter((surface) => [
          "code-renderers", "browser-toolbar", "thread-panel", "file-opener",
        ].includes(surface.id)),
      },
    ];
  }
  if (group.id === "home") {
    return [
      {
        ...group,
        surfaces: group.surfaces.filter((surface) => surface.id === "homepage-section"),
      },
      {
        ...group,
        id: "home-actions",
        title: "New thread actions",
        blurb: "Plugins can add an action to the new-thread panel launcher.",
        homePanel: true,
        surfaces: group.surfaces.filter((surface) => surface.id === "new-thread-panel"),
      },
    ];
  }
  return [group];
});

export function annotationNeighbors(
  surfaces: readonly PluginSurface[],
  currentId: string,
): { previous: PluginSurface | null; next: PluginSurface | null } {
  const currentIndex = surfaces.findIndex(
    (surface) => surface.id === currentId,
  );
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }
  return {
    previous: surfaces[currentIndex - 1] ?? null,
    next: surfaces[currentIndex + 1] ?? null,
  };
}

function PlatformCard({ surface }: { surface: PluginSurface }) {
  const { activeId, setActiveId, expandedId, onSelect } = useSurfaceMap();
  const selected = activeId === surface.id || expandedId === surface.id;
  const icon = surfaceIcon(surface.id);
  return (
    <a
      href={`#surface-${surface.id}`}
      aria-label={`${surface.title} — jump to details`}
      onClick={
        onSelect
          ? (event) => {
              event.preventDefault();
              onSelect(surface.id);
            }
          : undefined
      }
      onMouseEnter={() => setActiveId(surface.id)}
      onMouseLeave={() => setActiveId(null)}
      className={cn(
        "flex h-full items-center gap-3 rounded-lg border px-4 py-4 transition-colors",
        FOCUS_RING_CLASS,
        selected
          ? "border-border bg-surface-selected"
          : "border-border-hairline bg-surface-raised-solid hover:border-border hover:bg-state-hover",
      )}
    >
      {icon ? (
        <HugeiconsIcon
          icon={icon}
          className={cn(
            "size-4 shrink-0",
            selected ? "text-file-accent" : "text-foreground",
          )}
        />
      ) : null}
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {surface.title}
          </span>
          {surface.experimental ? <ExperimentalBadge /> : null}
        </span>
        <span className="line-clamp-2 text-sm text-muted-foreground @3xl:line-clamp-1">
          {renderSurfaceCopy(surface.tagline ?? surface.summary)}
        </span>
      </span>
    </a>
  );
}

function PlatformSlide({ group }: { group: GuideSlide }) {
  return (
    <div className="space-y-3">
      {(group.sections ?? []).map((section) => {
        const surfaces = section.surfaceIds
          .map((id) => SURFACES_BY_ID.get(id))
          .filter((surface): surface is PluginSurface => Boolean(surface));
        return (
          <section key={section.title} aria-label={section.title}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
              {section.title}
            </h3>
            <ul className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {surfaces.map((surface) => (
                <li key={surface.id} className="min-w-0">
                  <PlatformCard surface={surface} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export const MAX_FIXTURE_SCALE = 1.2;

export function spatialFixtureScale(
  availableWidth: number,
  authoredWidth: number,
  availableHeight?: number,
  authoredHeight?: number,
): number {
  if (availableWidth <= 0 || authoredWidth <= 0) return 1;
  const heightScale =
    availableHeight !== undefined &&
    authoredHeight !== undefined &&
    availableHeight > 0 &&
    authoredHeight > 0
      ? availableHeight / authoredHeight
      : Number.POSITIVE_INFINITY;
  return Math.min(
    MAX_FIXTURE_SCALE,
    availableWidth / authoredWidth,
    heightScale,
  );
}

const FIXTURE_WIDTH_BANDS: Record<
  string,
  { min: number; max: number } | undefined
> = {
  "app-shell": { min: 1260, max: 1440 },
  "command-palette": { min: 860, max: 1200 },
  composer: { min: 720, max: 768 },
  home: { min: 560, max: 1080 },
  settings: { min: 640, max: 900 },
  extensions: { min: 640, max: 900 },
};

function SpatialFixture({
  band,
  maxScale = MAX_FIXTURE_SCALE,
  children,
}: {
  band?: { min: number; max: number };
  maxScale?: number;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const fixtureRef = useRef<HTMLDivElement>(null);
  const cardReserveRef = useRef(0);
  const [geometry, setGeometry] = useState({
    scale: 1,
    height: null as number | null,
    width: null as number | null,
    offsetX: 0,
  });

  useBrowserLayoutEffect(() => {
    const frame = frameRef.current;
    const fixture = fixtureRef.current;
    if (!frame || !fixture) return;
    const viewport = frame.closest<HTMLElement>("[data-guide-stage-viewport]");

    const measure = () => {
      const authoredWidth = fixture.scrollWidth;
      const authoredHeight = fixture.scrollHeight;
      const flowCard = frame
        .closest("section")
        ?.querySelector<HTMLElement>("[data-guide-card-flow]");
      if (flowCard) {
        cardReserveRef.current = Math.max(
          cardReserveRef.current,
          flowCard.getBoundingClientRect().height +
            parseFloat(getComputedStyle(flowCard).marginTop || "0"),
        );
      } else {
        cardReserveRef.current = 0;
      }
      const probe = frame
        .closest("[data-map-section]")
        ?.querySelector<HTMLElement>("[data-guide-card-probe]");
      let probeReserve = 0;
      if (probe) {
        for (const item of Array.from(probe.children)) {
          if (!(item instanceof HTMLElement)) continue;
          probeReserve = Math.max(
            probeReserve,
            item.offsetHeight +
              parseFloat(getComputedStyle(item).marginTop || "0"),
          );
        }
      }
      const cardFootprint = flowCard
        ? Math.max(probeReserve, cardReserveRef.current)
        : 0;
      const availableHeight =
        viewport && frame.clientWidth >= 640
          ? viewport.clientHeight -
            (frame.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top +
              viewport.scrollTop) -
            cardFootprint -
            8
          : undefined;
      const scale = Math.min(
        maxScale,
        spatialFixtureScale(
          frame.clientWidth,
          authoredWidth,
          availableHeight,
          authoredHeight,
        ),
      );
      const scaled = Math.abs(scale - 1) >= 0.0001;
      const height = authoredHeight * scale;
      const width = scaled ? authoredWidth : null;
      const offsetX = scaled ? (frame.clientWidth - authoredWidth) / 2 : 0;
      setGeometry((current) =>
        Math.abs(current.scale - scale) < 0.0001 &&
        current.height === height &&
        current.width === width &&
        Math.abs(current.offsetX - offsetX) < 0.5
          ? current
          : { scale, height, width, offsetX },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(fixture);
    if (viewport) observer.observe(viewport);
    const probeRoot = frame
      .closest("[data-map-section]")
      ?.querySelector("[data-guide-card-probe]");
    if (probeRoot?.firstElementChild) {
      observer.observe(probeRoot.firstElementChild);
    }
    const section = frame.closest("section");
    let observedCard: Element | null = null;
    const watchCard = () => {
      const card = section?.querySelector("[data-guide-card-flow]") ?? null;
      if (card === observedCard) return;
      if (observedCard) observer.unobserve(observedCard);
      observedCard = card;
      if (card) observer.observe(card);
      measure();
    };
    watchCard();
    const cardObserver = section ? new MutationObserver(watchCard) : null;
    cardObserver?.observe(section as Node, { childList: true });
    return () => {
      observer.disconnect();
      cardObserver?.disconnect();
    };
  }, [maxScale]);

  const scaled = geometry.width !== null;
  return (
    <div
      ref={frameRef}
      data-guide-responsive-strategy="scale-together"
      data-guide-scale={geometry.scale.toFixed(4)}
      className="w-full overflow-x-clip transition-[height] duration-300 ease-out"
      style={{ height: geometry.height ?? undefined }}
    >
      <div
        ref={fixtureRef}
        className="mx-auto w-full origin-top transition-transform duration-300 ease-out"
        style={
          {
            minWidth: band?.min,
            maxWidth: band?.max,
            [CHIP_COUNTER_SCALE_PROPERTY]: annotationChipCounterScale(
              geometry.scale,
            ),
            ...(scaled
              ? {
                  transform: `scale(${geometry.scale})`,
                  width: geometry.width ?? undefined,
                  marginLeft: geometry.offsetX,
                  marginRight: 0,
                }
              : undefined),
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

function SlideContent({
  group,
  mobile = false,
}: {
  group: GuideSlide;
  mobile?: boolean;
}) {
  switch (group.groupId) {
    case "app-shell":
      return <AppShellWireframe mobile={mobile} mobileScene={group.appShellScene} />;
    case "command-palette":
      return <CommandPaletteWireframe mobile={mobile} />;
    case "composer":
      return <RealComposerAnnotated mobile={mobile} />;
    case "home":
      return <ComposeScreenWireframe mobile={mobile} panel={group.homePanel} />;
    case "settings":
      return <SettingsWireframe mobile={mobile} />;
    case "extensions":
      return <ExtensionsPluginPageWireframe mobile={mobile} />;
    case "headless":
      return <PlatformSlide group={group} />;
  }
}

const PROBE_NOOP = () => {};
const PROBE_COPY = async () => false;

function CardReserveProbe({ group }: { group: GuideSlide }) {
  const { numberOf } = useSurfaceMap();
  return (
    <div
      inert
      aria-hidden
      data-guide-card-probe
      className="invisible h-0 overflow-hidden"
    >
      {group.surfaces.map((surface) => (
        <div
          key={surface.id}
          className="mt-[clamp(8px,var(--guide-stage-gap,8px),28px)] w-full"
        >
          <SurfaceCard
            probe
            surface={surface}
            number={numberOf(surface.id)}
            onDismiss={PROBE_NOOP}
            onCopyForAgent={PROBE_COPY}
            navigation={{
              ...annotationNeighbors(group.surfaces, surface.id),
              onOpen: PROBE_NOOP,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Slide({
  group,
  mobile,
  viewportMobile,
}: {
  group: GuideSlide;
  mobile: boolean;
  viewportMobile: boolean;
}) {
  if (mobile && viewportMobile && group.id !== "headless") {
    return (
      <div
        data-guide-responsive-strategy="mobile"
        className="mx-auto w-full max-w-[430px]"
      >
        <SlideContent group={group} mobile />
      </div>
    );
  }
  if (fixtureResponsiveStrategy(group) === "reflow") {
    return (
      <div data-guide-responsive-strategy="reflow" className="w-full">
        <SlideContent group={group} />
      </div>
    );
  }
  return (
    <>
      <SpatialFixture
        band={mobile ? { min: 430, max: 430 } : FIXTURE_WIDTH_BANDS[group.groupId]}
        maxScale={mobile ? 1 : MAX_FIXTURE_SCALE}
      >
        <SlideContent group={group} mobile={mobile} />
      </SpatialFixture>
      <CardReserveProbe group={group} />
    </>
  );
}

function SlideTitle({ title }: { title: string }) {
  const parts = title.split(/\bbb\b/);
  if (parts.length === 1) {
    return <>{title}</>;
  }
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="font-bold italic">bb</span> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export function panCarets(
  index: number,
  slideCount: number,
): { previous: boolean; next: boolean } {
  return { previous: index > 0, next: index < slideCount - 1 };
}

function PanButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${direction === "previous" ? "Previous" : "Next"} surface`}
      className={cn(
        "inline-flex size-10 @2xl/guide:size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
        FOCUS_RING_CLASS,
      )}
    >
      <Icon
        name={direction === "previous" ? "ChevronLeft" : "ChevronRight"}
        className="size-4"
      />
    </button>
  );
}

function useStageHeight(
  index: number,
  slideRefs: React.RefObject<Array<HTMLDivElement | null>>,
): { height: number | null; animate: boolean } {
  const [height, setHeight] = useState<number | null>(null);
  const [animate, setAnimate] = useState(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setAnimate(true);
    const timer = window.setTimeout(() => setAnimate(false), 350);
    return () => window.clearTimeout(timer);
  }, [index]);
  useEffect(() => {
    const slide = slideRefs.current[index];
    if (!slide) {
      return;
    }
    const measure = () => setHeight(slide.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slide);
    return () => observer.disconnect();
  }, [index, slideRefs]);
  return { height, animate };
}

export function ProductMap({
  pluginPageHref,
  renderPluginIcon,
  initialSlideId,
  onSlideChange,
  onCopyForAgent,
}: {
  pluginPageHref?: (displayName: string) => string | null;
  renderPluginIcon?: (displayName: string) => ReactNode;
  initialSlideId?: string;
  onSlideChange?: (slideId: string) => void;
  onCopyForAgent?: (surface: PluginSurface) => Promise<boolean>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pageListRef = useRef<HTMLDivElement>(null);
  const pageButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const card = useSurfaceCard();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewportMobile, setViewportMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(max-width: 767px)").matches === true,
  );
  const [displayMode, setDisplayMode] = useState<"mobile" | "desktop" | null>(
    null,
  );
  const mobile =
    displayMode === null ? viewportMobile : displayMode === "mobile";
  const slides = mobile ? MOBILE_SLIDES : DESKTOP_SLIDES;
  const numbers = useMemo(() => new Map(
    slides.filter((slide) => slide.groupId !== "headless").flatMap((slide) =>
      slide.surfaces.map((surface, index) => [surface.id, index + 1] as const),
    ),
  ), [slides]);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 767px)");
    if (!query) return;
    const update = () => setViewportMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const selectSurface = (id: string) => {
    setSelectedId(id);
    card.open(id);
  };
  const pageListEdges = useScrollEdges(pageListRef);
  const [slideId, setSlideId] = useState(initialSlideId ?? "app-shell");
  const selectedSlide = MOBILE_SLIDES.find((slide) => slide.id === slideId);
  const index = Math.max(0, slides.findIndex((slide) =>
    slide.id === slideId || (!mobile && slide.id === selectedSlide?.groupId),
  ));
  const stage = useStageHeight(index, slideRefs);

  useEffect(() => {
    if (viewportMobile) return;
    const list = pageListRef.current;
    const button = pageButtonRefs.current[index];
    if (!list || !button) return;
    const listRect = list.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const leftDelta = buttonRect.left - listRect.left;
    const rightDelta = buttonRect.right - listRect.right;
    if (leftDelta < 0) list.scrollLeft += leftDelta;
    else if (rightDelta > 0) list.scrollLeft += rightDelta;
  }, [index, viewportMobile]);

  const openSurface = card.openId ? SURFACES_BY_ID.get(card.openId) : undefined;
  const carets = panCarets(index, slides.length);

  const show = (next: number) => {
    if (next === index || next < 0 || next >= slides.length) {
      return;
    }
    card.close();
    setSelectedId(null);
    setHoverId(null);
    setSlideId(slides[next].id);
    onSlideChange?.(slides[next].id);
  };

  const goToSurface = (id: string) => {
    const group = GROUP_BY_SURFACE_ID.get(id);
    if (!group) return;
    const target = slides.findIndex((slide) =>
      slide.surfaces.some((surface) => surface.id === id),
    );
    if (target === -1) return;
    if (target !== index) show(target);
    selectSurface(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLSelectElement) return;
    if (event.target instanceof Element && event.target.closest('[role="dialog"]')) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(index - 1);
    }
  };

  const mapState = useMemo(
    () => ({
      activeId: hoverId,
      setActiveId: setHoverId,
      expandedId: card.openId ?? selectedId,
      numberOf: (id: string) => numbers.get(id) ?? null,
      onSelect: selectSurface,
      pluginPageHref,
      renderPluginIcon,
      currentGroupId: slides[index].groupId,
      onGoToSurface: goToSurface,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hoverId,
      card.openId,
      pluginPageHref,
      renderPluginIcon,
      index,
      selectedId,
      mobile,
      slides,
      numbers,
    ],
  );

  const cardNode = openSurface ? (
    <SurfaceCard
      surface={openSurface}
      mobile={viewportMobile}
      number={numbers.get(openSurface.id) ?? null}
      onDismiss={card.close}
      onCopyForAgent={onCopyForAgent}
      navigation={{
        ...annotationNeighbors(slides[index].surfaces, openSurface.id),
        onOpen: selectSurface,
      }}
    />
  ) : null;
  useEffect(() => {
    if (card.openId === null) return;
    const container = containerRef.current;
    if (container === null) return;
    const scope =
      container.closest<HTMLElement>("[data-bb-plugin]") ?? container;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[role="dialog"]')) return;
      if (
        target.closest(
          'a[href^="#surface-"], [data-guide-display-mode]',
        )
      )
        return;
      card.close();
    };
    scope.addEventListener("pointerdown", onPointerDown);
    return () => scope.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.openId]);

  return (
    <SurfaceMapContext.Provider value={mapState}>
      <div ref={containerRef} className="@container/guide relative">
        <div data-map-column className="mx-auto w-full max-w-[100rem]">
          <section
            aria-roledescription="carousel"
            aria-label="bb surfaces a plugin can extend"
            onKeyDown={onKeyDown}
            className="mt-2"
          >
            <div className="mb-3 border-b border-border-hairline pb-3">
              <h2 className="text-base font-semibold">
                <SlideTitle title={slides[index].title} />
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-subtle-foreground/75">
                {slides[index].blurb}
              </p>
            </div>
            <div
              data-guide-navigation-toolbar
              className="flex w-full items-center gap-2"
            >
              <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
                <PanButton
                  direction="previous"
                  disabled={!carets.previous}
                  onClick={() => show(index - 1)}
                />
                <div
                  ref={pageListRef}
                  data-guide-page-list-scroll
                  data-no-secondary-panel-swipe
                  className={cn(
                    viewportMobile
                      ? "min-w-0 flex-1 touch-pan-y overflow-hidden"
                      : "min-w-0 overflow-x-auto",
                    SCROLLBAR_HIDDEN_CLASS,
                  )}
                  style={
                    viewportMobile
                      ? undefined
                      : scrollEdgeFadeStyle(
                          pageListEdges.canScrollLeft,
                          pageListEdges.canScrollRight,
                        )
                  }
                  onTouchStartCapture={(event) => {
                    suppressClickUntil.current = 0;
                    const touch = event.touches[0];
                    touchStart.current =
                      viewportMobile && event.touches.length === 1 && touch
                        ? { x: touch.clientX, y: touch.clientY }
                        : null;
                  }}
                  onTouchCancelCapture={() => {
                    touchStart.current = null;
                  }}
                  onTouchEndCapture={(event) => {
                    const start = touchStart.current;
                    touchStart.current = null;
                    const touch = event.changedTouches[0];
                    if (!start || !touch) return;
                    const dx = touch.clientX - start.x;
                    const dy = touch.clientY - start.y;
                    if (Math.abs(dx) < 30 || Math.abs(dx) <= Math.abs(dy))
                      return;
                    suppressClickUntil.current = Date.now() + 500;
                    show(index + (dx < 0 ? 1 : -1));
                  }}
                  onClickCapture={(event) => {
                    if (Date.now() >= suppressClickUntil.current) return;
                    suppressClickUntil.current = 0;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <ul
                    className={
                      viewportMobile
                        ? "flex w-full flex-nowrap items-center"
                        : "flex w-max flex-nowrap items-center gap-1"
                    }
                  >
                    {slides.map((entry, slideIndex) => (
                      <li
                        key={entry.id}
                        hidden={viewportMobile && slideIndex !== index}
                        className={cn("shrink-0", viewportMobile && "w-full")}
                      >
                        <button
                          ref={(element) => {
                            pageButtonRefs.current[slideIndex] = element;
                          }}
                          type="button"
                          onClick={() => show(slideIndex)}
                          aria-current={
                            slideIndex === index ? "true" : undefined
                          }
                          className={cn(
                            "cursor-pointer whitespace-nowrap rounded-md px-2.5 py-2.5 text-sm @2xl/guide:py-1 @2xl/guide:text-xs transition-colors",
                            viewportMobile && "block w-full truncate",
                            FOCUS_RING_CLASS,
                            slideIndex === index
                              ? "bg-surface-selected text-foreground"
                              : "text-subtle-foreground hover:bg-state-hover hover:text-foreground",
                          )}
                        >
                          {entry.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <PanButton
                  direction="next"
                  disabled={!carets.next}
                  onClick={() => show(index + 1)}
                />
              </div>
              <div
                data-guide-display-mode
                role="group"
                aria-label="Preview layout"
                className="flex shrink-0 items-center gap-0.5 border-l border-border-hairline pl-2"
              >
                {(["mobile", "desktop"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={
                      mode === "mobile" ? "Mobile layout" : "Desktop layout"
                    }
                    title={
                      mode === "mobile" ? "Mobile layout" : "Desktop layout"
                    }
                    aria-pressed={(mobile ? "mobile" : "desktop") === mode}
                    onClick={() => setDisplayMode(mode)}
                    className={cn(
                      "inline-flex size-10 @2xl/guide:size-8 cursor-pointer items-center justify-center rounded-md",
                      FOCUS_RING_CLASS,
                      (mobile ? "mobile" : "desktop") === mode
                        ? "bg-surface-selected text-foreground"
                        : "text-muted-foreground hover:bg-state-hover",
                    )}
                  >
                    <HugeiconsIcon
                      icon={mode === "mobile" ? SmartPhone01Icon : ComputerIcon}
                      className="size-4"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </div>
            <div
              className={cn(
                "overflow-x-clip",
                stage.animate && "transition-[height] duration-300 ease-out",
              )}
              style={{
                ...(stage.height === null
                  ? undefined
                  : { height: stage.height }),
                clipPath: "inset(0 0 -24rem 0)",
              }}
            >
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{ transform: `translateX(-${index * 100}%)` }}
              >
                {slides.map((entry, slideIndex) => (
                  <div
                    key={entry.id}
                    data-map-section={entry.id}
                    ref={(element) => {
                      slideRefs.current[slideIndex] = element;
                    }}
                    inert={slideIndex !== index}
                    style={
                      slideIndex === index || stage.height === null
                        ? undefined
                        : { maxHeight: stage.height, overflow: "hidden" }
                    }
                    className="min-w-0 w-full shrink-0 self-start px-1 pt-2"
                  >
                    <Slide group={entry} mobile={mobile} viewportMobile={viewportMobile} />
                  </div>
                ))}
              </div>
            </div>

            {cardNode ? (
              <div
                data-guide-card-flow
                className="mx-auto mt-[clamp(8px,var(--guide-stage-gap,8px),28px)] w-full"
              >
                {cardNode}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </SurfaceMapContext.Provider>
  );
}
