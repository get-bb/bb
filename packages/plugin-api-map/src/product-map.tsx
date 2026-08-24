/**
 * The whole product map: one annotated skeleton of the bb UI at a time, panned
 * through with the arrows, with a click on any numbered annotation opening its
 * card in the nearest gutter (or directly below the diagram when no gutter
 * fits).
 *
 * Slides are the surface groups, in order, so the data file decides both what
 * a slide contains and what number each marker gets. The last group has no
 * pixels to point at, so it renders as a conventional docs capability grid:
 * named sections of icon + title + description cards.
 *
 * Rendered identically by the docs site and by the bb plugin; inside bb the
 * plugin hands in the host's real composer twice — live on the Home slide,
 * and inert on the composer slide, where it is annotated in place with both
 * menus drawn open as static popovers. The docs site has no host, so both
 * slides fall back to drawn mocks there.
 */
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import { SurfaceCard, useSurfaceCard } from "./surface-card";
import { surfaceIcon } from "./plugin-icons";
import {
  GROUP_BY_SURFACE_ID,
  SURFACE_GROUPS,
  SURFACES_BY_ID,
  type PluginSurface,
  type SurfaceGroup,
} from "./surfaces";
import { ExperimentalBadge, renderSurfaceCopy } from "./annotation";
import {
  AppShellWireframe,
  ComposerWireframe,
  ComposeScreenWireframe,
  ExtensionsPluginPageWireframe,
  RealComposerAnnotated,
  SettingsWireframe,
  SurfaceMapContext,
  useSurfaceMap,
} from "./wireframes";

/**
 * Marker numbers restart per slide, matching each skeleton's own markers.
 * "Plugin backend" is absent on purpose: it has no skeleton, so a number there
 * would point at nothing.
 */
export const SURFACE_NUMBERS: ReadonlyMap<string, number> = new Map(
  SURFACE_GROUPS.filter((group) => group.id !== "headless").flatMap((group) =>
    group.surfaces.map((surface, index) => [surface.id, index + 1] as const),
  ),
);

/**
 * One capability row in the platform grid: icon, title, one-line tagline.
 * The prose lives in the detail card a click opens, so the grid stays
 * scannable. Same anchor as a skeleton marker, same measurement path.
 */
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
        selected
          ? "border-border bg-surface-selected"
          : // Resting fill one step below hover: a faint opaque lift off the
            // canvas, so idle cards read as cards, and the hover tint still
            // lands a clear step darker.
            "border-border-hairline bg-surface-raised-solid hover:border-border hover:bg-state-hover",
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
        <span className="block truncate text-sm text-muted-foreground">
          {renderSurfaceCopy(surface.tagline ?? surface.summary)}
        </span>
      </span>
    </a>
  );
}

/**
 * The pixel-less slide: small section eyebrows chunking a two-column grid
 * of uniform one-line rows, so the ten capabilities scan in one pass.
 */
