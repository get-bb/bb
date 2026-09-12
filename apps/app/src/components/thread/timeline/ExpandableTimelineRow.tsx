import {
  memo,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
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
import type { IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useTimelineReasoningExpansion } from "./TimelineReasoningExpansion.js";
import {
  TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME,
  TimelineLeadingIcon,
  timelineRowHeaderClassName,
  timelineRowHorizontalPaddingClassName,
  type TimelineRowHorizontalPadding,
} from "./TimelineRowHeader.js";
import {
  TimelineTitleView,
  type TimelineTitleActionResolver,
  type TimelineTitleLinkResolver,
} from "./TimelineTitleView.js";

interface ExpandableTimelineRowProps {
  reasoningExpansionKey?: string;
  autoExpanded?: boolean;
  forceExpanded?: boolean;
  terminalAutoExpanded?: boolean;
  renderBody: () => ReactNode;
  title: TimelineTitle;
  titleContent?: ReactNode;
  collapsedPreview?: ReactNode;
  expandable?: boolean;
  horizontalPadding?: TimelineRowHorizontalPadding;
  leadingIcon?: IconName;
  leadingIconFallback?: IconName;
  leadingIconUrl?: string;
  leadingIconStyle?: CSSProperties;
  summaryClassName?: string;
  onTitleAction?: TimelineTitleActionResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
}

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
  collapsedPreview,
  expandable = true,
  forceExpanded = false,
  horizontalPadding = "default",
  leadingIcon,
  leadingIconFallback,
  leadingIconUrl,
  leadingIconStyle,
  onTitleAction,
  renderBody,
  reasoningExpansionKey,
  resolveSegmentLinkHref,
  summaryClassName,
  terminalAutoExpanded = false,
  title,
  titleContent,
}: ExpandableTimelineRowProps) {
  const [manualExpansionOverride, setManualExpansionOverride] =
    useTimelineReasoningExpansion(reasoningExpansionKey);
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
    setManualExpansionOverride(!isExpanded);
  }, [isExpanded, setManualExpansionOverride]);
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
            onKeyDown={expandable ? handleCollapsedPreviewKeyDown : undefined}
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
          <TimelineLeadingIcon
            icon={leadingIcon}
            fallback={leadingIconFallback}
            iconUrl={leadingIconUrl}
            style={leadingIconStyle}
          />
          {titleContent ?? (
            <TimelineTitleView
              title={title}
              onTitleAction={onTitleAction}
              resolveSegmentLinkHref={resolveSegmentLinkHref}
            />
          )}
        </span>
      }
      summaryContentClassName={TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME}
      forceHeaderChevronVisible={
        expandable && !isExpanded && collapsedPreviewActive
      }
      className="w-full"
      headerClassName={timelineRowHeaderClassName(horizontalPadding)}
      contentClassName={cn(horizontalPaddingClass, "pb-1 pt-0.5")}
      renderBody={renderBody}
    />
  );
}

export const ExpandableTimelineRow = memo(ExpandableTimelineRowComponent);
