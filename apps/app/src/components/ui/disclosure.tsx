import { useSetAtom } from "jotai";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { layoutAnimationInFlightCountAtom } from "./layoutAnimationAtoms.js";

const EXPANDABLE_PANEL_TRANSITION_MS = 200;
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ChevronProps {
  className?: string;
}

export const COLLAPSIBLE_HEADER_COLLAPSED_TONE_CLASS =
  "text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground";
export const COLLAPSIBLE_HEADER_EXPANDED_TONE_CLASS = "text-foreground";
export const COLLAPSIBLE_HEADER_STATIC_TONE_CLASS = "text-muted-foreground";
export const COLLAPSIBLE_HEADER_BUTTON_BASE_CLASS =
  "inline-flex max-w-full items-center gap-1 overflow-hidden py-0.5 text-left text-sm";
export const COLLAPSIBLE_HEADER_TEXT_CLASS = "min-w-0 truncate";

function Chevron({ className }: ChevronProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("lucide lucide-chevron-right", className)}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function getCollapsibleHeaderToneClass(isExpanded: boolean): string {
  return isExpanded
    ? COLLAPSIBLE_HEADER_EXPANDED_TONE_CLASS
    : COLLAPSIBLE_HEADER_COLLAPSED_TONE_CLASS;
}