function PlatformSlide({ group }: { group: SurfaceGroup }) {
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

/**
 * The width the skeletons are drawn at. Below it they scale down as a whole
 * rather than reflowing: the diagrams teach proportion — where a region sits
 * relative to the rest of the window — and letting fixed-width regions
 * collapse independently would draw a bb that does not exist.
 */
/** Matches the stage's `duration-300` pan, so a followed reference opens
 * its card only once the target slide has actually arrived. */
const SLIDE_PAN_MS = 300;

const DIAGRAM_WIDTH = 900;

/**
 * Scales a skeleton to fit its column when the column is narrower than the
 * width it is drawn at, so a diagram in a half-width split pane shrinks
 * instead of running off the edge.
 */
function FitDiagram({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    if (!host || !content) return;
    const measure = () => {
      const available = host.clientWidth;
      if (available === 0) return;
      const next = Math.min(1, available / DIAGRAM_WIDTH);
      setScale(next);
      // The transform does not affect layout, so the host has to carry the
      // scaled height itself or it would reserve the full untransformed one.
      setHeight(next === 1 ? null : Math.round(content.offsetHeight * next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="min-w-0"
      style={height === null ? undefined : { height }}
    >
      <div
        ref={contentRef}
        style={
          scale === 1
            ? undefined
            : {
                width: DIAGRAM_WIDTH,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }
        }
      >
        {children}
      </div>
    </div>
  );
}

function Slide({
  group,
  realComposer,
  annotatedComposer,
}: {
  group: SurfaceGroup;
  realComposer?: ReactNode;
  /**
   * A second instance of the host composer for the composer-anatomy slide,
   * with its own draft key so edits on the Home slide never move the
   * annotated diagram. Rendered inert; see RealComposerAnnotated.
   */
  annotatedComposer?: ReactNode;
  /**
   * Resolves a shipped plugin's page in the running bb, or null when this
   * host has no page for it. Only the in-app copy can answer that, so the
   * docs website omits it and the "Used by" names render as plain text.
   */
  pluginPageHref?: (displayName: string) => string | null;
}) {
  switch (group.id) {
    case "app-shell":
      return (
        <FitDiagram>
          <AppShellWireframe />
        </FitDiagram>
      );
    case "composer":
      // Inside bb, the diagram is the real host composer rendered inert —
      // authentic proportions, no interactivity, with both menus drawn as
      // static popovers. The docs site has no host, so it keeps the mock.
      // Not scaled: the live composer is a real interactive component, and a
      // CSS transform would blur its text and offset its menus.
      return annotatedComposer ? (
        <RealComposerAnnotated composer={annotatedComposer} />
      ) : (
        <FitDiagram>
          <ComposerWireframe />
        </FitDiagram>
      );
    case "home":
      return <ComposeScreenWireframe composer={realComposer} />;
    case "settings":
      return (
        <FitDiagram>
          <SettingsWireframe />
        </FitDiagram>
      );
    case "extensions":
      return (
        <FitDiagram>
          <ExtensionsPluginPageWireframe />
        </FitDiagram>
      );
    // The capability grid reflows on its own; scaling it would only shrink
    // text that has room to wrap instead.
    case "headless":
      return <PlatformSlide group={group} />;
  }
}

/**
 * A slide title with the bare word "bb" set the way the wordmark reads:
 * bold italic. Text rather than the SVG mark on purpose — at heading size on
 * a 1x display an 11px vector path rasterises to a blob, while the font
 * rasteriser hints glyphs at any size. The title stays a plain string
 * everywhere else — nav labels, aria, tests — so only the rendered heading
 * changes.
 */
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

/**
 * Which pan caret is enabled at `index`. Both carets always render so the
 * row's geometry never changes; an end of the range just disables its caret.
 *
 * Pure so the ends are testable without a layout engine.
 */
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
      // Borderless: the hit area, hover fill, and focus ring carry the
      // affordance, so the outline is chrome the row does not need.
      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      <HugeiconsIcon
        icon={direction === "previous" ? ArrowLeft01Icon : ArrowRight01Icon}
        className="size-4"
      />
    </button>
  );
}

/**
 * Keeps the stage exactly as tall as the slide on show, so a short skeleton
 * does not leave the tallest one's empty space below it.
 */
function useStageHeight(
  index: number,
  slideRefs: React.RefObject<Array<HTMLDivElement | null>>,
): number | null {
  const [height, setHeight] = useState<number | null>(null);
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
  return height;
}

export function ProductMap({
  header,
  realComposer,
  annotatedComposer,
  pluginPageHref,
  initialSlideId,
  onSlideChange,
  onCopyForAgent,
  tone = "primary",
}: {
  /** Page copy above the diagrams; omitted inside compact plugin panels. */
  header?: ReactNode;
  /**
   * The host's real composer (experimental_NewThreadComposer), supplied by
   * the bb plugin. It replaces the mock composer in the skeletons, so the
   * diagram is the actual product. Surfaces with no bb behind them omit it
   * and get the mock.
   */
  realComposer?: ReactNode;
  /**
   * A second host-composer instance for the composer-anatomy slide, seeded
   * with the demo draft under its own draft key so edits on the Home slide
   * never move the annotated diagram. Rendered inert. Omitted on the docs
   * site, which falls back to the drawn mock.
   */
  annotatedComposer?: ReactNode;
  /**
   * Resolves a shipped plugin's page in the running bb, or null when this
   * host has no page for it. Only the in-app copy can answer that, so the
   * docs website omits it and the "Used by" names render as plain text.
   */
  pluginPageHref?: (displayName: string) => string | null;
  /**
   * The slide to open on, by surface-group id. The bb plugin feeds the nav
   * panel's subPath back in here, so leaving the page and coming back (the
   * app's Back button, a shared link) lands on the slide you left.
   */
  initialSlideId?: string;
  /** Fires when the reader pans; the bb plugin mirrors it into the URL. */
  onSlideChange?: (slideId: string) => void;
  /** Copies a surface as a structured bb composer reference. */
  onCopyForAgent?: (surface: PluginSurface) => Promise<boolean>;
  /**
   * "supporting" steps the per-slide heading and blurb down a level, for
   * pages where the map explains the docs rather than leading them. Behavior,
   * markers, and card content are identical either way.
   */
  tone?: "primary" | "supporting";
}) {
  const slides = SURFACE_GROUPS;
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const card = useSurfaceCard();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      slides.findIndex((slide) => slide.id === initialSlideId),
    ),
  );
  const stageHeight = useStageHeight(index, slideRefs);

  const openSurface = card.openId ? SURFACES_BY_ID.get(card.openId) : undefined;
  const carets = panCarets(index, slides.length);

  // Panning away from a card's marker would strand the card, so it closes.
  const show = (next: number) => {
    if (next < 0 || next >= slides.length) {
      return;
    }
    card.close();
    setHoverId(null);
    setIndex(next);
    onSlideChange?.(slides[next].id);
  };

  /**
   * Follows a card's cross-reference: pan to the slide that draws the named
   * surface, then open its card. The open waits for the pan to land because
   * the card measures its marker's live geometry to place itself, and an
   * off-stage marker measures where it is parked, not where it will be.
   */
  const goToSurface = (id: string) => {
    const group = GROUP_BY_SURFACE_ID.get(id);
    if (!group) return;
    const target = slides.findIndex((slide) => slide.id === group.id);
    if (target === -1) return;
    if (target === index) {
      card.open(id);
      return;
    }
    show(target);
    window.setTimeout(() => card.open(id), SLIDE_PAN_MS);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
      // The open card is the selection, so its marker stays lit.
      expandedId: card.openId,
      numberOf: (id: string) => SURFACE_NUMBERS.get(id) ?? null,
      onSelect: card.open,
      pluginPageHref,
      currentGroupId: slides[index].id,
      onGoToSurface: goToSurface,
    }),
    // `card.open` is rebuilt each render by design: it reads live geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hoverId, card.openId, pluginPageHref, index],
  );

  const cardNode = openSurface ? (
    <SurfaceCard
      surface={openSurface}
      number={SURFACE_NUMBERS.get(openSurface.id) ?? null}
      onDismiss={card.close}
      onCopyForAgent={onCopyForAgent}
    />
  ) : null;
  // Click-away, scoped to the plugin's own UI. A pointer-down anywhere in the
  // guide that is not on the open card or on a marker dismisses the card.
  // Beyond the plugin's root — the pane beside it, the sidebar, bb's chrome —
  // the card is left alone, so reading it while working in a split does not
  // lose it. The root is the host's `[data-bb-plugin]` scoping element; with
  // no host (tests, a bare render) the map's own container stands in.
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
      // A marker replaces the card with its own; let its click do that.
      if (target.closest('a[href^="#surface-"]')) return;
      card.close();
    };
    scope.addEventListener("pointerdown", onPointerDown);
    return () => scope.removeEventListener("pointerdown", onPointerDown);
    // `card.close` is a setState call behind a fresh closure each render;
    // re-subscribing per open/close is all that is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.openId]);

  return (
    <SurfaceMapContext.Provider value={mapState}>
      <div ref={containerRef} className="relative">
        <div data-map-column className="mx-auto max-w-5xl">
          {header}

          <section
            aria-roledescription="carousel"
            aria-label="bb surfaces a plugin can extend"
            onKeyDown={onKeyDown}
            className="mt-8"
          >
            {/* The page description and, under a hairline, the navigation —
                fixed above the stage so panning swaps only the diagram. */}
            <div className="mb-3 border-b border-border-hairline pb-3">
              {tone === "supporting" ? (
                <h3 className="text-sm font-medium">
                  <SlideTitle title={slides[index].title} />
                </h3>
              ) : (
                <h2 className="text-base font-semibold">
                  <SlideTitle title={slides[index].title} />
                </h2>
              )}
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-subtle-foreground/75">
                {slides[index].blurb}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <PanButton
                direction="previous"
                disabled={!carets.previous}
                onClick={() => show(index - 1)}
              />
              <ul className="flex flex-wrap items-center justify-center gap-1">
                {slides.map((entry, slideIndex) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => show(slideIndex)}
                      aria-current={slideIndex === index ? "true" : undefined}
                      className={cn(
                        "cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors",
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
              <PanButton
                direction="next"
                disabled={!carets.next}
                onClick={() => show(index + 1)}
              />
            </div>
            <div
              className="transition-[height] duration-300 ease-out"
              style={{
                ...(stageHeight === null ? undefined : { height: stageHeight }),
                // Clip the pan sideways only. `overflow: hidden` would also
                // cut anything the live composer opens downward — its
                // @-mention typeahead is taller than the room under the
                // prompt box — so the stage lets content past its bottom
                // edge and each off-stage slide clips its own height instead.
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
                    // Off-stage slides stay out of the tab order and out of
                    // the accessibility tree until they are panned to.
                    inert={slideIndex !== index}
                    // A taller off-stage slide would show below the stage now
                    // that the stage no longer clips downward, so it keeps to
                    // the stage's height itself. The slide on stage is never
                    // capped: that is what lets the composer's typeahead out.
                    style={
                      slideIndex === index || stageHeight === null
                        ? undefined
                        : { maxHeight: stageHeight, overflow: "hidden" }
                    }
                    // Markers sit slightly outside their region; the padding
                    // keeps them inside the stage's clip. No shared min-height:
                    // the stage measures the slide on stage and animates
                    // between them, so a card opening below sits under the
                    // diagram rather than under the tallest slide's reserved
                    // canvas.
                    className="w-full shrink-0 self-start px-1 py-2"
                  >
                    <Slide
                      group={entry}
                      realComposer={realComposer}
                      annotatedComposer={annotatedComposer}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* The detail card, when no gutter can hold it: in flow, tight
                under the diagram, never covering it. */}
            {cardNode ? <div className="mt-2">{cardNode}</div> : null}
          </section>
        </div>
      </div>
    </SurfaceMapContext.Provider>
  );
}
