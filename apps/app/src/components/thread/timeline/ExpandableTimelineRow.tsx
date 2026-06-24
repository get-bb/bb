import {
  memo,
  useCallback,
  useEffect,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { TimelineTitle } from "@bb/thread-view";
import {
  COLLAPSIBLE_HEADER_STATIC_TONE_CLASS,
  ExpandablePanel,
  getCollapsibleHeaderToneClass,
} from "../../ui/disclosure.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import {
  TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME,
  timelineRowHeaderClassName,
  timelineRowHorizontalPaddingClassName,
  type TimelineRowHorizontalPadding,
} from "./TimelineRowHeader.js";
import {
  TimelineTitleView,
  type TimelineTitleActionResolver,
  type TimelineTitleLinkResolver,
} from "./TimelineTitleView.js";

export interface ExpandableTimelineRowProps {
  autoExpanded?: boolean;
  forceExpanded?: boolean;
  /**
   * Opens terminal frontier rows when they arrive, then latches that visible
   * state until the user toggles the row or the row unmounts.
   */
  terminalAutoExpanded?: boolean;
  onBeforeExpand?: () => void;
  renderBody: () => ReactNode;
  title: TimelineTitle;
  className?: string;
  collapsedPreview?: ReactNode;
  expandable?: boolean;
  horizontalPadding?: TimelineRowHorizontalPadding;
  leadingIcon?: IconName;
  /** Extra classes on the header summary line only (not the expanded body). */
  summaryClassName?: string;
  onTitleAction?: TimelineTitleActionResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
}

type ManualExpansionOverride = boolean | null;
type CollapsedPreviewClickEvent = MouseEvent<HTMLDivElement>;
type CollapsedPreviewFocusEvent = FocusEvent<HTMLDivElement>;
type CollapsedPreviewKeyboardEvent = KeyboardEvent<HTMLDivElement>;

interface InteractivePreviewTargetArgs {
  currentTarget: HTMLDivElement;
  target: EventTarget | null;
}

function headerToneClass(title: TimelineTitle, isExpanded: boolean): string {
  if (title.tone === "summary") {
    return "text-subtle-foreground transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground";
  }
  return getCollapsibleHeaderToneClass(isExpanded);
}

function isInteractivePreviewTarget({
  currentTarget,
  target,
}: InteractivePreviewTargetArgs): boolean {
  if (!(target instanceof Element) || target === currentTarget) {
    return false;
  }
  return target.closest("a,button,input,select,textarea") !== null;
}

function ExpandableTimelineRowComponent({
  autoExpanded = false,
  className,
  collapsedPreview,
  expandable = true,
  forceExpanded = false,
  horizontalPadding = "default",
  leadingIcon,
  onBeforeExpand,
  onTitleAction,
  renderBody,
  resolveSegmentLinkHref,
  summaryClassName,
  terminalAutoExpanded = false,
  title,
}: ExpandableTimelineRowProps) {
  const [manualExpansionOverride, setManualExpansionOverride] =
    useState<ManualExpansionOverride>(null);
  const [terminalAutoExpandedLatch, setTerminalAutoExpandedLatch] =
    useState(terminalAutoExpanded);
  const [collapsedPreviewActive, setCollapsedPreviewActive] = useState(false);
  useEffect(() => {
    if (terminalAutoExpanded) {
      setTerminalAutoExpandedLatch(true);
    }
  }, [terminalAutoExpanded]);
  const isExpanded =
    expandable &&
    (forceExpanded ||
      (manualExpansionOverride ??
        (autoExpanded || terminalAutoExpanded || terminalAutoExpandedLatch)));
  useEffect(() => {
    if (isExpanded) {
      setCollapsedPreviewActive(false);
    }
  }, [isExpanded]);
  const horizontalPaddingClass =
    timelineRowHorizontalPaddingClassName(horizontalPadding);
  const handleToggle = useCallback((): void => {
    if (!isExpanded) {
      onBeforeExpand?.();
    }
    setManualExpansionOverride(!isExpanded);
  }, [isExpanded, onBeforeExpand]);
  const handleCollapsedPreviewClick = useCallback(
    (event: CollapsedPreviewClickEvent): void => {
      if (
        isInteractivePreviewTarget({
          currentTarget: event.currentTarget,
          target: event.target,
        })
      ) {
        return;
      }
      handleToggle();
    },
    [handleToggle],
  );
  const handleCollapsedPreviewKeyDown = useCallback(
    (event: CollapsedPreviewKeyboardEvent): void => {
      if (event.target !== event.currentTarget) {
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      handleToggle();
    },
    [handleToggle],
  );
  const handleCollapsedPreviewBlur = useCallback(
    (event: CollapsedPreviewFocusEvent): void => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      setCollapsedPreviewActive(false);
    },
    [],
  );

  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      onToggle={expandable ? handleToggle : undefined}
      headerToneClass={
        expandable
          ? headerToneClass(title, isExpanded)
          : COLLAPSIBLE_HEADER_STATIC_TONE_CLASS
      }
      collapsedContent={
        collapsedPreview ? (
          <div
            className={cn(
              horizontalPaddingClass,
              "pb-1 pt-0.5",
              expandable ? "cursor-pointer focus-visible:outline-none" : null,
            )}
            role={expandable ? "button" : undefined}
            tabIndex={expandable ? 0 : undefined}
            aria-expanded={expandable ? isExpanded : undefined}
            onClick={expandable ? handleCollapsedPreviewClick : undefined}
            onMouseEnter={
              expandable ? () => setCollapsedPreviewActive(true) : undefined
            }
            onMouseLeave={
              expandable ? () => setCollapsedPreviewActive(false) : undefined
            }
            onFocus={
              expandable ? () => setCollapsedPreviewActive(true) : undefined
            }
            onBlur={expandable ? handleCollapsedPreviewBlur : undefined}
            onKeyDown={
              expandable ? handleCollapsedPreviewKeyDown : undefined
            }
          >
            {collapsedPreview}
          </div>
        ) : null
      }
      summaryContent={
        <span
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1.5",
            summaryClassName,
          )}
        >
          {leadingIcon ? (
            <Icon
              name={leadingIcon}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
          <TimelineTitleView
            title={title}
            onTitleAction={onTitleAction}
            resolveSegmentLinkHref={resolveSegmentLinkHref}
          />
        </span>
      }
      summaryContentClassName={TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME}
      forceHeaderChevronVisible={
        expandable && !isExpanded && collapsedPreviewActive
      }
      className={cn("w-full", className)}
      headerClassName={timelineRowHeaderClassName(horizontalPadding)}
      contentClassName={cn(horizontalPaddingClass, "pb-1 pt-0.5")}
      renderBody={renderBody}
    />
  );
}

export const ExpandableTimelineRow = memo(ExpandableTimelineRowComponent);
