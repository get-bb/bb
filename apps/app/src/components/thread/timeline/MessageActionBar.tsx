import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "@bb/shared-ui/hover-reveal";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import { cn } from "@bb/shared-ui/lib/utils";
import { useCopiedFeedback } from "@bb/shared-ui/copy-button";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { PluginItemIcon } from "@/components/plugin/PluginIcon";
import type { ThreadTimelineMessageAction } from "./types.js";
import { formatDayMessageTime, MessageTime } from "@bb/shared-ui/message-time";

function MessageActionIcon({
  action,
  confirmed,
  className,
}: {
  action: ThreadTimelineMessageAction;
  confirmed: boolean;
  className?: string;
}) {
  return confirmed ? (
    <Icon name="Check" className={className} aria-hidden="true" />
  ) : (
    <PluginItemIcon
      pluginId={action.pluginId}
      icon={action.icon}
      className={className}
    />
  );
}

interface MessageActionBarProps {
  timestamp: number;
  alignment: "start" | "end";
  mobileActionDisplay: "inline" | "overflow";
  actions: readonly ThreadTimelineMessageAction[];
  metadata?: ReactNode;
}

const DESKTOP_ACTION_WIDTH_PX = 20;
const TOUCH_ACTION_WIDTH_PX = 28;
const ACTION_ROW_GAP_PX = 8;
const OVERFLOW_TRIGGER_GAP_PX = 4;
const OVERFLOW_TRIGGER_TIGHTEN_CLASS = "-ml-1";

interface MessageActionRowLayout {
  inlineCount: number;
  overflowCount: number;
}

export function computeMessageActionRowLayout({
  actionCount,
  availableWidth,
  actionWidth,
}: {
  actionCount: number;
  availableWidth: number | undefined;
  actionWidth: number;
}): MessageActionRowLayout {
  if (actionCount <= 0) {
    return { inlineCount: 0, overflowCount: 0 };
  }
  if (availableWidth === undefined) {
    return { inlineCount: actionCount, overflowCount: 0 };
  }
  const inlineCount = Math.max(
    0,
    Math.min(
      actionCount,
      Math.floor(
        (availableWidth -
          actionWidth -
          OVERFLOW_TRIGGER_GAP_PX +
          ACTION_ROW_GAP_PX) /
          (actionWidth + ACTION_ROW_GAP_PX),
      ),
    ),
  );
  return { inlineCount, overflowCount: actionCount - inlineCount };
}

function useMessageActionRowFit({
  enabled,
  actionCount,
  actionWidth,
}: {
  enabled: boolean;
  actionCount: number;
  actionWidth: number;
}): {
  slotRef: (node: HTMLElement | null) => void;
  rowRef: RefObject<HTMLDivElement | null>;
  inlineCount: number;
} {
  const [measuredInlineCount, setMeasuredInlineCount] = useState<number | null>(
    null,
  );
  const rowRef = useRef<HTMLDivElement | null>(null);
  const unobserveRef = useRef<(() => void) | null>(null);
  const slotRef = useCallback(
    (node: HTMLElement | null) => {
      unobserveRef.current?.();
      unobserveRef.current = null;
      if (!enabled || node === null || typeof ResizeObserver === "undefined") {
        return;
      }
      let inlineCount: number | null = null;
      unobserveRef.current = observeSharedResize(node, {
        read: (entry) =>
          Math.floor(
            entry?.contentBoxSize?.[0]?.inlineSize ??
              entry?.contentRect.width ??
              node.clientWidth,
          ),
        write: (availableWidth) => {
          if (rowRef.current !== null) {
            rowRef.current.style.maxWidth = `${availableWidth}px`;
          }
          const nextInlineCount = computeMessageActionRowLayout({
            actionCount,
            availableWidth,
            actionWidth,
          }).inlineCount;
          if (nextInlineCount === inlineCount) return;
          inlineCount = nextInlineCount;
          setMeasuredInlineCount(nextInlineCount);
        },
      });
    },
    [enabled, actionCount, actionWidth],
  );
  return {
    slotRef,
    rowRef,
    inlineCount: Math.min(measuredInlineCount ?? actionCount, actionCount),
  };
}

