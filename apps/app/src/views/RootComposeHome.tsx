import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { OverflowFade } from "@bb/shared-ui/overflow-fade";
import { cn } from "@bb/shared-ui/lib/utils";
import { PAGE_SHELL_CONTENT_STYLE } from "@/components/ui/page-shell-content-style.js";
import { ComposerMaxHeightContext } from "@/components/promptbox/composer-max-height";
import { composerRootWithin } from "@/lib/pane-composer-focus";
import {
  MOBILE_RECENT_LABEL_HEIGHT_PX,
  MOBILE_RECENT_ROW_HEIGHT_PX,
} from "./RootComposeMobileRecents";

const COMPACT_HOME_CHROME_OFFSET_PX = 56;
const COMPACT_HOME_COLUMN_CLASS = "mx-auto w-full max-w-[760px] px-4";
const ROOT_COMPOSE_MAX_WIDTH_CLASS = "max-w-[760px]";
const COMPACT_HOME_REST_VISIBLE_ROWS = 4.5;
const COMPACT_HOME_REST_BAND_PX =
  COMPACT_HOME_REST_VISIBLE_ROWS * MOBILE_RECENT_ROW_HEIGHT_PX +
  MOBILE_RECENT_LABEL_HEIGHT_PX;

export function getCompactHomeLeadingSpace({
  regionHeight,
  composerHeight,
}: {
  regionHeight: number;
  composerHeight: number;
}): number {
  return Math.max(
    MOBILE_RECENT_ROW_HEIGHT_PX,
    regionHeight -
      composerHeight -
      COMPACT_HOME_REST_BAND_PX -
      COMPACT_HOME_CHROME_OFFSET_PX,
  );
}

interface RootComposeHomeProps {
  isCompact: boolean;
  composer: ReactNode;
  compactScrollContent: ReactNode;
  homepageSections: ReactNode;
  wideContentClassName?: string;
}

function useCompactHomeMetrics(isCompact: boolean) {
  const regionRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const leadingSpacerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const composerFadeRef = useRef<HTMLDivElement>(null);
  const [composerMaxHeight, setComposerMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!isCompact) return;
    const region = regionRef.current;
    const composer = composerRef.current;
    const scrollViewport = scrollViewportRef.current;
    const scrollContent = scrollContentRef.current;
    const leadingSpacer = leadingSpacerRef.current;
    const bottomSpacer = bottomSpacerRef.current;
    const composerFade = composerFadeRef.current;
    if (
      !region ||
      !composer ||
      !scrollViewport ||
      !scrollContent ||
      !leadingSpacer ||
      !bottomSpacer ||
      !composerFade
    ) {
      return;
    }
    const measure = () => {
      const composerRoot = composerRootWithin(composer);
      if (composerRoot) {
        const surroundingHeight =
          composer.offsetHeight - composerRoot.offsetHeight;
        setComposerMaxHeight(
          region.offsetHeight -
            COMPACT_HOME_CHROME_OFFSET_PX -
            surroundingHeight,
        );
      }
      const composerHeight = composer.offsetHeight;
      leadingSpacer.style.height = `${getCompactHomeLeadingSpace({
        regionHeight: region.offsetHeight,
        composerHeight,
      })}px`;
      bottomSpacer.style.height = `${composerHeight}px`;
      composerFade.hidden =
        scrollViewport.scrollHeight <= scrollViewport.clientHeight;
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(composer);
    observer.observe(scrollContent);
    return () => observer.disconnect();
  }, [isCompact]);

  return {
    regionRef,
    composerRef,
    scrollViewportRef,
    scrollContentRef,
    leadingSpacerRef,
    bottomSpacerRef,
    composerFadeRef,
    composerMaxHeight,
  };
}

export function RootComposeHome({
  isCompact,
  composer,
  compactScrollContent,
  homepageSections,
  wideContentClassName,
}: RootComposeHomeProps) {
  const {
    regionRef,
    composerRef,
    scrollViewportRef,
    scrollContentRef,
    leadingSpacerRef,
    bottomSpacerRef,
    composerFadeRef,
    composerMaxHeight,
  } = useCompactHomeMetrics(isCompact);

  return (
    <div
      className={
        isCompact
          ? "@container/page flex min-h-0 flex-1 flex-col"
          : "@container/page min-h-0 flex-1 overflow-y-auto"
      }
      style={isCompact ? PAGE_SHELL_CONTENT_STYLE : undefined}
    >
      <div
        ref={regionRef}
        data-testid="root-compose-compact-home"
        className={
          isCompact
            ? "relative min-h-0 flex-1"
            : cn(
                "mx-auto flex w-full flex-col px-4 pb-4 pt-2",
                ROOT_COMPOSE_MAX_WIDTH_CLASS,
                wideContentClassName,
              )
        }
        style={isCompact ? undefined : PAGE_SHELL_CONTENT_STYLE}
      >
        {isCompact ? (
          <div
            ref={scrollViewportRef}
            data-testid="root-compose-compact-scroll-viewport"
            data-page-scroll-viewport=""
            className="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain"
            style={{ top: COMPACT_HOME_CHROME_OFFSET_PX }}
          >
            <div
              ref={scrollContentRef}
              data-testid="root-compose-compact-scroll-content"
              className="flex min-h-full flex-col justify-end"
            >
              <div
                ref={leadingSpacerRef}
                aria-hidden
                data-testid="root-compose-compact-leading-spacer"
              />
              <div className={COMPACT_HOME_COLUMN_CLASS}>
                {compactScrollContent}
                {homepageSections}
              </div>
              <div
                ref={bottomSpacerRef}
                aria-hidden
                data-testid="root-compose-compact-bottom-spacer"
              />
            </div>
          </div>
        ) : null}
        <div
          ref={composerRef}
          data-testid="root-compose-compact-composer"
          className={isCompact ? "absolute inset-x-0 bottom-0 z-10" : undefined}
        >
          <div ref={composerFadeRef} data-testid="root-compose-compact-fade">
            {isCompact ? (
              <OverflowFade placement="above" tone="background" size="lg" />
            ) : null}
          </div>
          <div className={isCompact ? "bg-background pb-4" : undefined}>
            <div className={isCompact ? COMPACT_HOME_COLUMN_CLASS : undefined}>
              <ComposerMaxHeightContext.Provider
                value={isCompact ? composerMaxHeight : undefined}
              >
                {composer}
              </ComposerMaxHeightContext.Provider>
            </div>
          </div>
        </div>
        {isCompact ? null : homepageSections}
      </div>
    </div>
  );
}