export interface CollapsibleHeaderProps {
  summaryContent: ReactNode;
  toneClassName: string;
  summaryClassName?: string;
  className?: string;
  forceChevronVisible?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function CollapsibleHeader({
  summaryContent,
  toneClassName,
  summaryClassName,
  className,
  forceChevronVisible = false,
  isExpanded = false,
  onToggle,
}: CollapsibleHeaderProps) {
  const rootClassName = cn(
    COLLAPSIBLE_HEADER_BUTTON_BASE_CLASS,
    toneClassName,
    onToggle ? "group/toggle cursor-pointer" : null,
    className,
  );
  const summaryClass = summaryClassName ?? COLLAPSIBLE_HEADER_TEXT_CLASS;

  if (!onToggle) {
    return (
      <div className={rootClassName}>
        <span className={summaryClass}>{summaryContent}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-expanded={isExpanded}
      onClick={onToggle}
      className={rootClassName}
    >
      <span className={summaryClass}>{summaryContent}</span>
      <Chevron
        className={cn(
          "pointer-events-none size-3 shrink-0 origin-center text-subtle-foreground/60 transition-[opacity,rotate] duration-200 ease-out",
          isExpanded
            ? "rotate-90"
            : forceChevronVisible
              ? "opacity-100"
              : // Furled carets reveal only on hover/focus of their own row header
                // (the toggle button), not the wrapping timeline-row group —
                // so hovering a row's body or a nested child doesn't surface a
                // sibling/parent caret.
                "opacity-0 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100 max-md:pointer-coarse:opacity-100",
        )}
      />
    </button>
  );
}

export interface ExpandablePanelProps {
  isExpanded: boolean;
  summaryContent: ReactNode;
  headerToneClass: string;
  onToggle?: () => void;
  collapsedContent?: ReactNode;
  forceHeaderChevronVisible?: boolean;
  headerButtonClassName?: string;
  summaryContentClassName?: string;
  children?: ReactNode;
  renderBody?: () => ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  contentClassName?: string;
}

interface AnimatedExpandablePanelContentProps {
  bodyClassName?: string;
  collapsedContent: ReactNode;
  contentClassName?: string;
  isExpanded: boolean;
  renderedBody: ReactNode;
}

function AnimatedExpandablePanelContent({
  bodyClassName,
  collapsedContent,
  contentClassName,
  isExpanded,
  renderedBody,
}: AnimatedExpandablePanelContentProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useBrowserLayoutEffect(() => {
    const region = regionRef.current;
    const target = contentRef.current;
    if (!region || !target) {
      return;
    }

    const syncHeight = () => {
      region.style.height = `${target.offsetHeight}px`;
    };

    syncHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(syncHeight);
    resizeObserver.observe(target);
    return () => resizeObserver.disconnect();
  }, [collapsedContent, isExpanded, renderedBody]);

  return (
    <div
      ref={regionRef}
      className={cn(
        "relative transition-[height] duration-200 ease-out",
        bodyClassName,
      )}
      style={{
        overflowX: "visible",
        overflowY: "clip",
      }}
    >
      <div ref={contentRef}>
        {isExpanded ? (
          <div className={cn("px-2 pb-1 pt-0", contentClassName)}>
            {renderedBody}
          </div>
        ) : (
          collapsedContent
        )}
      </div>
    </div>
  );
}

export function ExpandablePanel({
  isExpanded,
  summaryContent,
  headerToneClass,
  onToggle,
  collapsedContent,
  forceHeaderChevronVisible = false,
  headerButtonClassName,
  summaryContentClassName,
  children,
  renderBody,
  className,
  headerClassName,
  bodyClassName,
  contentClassName,
}: ExpandablePanelProps) {
  const hasCollapsedContent =
    collapsedContent !== undefined && collapsedContent !== null;
  const headerRootClassName = cn(
    "px-2 py-1",
    headerClassName,
    headerButtonClassName,
  );
  const [isClosing, setIsClosing] = useState(false);
  const renderedBodyRef = useRef<ReactNode>(null);
  const expandedBody = useMemo(() => {
    if (!isExpanded) {
      return null;
    }
    return renderBody ? renderBody() : children;
  }, [children, isExpanded, renderBody]);

  // Signal to AutoHeightContainer / HeightTransition wrappers that a
  // CSS-driven layout animation is in flight, so they snap their wrapper to
  // inner.height each frame instead of running their own lagging 180ms
  // transition. Without this, parent height wrappers can compound with the
  // row's own animation and make the bottom-anchored timeline slide longer
  // than the row's intended 200ms.
  const setLayoutAnimationInFlightCount = useSetAtom(
    layoutAnimationInFlightCountAtom,
  );
  const isFirstAnimationEffectRef = useRef(true);
  useBrowserLayoutEffect(() => {
    if (isFirstAnimationEffectRef.current) {
      isFirstAnimationEffectRef.current = false;
      return;
    }
    setLayoutAnimationInFlightCount((c) => c + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      setLayoutAnimationInFlightCount((c) => Math.max(0, c - 1));
    };
    const timer = window.setTimeout(release, EXPANDABLE_PANEL_TRANSITION_MS);
    return () => {
      window.clearTimeout(timer);
      release();
    };
  }, [isExpanded, setLayoutAnimationInFlightCount]);

  useBrowserLayoutEffect(() => {
    if (!isExpanded) {
      return;
    }
    renderedBodyRef.current = expandedBody;
  }, [expandedBody, isExpanded]);

  useBrowserLayoutEffect(() => {
    if (isExpanded) {
      return;
    }
    if (hasCollapsedContent) {
      renderedBodyRef.current = null;
      setIsClosing(false);
      return;
    }
    if (renderedBodyRef.current === null) {
      return;
    }
    setIsClosing(true);
    const timeout = setTimeout(() => {
      renderedBodyRef.current = null;
      setIsClosing(false);
    }, EXPANDABLE_PANEL_TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [hasCollapsedContent, isExpanded]);
  const renderedBody = isExpanded
    ? expandedBody
    : isClosing
      ? renderedBodyRef.current
      : null;

  return (
    <div className={cn("rounded-md text-muted-foreground", className)}>
      {/* Scope the hover group to the header line only. Putting it on the
          whole panel would let a hover on a nested bundle child (which lives
          in the body below) reveal every sibling row's chevron, since they
          share this panel as a hovered ancestor. */}
      <div className="group/timeline-row">
        <CollapsibleHeader
          isExpanded={isExpanded}
          forceChevronVisible={forceHeaderChevronVisible}
          onToggle={onToggle}
          toneClassName={headerToneClass}
          className={headerRootClassName}
          summaryClassName={
            summaryContentClassName ?? COLLAPSIBLE_HEADER_TEXT_CLASS
          }
          summaryContent={summaryContent}
        />
      </div>
      {hasCollapsedContent ? (
        <AnimatedExpandablePanelContent
          bodyClassName={bodyClassName}
          collapsedContent={collapsedContent}
          contentClassName={contentClassName}
          isExpanded={isExpanded}
          renderedBody={renderedBody}
        />
      ) : (
        <div
          aria-hidden={!isExpanded}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
            isExpanded
              ? "pointer-events-auto grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0",
            bodyClassName,
          )}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "px-2 pb-1 pt-0 transition-[transform,opacity] duration-200 ease-out will-change-transform",
                isExpanded
                  ? "translate-y-0 opacity-100"
                  : "-translate-y-1 opacity-0",
                contentClassName,
              )}
            >
              {renderedBody}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