const ACTION_BUTTON_CLASS = `inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground ${CONTROL_HOVER_TRANSITION} hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40`;
const HOVER_REVEAL_CLASS = cn(
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100",
  HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
);
export const ACTION_ROW_METADATA_CLASS = cn(
  "hidden items-center gap-2 whitespace-nowrap text-xs text-subtle-foreground has-[>*>*]:flex",
  HOVER_REVEAL_CLASS,
);
const MOBILE_INLINE_ACTION_CLASS =
  "max-md:pointer-coarse:size-7 max-md:pointer-coarse:[&_[data-icon-root]]:size-4";
const MOBILE_OVERFLOW_ACTION_CLASS = "max-md:pointer-coarse:hidden";
const ACTION_TOOLTIP_SIDE = "bottom";
const MENU_CONTENT_WIDTH_CLASS = "max-w-[min(16rem,calc(100vw-1rem))]";

const ACTION_ROW_POSITION_CLASS =
  "absolute top-0 flex w-max items-center gap-2 data-[menu-open]:[&_button]:opacity-100 data-[menu-open]:[&_[data-message-action-metadata]]:opacity-100";
const ACTION_ROW_CLASS = "flex max-w-full items-center gap-2 overflow-hidden";

export const BUBBLE_ALIGN_INSET_CLASS =
  "pr-[13px] max-md:pointer-coarse:pr-[11px]";
const BUBBLE_ALIGN_OFFSET_CLASS =
  "right-[13px] max-md:pointer-coarse:right-[11px]";
const PROSE_ALIGN_INSET_CLASS = "-ml-1 max-md:pointer-coarse:-ml-1.5";
export const PROSE_COLUMN_INSET_CLASS = "px-2";

export function findMessageActionTooltipCollisionBoundary(
  node: HTMLElement | null,
): HTMLElement | undefined {
  return node?.closest<HTMLElement>("[data-thread-window]") ?? undefined;
}

function useConfirmedRun(action: ThreadTimelineMessageAction) {
  const { copied: confirmed, markCopied: markConfirmed } = useCopiedFeedback();
  const run = () => {
    if (confirmed) return;
    void action.run("button").then((succeeded) => {
      if (succeeded) markConfirmed();
    });
  };
  return { confirmed, run };
}

const InlineMessageAction = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<"button">, "className" | "onClick"> & {
    action: ThreadTimelineMessageAction;
    className: string;
  }
>(function InlineMessageAction({ action, className, ...rest }, ref) {
  const { confirmed, run } = useConfirmedRun(action);
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(ACTION_BUTTON_CLASS, className)}
      onClick={run}
      disabled={action.disabled}
      aria-label={action.label}
    >
      <MessageActionIcon
        action={action}
        confirmed={confirmed}
        className="size-3"
      />
    </button>
  );
});

function DesktopMessageAction({
  action,
  className,
  collisionBoundary,
}: {
  action: ThreadTimelineMessageAction;
  className: string;
  collisionBoundary: HTMLElement | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <InlineMessageAction action={action} className={className} />
      </TooltipTrigger>
      <TooltipContent
        side={ACTION_TOOLTIP_SIDE}
        collisionBoundary={collisionBoundary}
      >
        {action.label}
      </TooltipContent>
    </Tooltip>
  );
}

function MessageActionMenuItems({
  actions,
}: {
  actions: readonly ThreadTimelineMessageAction[];
}) {
  return actions.map((action) => (
    <DropdownMenuItem
      key={action.key}
      disabled={action.disabled}
      onSelect={() => {
        void action.run("menu");
      }}
      textValue={action.label}
    >
      <MessageActionIcon action={action} confirmed={false} />
      {action.label}
    </DropdownMenuItem>
  ));
}

function MessageTimestampFooter({ timestamp }: { timestamp: number }) {
  const [now] = useState(() => new Date());
  return (
    <div
      className="mt-1 border-t border-border px-2 pt-2 pb-1 text-xs text-subtle-foreground"
      data-message-metadata=""
    >
      <MessageTime
        timestamp={timestamp}
        label={formatDayMessageTime(timestamp, now)}
      />
    </div>
  );
}

export function MessageActionBar({
  timestamp,
  alignment,
  mobileActionDisplay,
  actions,
  metadata,
}: MessageActionBarProps) {
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const [collisionBoundary, setCollisionBoundary] = useState<
    HTMLElement | undefined
  >();
  const isCompactTouch = isCompactViewport && isPointerCoarse;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const mobileDirectActionClass =
    mobileActionDisplay === "inline"
      ? MOBILE_INLINE_ACTION_CLASS
      : MOBILE_OVERFLOW_ACTION_CLASS;
  const inlineCandidates = actions.filter(
    (action) => action.placement === "inline",
  );
  const usesOverflowOnly = isCompactTouch && mobileActionDisplay === "overflow";
  const {
    slotRef: measureSlotRef,
    rowRef,
    inlineCount: fittedInlineCount,
  } = useMessageActionRowFit({
    enabled: !usesOverflowOnly,
    actionCount: inlineCandidates.length,
    actionWidth: isCompactTouch
      ? TOUCH_ACTION_WIDTH_PX
      : DESKTOP_ACTION_WIDTH_PX,
  });
  const slotRef = (node: HTMLDivElement | null) => {
    measureSlotRef(node);
    setCollisionBoundary(findMessageActionTooltipCollisionBoundary(node));
  };
  const inlineCount = usesOverflowOnly ? 0 : fittedInlineCount;
  const overflowedInline = inlineCandidates.slice(
    isCompactViewport ? 0 : inlineCount,
  );
  const menuActions = actions.flatMap((action) => {
    if (action.placement === "menu") return [action];
    return action === inlineCandidates[0] ? overflowedInline : [];
  });

  const rowPositionClass = cn(
    ACTION_ROW_POSITION_CLASS,
    alignment === "end"
      ? BUBBLE_ALIGN_OFFSET_CLASS
      : cn("left-0", PROSE_ALIGN_INSET_CLASS),
  );
  const slotClass = cn(
    "relative w-full",
    alignment === "end" && BUBBLE_ALIGN_INSET_CLASS,
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={slotRef}
        className={cn(slotClass, "h-5 max-md:pointer-coarse:h-7")}
      >
        <div
          className={rowPositionClass}
          data-menu-open={isMenuOpen ? "" : undefined}
        >
          {alignment === "end" ? metadata : null}
          <div ref={rowRef} className={ACTION_ROW_CLASS}>
            {isCompactTouch ? (
              <MobileInlineActions
                actions={inlineCandidates.slice(0, inlineCount)}
              />
            ) : (
              inlineCandidates
                .slice(0, inlineCount)
                .map((action) => (
                  <DesktopMessageAction
                    key={action.key}
                    action={action}
                    className={cn(HOVER_REVEAL_CLASS, mobileDirectActionClass)}
                    collisionBoundary={collisionBoundary}
                  />
                ))
            )}
            <DropdownMenu onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    ACTION_BUTTON_CLASS,
                    HOVER_REVEAL_CLASS,
                    MOBILE_INLINE_ACTION_CLASS,
                    inlineCount > 0 && OVERFLOW_TRIGGER_TIGHTEN_CLASS,
                    "data-[state=open]:text-foreground data-[state=open]:opacity-100",
                  )}
                  aria-label="Message actions"
                  data-no-sidebar-swipe=""
                >
                  <Icon name="MoreHorizontal" className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={alignment === "end" ? "end" : "start"}
                mobileTitle="Message actions"
                className={MENU_CONTENT_WIDTH_CLASS}
              >
                <MessageActionMenuItems actions={menuActions} />
                <MessageTimestampFooter timestamp={timestamp} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {alignment === "start" ? metadata : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

function MobileInlineActions({
  actions,
}: {
  actions: readonly ThreadTimelineMessageAction[];
}) {
  return actions.map((action) => (
    <InlineMessageAction
      key={action.key}
      action={action}
      className={cn(HOVER_REVEAL_CLASS, MOBILE_INLINE_ACTION_CLASS)}
    />
  ));
}
