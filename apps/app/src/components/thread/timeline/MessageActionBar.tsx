import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CopyButton } from "../../ui/copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { preventOverlayTriggerSelection } from "@bb/shared-ui/overlay-trigger";
import { copyToClipboardWithToast } from "@/lib/clipboard";
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
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptDraftAttachment } from "@bb/client-core";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { PluginIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import type { ThreadTimelinePluginMessageAction } from "./types.js";

/** Plugin-action icon: branding icon when the plugin is known, hint otherwise. */
function PluginActionIcon({
  pluginId,
  icon,
  className,
}: {
  pluginId: string | null;
  icon: string | null;
  className?: string;
}) {
  return pluginId === null ? (
    <Icon
      name={pluginIconName(icon)}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  ) : (
    <PluginIcon pluginId={pluginId} icon={icon} className={className} />
  );
}

interface MessageActionBarProps {
  messageText: string;
  alignment: "start" | "end";
  mobileActionDisplay: "inline" | "overflow";
  addToChatAttachments?: readonly PromptDraftAttachment[];
  onAddToChat?: (
    text: string,
    attachments?: readonly PromptDraftAttachment[],
  ) => void;
  onEdit?: () => void;
  onFork?: () => void;
  /**
   * Hand this message back to the main thread. Supplied only inside a side chat
   * (the main timeline has no main thread to send to). Not gated by `disabled`,
   * which only greys the child-spawning fork action.
   */
  onSendToMain?: () => void;
  disabled?: boolean;
  /** Plugin-contributed actions, rendered after the native ones. */
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
}

interface MessageOverflowAction {
  icon: "Copy" | "Edit" | "MessageSquarePlus" | "Fork" | "ArrowTurnBackward";
  /** Set on plugin-contributed actions; renders PluginActionIcon over `icon`. */
  plugin?: { pluginId: string | null; icon: string | null };
  /** Render key when `label` may not be unique (plugin actions). */
  key?: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  copyText?: string;
  kind?: "copy";
}

// ---------------------------------------------------------------------------
// Width-aware layout: the row must never extend past the message it belongs
// to, so actions that don't fit the measured slot collapse into a trailing
// "⋯" menu instead of widening or wrapping the row.
// ---------------------------------------------------------------------------

/**
 * Pixel metrics mirrored from the Tailwind classes on the rendered controls:
 * `size-5` desktop buttons, `size-7` touch buttons, `gap-2` between them. The
 * fit computation needs them as numbers — keep in sync with the class
 * constants below.
 */
const DESKTOP_ACTION_WIDTH_PX = 20;
const TOUCH_ACTION_WIDTH_PX = 28;
const ACTION_ROW_GAP_PX = 8;
/**
 * The "⋯" trigger sits tighter to the last inline action than actions sit to
 * each other (`-ml-1` on the trigger: 8px row gap minus 4px), so it reads as
 * the row's continuation rather than one more action.
 */
const OVERFLOW_TRIGGER_GAP_PX = 4;
const OVERFLOW_TRIGGER_TIGHTEN_CLASS = "-ml-1";
/**
 * Breathing room the expanded touch row must leave inside the timeline column.
 * Below it the row would butt against the column edge, so the popover is used
 * instead.
 */
const EXPANDED_ROW_COMFORT_PX = 16;

/** Width of `count` actions laid out in one row at the shared gap. */
function actionRowWidth(count: number, actionWidth: number): number {
  return count <= 0 ? 0 : count * actionWidth + (count - 1) * ACTION_ROW_GAP_PX;
}

interface MessageActionRowLayout {
  /** Leading actions rendered as direct buttons. */
  inlineCount: number;
  /** Trailing actions collapsed into the "⋯" overflow menu. */
  overflowCount: number;
}

export function computeMessageActionRowLayout({
  actionCount,
  availableWidth,
  actionWidth,
  overflowTriggerWidth,
}: {
  actionCount: number;
  /** Measured slot width; undefined until the ResizeObserver first reports. */
  availableWidth: number | undefined;
  actionWidth: number;
  overflowTriggerWidth: number;
}): MessageActionRowLayout {
  if (actionCount <= 0) {
    return { inlineCount: 0, overflowCount: 0 };
  }
  if (availableWidth === undefined) {
    // Unmeasured (pre-observation frame, or an environment without a working
    // ResizeObserver): render everything inline rather than nothing. The
    // desktop bar is opacity-hidden until hover, so nothing flashes.
    return { inlineCount: actionCount, overflowCount: 0 };
  }
  if (actionRowWidth(actionCount, actionWidth) <= availableWidth) {
    return { inlineCount: actionCount, overflowCount: 0 };
  }
  // K inline actions need K-1 row gaps, then the trigger gap and the trigger:
  // K·a + (K-1)·g + tg + t ≤ W  ⇔  K ≤ (W - t - tg + g) / (a + g).
  const inlineCount = Math.max(
    0,
    Math.min(
      actionCount - 1,
      Math.floor(
        (availableWidth -
          overflowTriggerWidth -
          OVERFLOW_TRIGGER_GAP_PX +
          ACTION_ROW_GAP_PX) /
          (actionWidth + ACTION_ROW_GAP_PX),
      ),
    ),
  );
  return { inlineCount, overflowCount: actionCount - inlineCount };
}

/**
 * Width of the action row's slot. A callback ref (rather than an object ref
 * plus a mount effect) so the observer re-attaches when the bar swaps between
 * its desktop and touch trees — an effect keyed on mount would keep observing
 * the unmounted tree's detached node. `enabled: false` keeps the hook (and a
 * branch-stable hook order) without constructing an observer, for branches
 * whose layout never reads the width.
 */
export function useMeasuredWidth({
  enabled,
  resolveTarget,
}: {
  enabled: boolean;
  /** Measure a related element (e.g. the message column) instead of the attached node. */
  resolveTarget?: (node: HTMLElement) => Element | null;
}): {
  measureRef: (node: HTMLElement | null) => void;
  width: number | undefined;
} {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!enabled || node === null || typeof ResizeObserver === "undefined") {
        return;
      }
      const target = resolveTarget ? resolveTarget(node) : node;
      if (target === null) {
        return;
      }
      const observer = new ResizeObserver(([entry]) => {
        const inlineSize =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        // Floor so a fractional slot never admits a row one pixel too wide.
        setWidth(Math.floor(inlineSize));
      });
      observer.observe(target);
      observerRef.current = observer;
    },
    [enabled, resolveTarget],
  );
  return { measureRef, width };
}

/**
 * Timeline-list-level share of the message column width.
 *
 * Every top-level row's `[data-message-column]` is as wide as the list root,
 * so one list-level measurement stands in for the per-bar column observers.
 * The top-level `TimelineRowsList` measures its root once and provides that
 * width here; each bar recovers its column's content box from it by
 * subtracting its column's own padding (`PROSE_COLUMN_INSET_PX` for the
 * assistant column), which is what its own observer would have reported.
 * `null` — no provider (stories, isolated renders) or a nested, narrower list
 * shadowing the top-level value — means no shared measurement applies and the
 * bar observes its own column.
 */
export interface SharedMessageColumnWidth {
  /** Measured width; undefined until the observer first reports. */
  width: number | undefined;
}

export const MessageColumnWidthContext =
  createContext<SharedMessageColumnWidth | null>(null);

/**
 * The message column this row belongs to — the full timeline width, which for
 * a right-aligned user message is much wider than its bubble. Module-level so
 * the measuring callback ref stays stable across renders.
 */
const resolveMessageColumn = (node: HTMLElement): Element | null =>
  node.closest("[data-message-column]");

interface MobileMessageOverflowPopoverProps {
  actions: readonly MessageOverflowAction[];
  alignment: MessageActionBarProps["alignment"];
  /** Extra trigger classes (the tightened gap when inline actions precede it). */
  triggerClassName?: string;
}

function MobileMessageOverflowPopover({
  actions,
  alignment,
  triggerClassName,
}: MobileMessageOverflowPopoverProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const portalScopeProps = usePortalScopeProps();
  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);
  const selectAction = useCallback((action: MessageOverflowAction) => {
    // Close before an action navigates or replaces the active panel.
    flushSync(() => setOpen(false));
    action.onSelect();
  }, []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(MOBILE_OVERFLOW_TRIGGER_CLASS, triggerClassName)}
          aria-label="Message actions"
          data-no-sidebar-swipe=""
          onMouseDown={preventOverlayTriggerSelection}
        >
          <Icon
            name={copied ? "Check" : "MoreHorizontal"}
            className={cn(
              "size-3",
              copied && "animate-in zoom-in-50 duration-150",
            )}
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          {...portalScopeProps}
          side="top"
          align={alignment === "end" ? "end" : "start"}
          sideOffset={6}
          collisionPadding={8}
          className={MOBILE_OVERFLOW_CONTENT_CLASS}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {actions.map((action) => (
            <button
              key={action.key ?? action.label}
              type="button"
              className={MOBILE_OVERFLOW_ITEM_CLASS}
              disabled={action.disabled}
              onClick={() => {
                if (action.kind === "copy") {
                  void copyToClipboardWithToast(action.copyText ?? "", {
                    successMessage: null,
                    errorMessage: "Failed to copy",
                  }).then((didCopy) => {
                    if (!didCopy) return;
                    setCopied(true);
                    flushSync(() => setOpen(false));
                  });
                  return;
                }
                selectAction(action);
              }}
            >
              {action.plugin ? (
                <PluginActionIcon
                  pluginId={action.plugin.pluginId}
                  icon={action.plugin.icon}
                  className="size-3.5"
                />
              ) : (
                <Icon name={action.icon} className="size-3.5 shrink-0" />
              )}
              {action.label}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// Shared hover-reveal classes for every action in the bar: hidden until the
// surrounding named `group/message` row is hovered or a child control takes
// keyboard focus (`group-focus-within`, matching disclosure.tsx so tabbing onto
// an action button reveals the bar). The fork button mirrors CopyButton's own
// classes so they read as one consistent affordance.
const ACTION_BUTTON_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100";
const MOBILE_INLINE_ACTION_CLASS =
  "max-md:pointer-coarse:size-7 max-md:pointer-coarse:opacity-100 max-md:pointer-coarse:disabled:opacity-40 max-md:pointer-coarse:[&_svg]:size-4";
const MOBILE_OVERFLOW_ACTION_CLASS = "max-md:pointer-coarse:hidden";
const MOBILE_OVERFLOW_TRIGGER_CLASS =
  "hidden size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground max-md:pointer-coarse:inline-flex max-md:pointer-coarse:[&_svg]:size-4";
const ACTION_TOOLTIP_SIDE = "bottom";
// Menus size to their widest label rather than a fixed width, so a two-item
// menu is not as wide as a six-item one. The cap keeps a long plugin label
// from running off a narrow viewport (it wraps instead).
const MENU_CONTENT_WIDTH_CLASS = "max-w-[min(16rem,calc(100vw-1rem))]";
const MOBILE_OVERFLOW_CONTENT_CLASS =
  "z-50 flex max-h-[50dvh] w-max min-w-32 max-w-[min(15rem,calc(100vw-1.5rem))] flex-col gap-0.5 overflow-y-auto rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";
const MOBILE_OVERFLOW_ITEM_CLASS =
  "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:bg-state-active disabled:pointer-events-none disabled:opacity-40 select-none";

// The slot wrapper is `relative w-full` and reserves the row's height; the row
// itself is absolutely positioned so its content can never contribute
// intrinsic width to a fit-content message column (which would let a wide row
// widen the column past the bubble).
// `has-[[data-state=open]]` keeps the whole row revealed while its overflow
// menu is open — without it the hover-reveal fades the inline actions out the
// moment the pointer moves onto the menu. Radix tooltips use `delayed-open`,
// so only the menu/popover trigger matches.
const ACTION_ROW_CLASS =
  "absolute top-0 flex max-w-full items-center gap-2 overflow-hidden has-[[data-state=open]]:[&_button]:opacity-100";
// The expanded touch row drops `max-w-full`/`overflow-hidden` so it can reach
// past a narrow bubble into the empty gutter beside it, and sits above
// neighbouring rows while it does.
const ACTION_ROW_EXPANDED_CLASS = "absolute top-0 z-10 flex items-center gap-2";

// Optical alignment: the row lines up with the message's *text*, not its
// border box. A bubble insets its text by 16px padding + 1px border, and each
// icon carries slack inside its larger hit box (a 20px box around a 12px glyph
// on desktop, 28px around 16px on touch), so the row is inset by the
// difference and the outer glyph edge lands on the text edge. Without it the
// glyph sits 4px from the bubble's edge — inside its 12px corner radius, so it
// reads as hanging off the message.
const BUBBLE_ALIGN_INSET_CLASS = "pr-[13px] max-md:pointer-coarse:pr-[11px]";
// The row is absolutely positioned, so it resolves `right` against the slot's
// padding box — the padding above shrinks the measured budget but cannot move
// the row. Offset it by the same amount to place it.
const BUBBLE_ALIGN_OFFSET_CLASS =
  "right-[13px] max-md:pointer-coarse:right-[11px]";
// Prose rows have no bubble padding, so only the hit-box slack is corrected.
const PROSE_ALIGN_INSET_CLASS = "-ml-1 max-md:pointer-coarse:-ml-1.5";
/**
 * Horizontal padding of the assistant (prose) `[data-message-column]` in
 * ConversationMessageContent, as the class it applies and the pixels it
 * removes from the column's content box (8px a side). A bar observing that
 * column reads its content box, so the shared list-level width — the
 * unpadded list root — is this much wider than what a `start` bar's own
 * observer would report; the bar subtracts it to land on the same number.
 * The user column is unpadded (its bubble insets itself), so `end` bars take
 * the shared width as is. Keep the pair in sync.
 */
export const PROSE_COLUMN_INSET_CLASS = "px-2";
const PROSE_COLUMN_INSET_PX = 16;

export function findMessageActionTooltipCollisionBoundary(
  node: HTMLElement | null,
): HTMLElement | undefined {
  return node?.closest<HTMLElement>("[data-thread-window]") ?? undefined;
}

/** One hover-revealed desktop action: an icon button with a tooltip. */
function DesktopMessageAction({
  action,
  className,
  collisionBoundary,
}: {
  action: MessageOverflowAction;
  className: string;
  collisionBoundary: HTMLElement | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {action.kind === "copy" ? (
          <CopyButton
            text={action.copyText ?? ""}
            label={action.label}
            className={className}
          />
        ) : (
          <button
            type="button"
            className={cn(ACTION_BUTTON_CLASS, className)}
            onClick={action.onSelect}
            disabled={action.disabled}
            aria-label={action.label}
          >
            {action.plugin ? (
              <PluginActionIcon
                pluginId={action.plugin.pluginId}
                icon={action.plugin.icon}
                className="size-3"
              />
            ) : (
              <Icon name={action.icon} className="size-3" />
            )}
          </button>
        )}
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

/** Dropdown items shared by the "⋯" overflow menu and the mobile fallback. */
function MessageActionMenuItems({
  actions,
}: {
  actions: readonly MessageOverflowAction[];
}) {
  return actions.map((action) => (
    <DropdownMenuItem
      key={action.key ?? action.label}
      disabled={action.disabled}
      onSelect={action.onSelect}
      textValue={action.label}
    >
      {action.plugin ? (
        <PluginActionIcon
          pluginId={action.plugin.pluginId}
          icon={action.plugin.icon}
        />
      ) : (
        <Icon name={action.icon} aria-hidden="true" />
      )}
      {action.label}
    </DropdownMenuItem>
  ));
}

/**
 * Hover-revealed footer of per-message actions. Renders an action only when it
 * is meaningful: copy when there is text, add-to-chat when a composer owns the
 * draft, and fork when its handler is supplied. `disabled` greys the fork
 * button (e.g. at the depth cap) while leaving copy and add-to-chat usable.
 *
 * The row tracks the width of the message it belongs to: its slot is measured
 * with a ResizeObserver and actions that don't fit collapse into a trailing
 * "⋯" menu, so the row never extends past the bubble or wraps.
 */
export function MessageActionBar({
  messageText,
  alignment,
  mobileActionDisplay,
  addToChatAttachments = [],
  onAddToChat,
  onEdit,
  onFork,
  onSendToMain,
  disabled,
  pluginActions = [],
}: MessageActionBarProps) {
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const hasCopy = messageText.length > 0;
  const hasAddToChat =
    (hasCopy || addToChatAttachments.length > 0) && onAddToChat !== undefined;
  const [collisionBoundary, setCollisionBoundary] = useState<
    HTMLElement | undefined
  >();
  const useMobileOverflowPopover = isCompactViewport && isPointerCoarse;
  // The mobile overflow branch lays out a constant row (every action behind
  // the "⋯" trigger), so the measured slot width feeds nothing there — skip
  // that observer entirely.
  const { measureRef, width: availableWidth } = useMeasuredWidth({
    enabled: !(useMobileOverflowPopover && mobileActionDisplay === "overflow"),
  });
  const sharedColumnWidth = useContext(MessageColumnWidthContext);
  const { measureRef: measureColumnRef, width: ownColumnWidth } =
    useMeasuredWidth({
      enabled: sharedColumnWidth === null,
      resolveTarget: resolveMessageColumn,
    });
  // The shared value is the unpadded list root's width; the own observer
  // reports the column's content box, which the assistant column's padding
  // narrows — subtract it so both paths gate the expansion identically.
  const columnWidth =
    sharedColumnWidth === null
      ? ownColumnWidth
      : sharedColumnWidth.width === undefined
        ? undefined
        : sharedColumnWidth.width -
          (alignment === "start" ? PROSE_COLUMN_INSET_PX : 0);
  // Touch-only: the hidden actions revealed in place by the "⋯" trigger.
  const [expanded, setExpanded] = useState(false);
  const expandedRowRef = useRef<HTMLDivElement | null>(null);
  const slotRef = useCallback(
    (node: HTMLDivElement | null) => {
      measureRef(node);
      measureColumnRef(node);
    },
    [measureRef, measureColumnRef],
  );
  const desktopSlotRef = useCallback(
    (node: HTMLDivElement | null) => {
      slotRef(node);
      setCollisionBoundary(findMessageActionTooltipCollisionBoundary(node));
    },
    [slotRef],
  );
  useEffect(() => {
    if (!expanded) return;
    // Capture phase so a tap that also opens something else still collapses.
    const handlePointerDown = (event: PointerEvent) => {
      const row = expandedRowRef.current;
      if (row && event.target instanceof Node && row.contains(event.target)) {
        return;
      }
      setExpanded(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [expanded]);
  // Bubble phase, so the action's own handler has already run.
  const handleExpandedRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement | null)?.closest("button")) {
      setExpanded(false);
    }
  };
  // Copying from the expanded row collapses it, which unmounts the button
  // before its own check can appear. Confirm on the trigger that replaces it,
  // the same way the popover confirms on its trigger.
  const [copiedFromRow, setCopiedFromRow] = useState(false);
  useEffect(() => {
    if (!copiedFromRow) return;
    const timeoutId = window.setTimeout(() => setCopiedFromRow(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [copiedFromRow]);
  const mobileDirectActionClass =
    mobileActionDisplay === "inline"
      ? MOBILE_INLINE_ACTION_CLASS
      : MOBILE_OVERFLOW_ACTION_CLASS;
  const handleAddToChat = useCallback(() => {
    if (!onAddToChat) return;
    if (addToChatAttachments.length > 0) {
      onAddToChat(messageText, addToChatAttachments);
      return;
    }
    onAddToChat(messageText);
  }, [addToChatAttachments, messageText, onAddToChat]);
  const actions: MessageOverflowAction[] = [
    ...(hasCopy
      ? [
          {
            icon: "Copy" as const,
            label: "Copy message",
            onSelect: () => {
              void copyToClipboardWithToast(messageText, {
                errorMessage: "Failed to copy",
              });
            },
            copyText: messageText,
            kind: "copy" as const,
          },
        ]
      : []),
    ...(onEdit
      ? [
          {
            icon: "Edit" as const,
            label: "Edit message",
            onSelect: onEdit,
          },
        ]
      : []),
    ...(hasAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: handleAddToChat,
          },
        ]
      : []),
    ...(onSendToMain
      ? [
          {
            icon: "ArrowTurnBackward" as const,
            label: "Send to main thread",
            onSelect: onSendToMain,
          },
        ]
      : []),
    ...(onFork
      ? [
          {
            icon: "Fork" as const,
            label: "Fork into new thread",
            onSelect: onFork,
            disabled,
          },
        ]
      : []),
    ...pluginActions.map((action) => ({
      // Unused when `plugin` is set; a valid member keeps the type narrow.
      icon: "Copy" as const,
      plugin: { pluginId: action.pluginId, icon: action.icon },
      key: action.key,
      label: action.label,
      onSelect: action.onSelect,
    })),
  ];

  if (actions.length === 0) {
    return null;
  }

  const rowClass = cn(
    ACTION_ROW_CLASS,
    alignment === "end"
      ? BUBBLE_ALIGN_OFFSET_CLASS
      : cn("left-0", PROSE_ALIGN_INSET_CLASS),
  );
  // Padding on the slot, so the measured width is the text width the row has
  // to fit into rather than the bubble's full border box.
  const slotClass = cn(
    "relative w-full",
    alignment === "end" && BUBBLE_ALIGN_INSET_CLASS,
  );

  if (useMobileOverflowPopover) {
    // Touch phones: no hover, so no tooltips. Mounting the desktop bar here
    // would put five-plus hidden Radix tooltip trees per message into the
    // timeline for nothing; render only the mobile surface.
    const layout =
      mobileActionDisplay === "overflow"
        ? { inlineCount: 0, overflowCount: actions.length }
        : computeMessageActionRowLayout({
            actionCount: actions.length,
            availableWidth,
            actionWidth: TOUCH_ACTION_WIDTH_PX,
            overflowTriggerWidth: TOUCH_ACTION_WIDTH_PX,
          });
    // Tapping "⋯" reveals the hidden actions in place when the whole set fits
    // the timeline column with room to spare — the row then reaches past a
    // narrow bubble into the empty gutter beside it. When even the column is
    // too tight the popover stays: it scrolls and can never clip.
    const canExpandInline =
      columnWidth !== undefined &&
      actionRowWidth(actions.length, TOUCH_ACTION_WIDTH_PX) <=
        columnWidth - EXPANDED_ROW_COMFORT_PX;
    if (expanded && canExpandInline) {
      return (
        <div ref={slotRef} className={cn(slotClass, "h-7")}>
          <div
            ref={expandedRowRef}
            className={cn(
              ACTION_ROW_EXPANDED_CLASS,
              alignment === "end"
                ? BUBBLE_ALIGN_OFFSET_CLASS
                : cn("left-0", PROSE_ALIGN_INSET_CLASS),
            )}
            onClick={handleExpandedRowClick}
          >
            <MobileInlineActions
              actions={actions}
              onCopied={() => setCopiedFromRow(true)}
            />
          </div>
        </div>
      );
    }
    return (
      <div ref={slotRef} className={cn(slotClass, "h-7")}>
        <div className={rowClass}>
          {layout.inlineCount > 0 ? (
            <MobileInlineActions
              actions={actions.slice(0, layout.inlineCount)}
            />
          ) : null}
          {layout.overflowCount > 0 ? (
            canExpandInline ? (
              <button
                type="button"
                className={cn(
                  MOBILE_OVERFLOW_TRIGGER_CLASS,
                  layout.inlineCount > 0 && OVERFLOW_TRIGGER_TIGHTEN_CLASS,
                )}
                aria-label="Message actions"
                aria-expanded={false}
                data-no-sidebar-swipe=""
                onClick={() => setExpanded(true)}
              >
                <Icon
                  name={copiedFromRow ? "Check" : "MoreHorizontal"}
                  className={cn(
                    "size-3",
                    copiedFromRow && "animate-in zoom-in-50 duration-150",
                  )}
                />
              </button>
            ) : (
              <MobileMessageOverflowPopover
                actions={actions.slice(layout.inlineCount)}
                alignment={alignment}
                triggerClassName={
                  layout.inlineCount > 0
                    ? OVERFLOW_TRIGGER_TIGHTEN_CLASS
                    : undefined
                }
              />
            )
          ) : null}
        </div>
      </div>
    );
  }

  const layout = computeMessageActionRowLayout({
    actionCount: actions.length,
    availableWidth,
    actionWidth: DESKTOP_ACTION_WIDTH_PX,
    overflowTriggerWidth: DESKTOP_ACTION_WIDTH_PX,
  });

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={desktopSlotRef}
        className={cn(slotClass, "h-5 max-md:pointer-coarse:h-7")}
      >
        <div className={rowClass}>
          {actions.slice(0, layout.inlineCount).map((action) => (
            <DesktopMessageAction
              key={action.key ?? action.label}
              action={action}
              className={cn(HOVER_REVEAL_CLASS, mobileDirectActionClass)}
              collisionBoundary={collisionBoundary}
            />
          ))}
          {layout.overflowCount > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    ACTION_BUTTON_CLASS,
                    HOVER_REVEAL_CLASS,
                    mobileDirectActionClass,
                    layout.inlineCount > 0 && OVERFLOW_TRIGGER_TIGHTEN_CLASS,
                    "data-[state=open]:text-foreground data-[state=open]:opacity-100",
                  )}
                  aria-label="More actions"
                >
                  <Icon name="MoreHorizontal" className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={alignment === "end" ? "end" : "start"}
                mobileTitle="Message actions"
                className={MENU_CONTENT_WIDTH_CLASS}
              >
                <MessageActionMenuItems
                  actions={actions.slice(layout.inlineCount)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {mobileActionDisplay === "overflow" ? (
            // CSS-only fallback for a coarse-pointer compact viewport rendered
            // through this tree (media queries and the JS hooks can disagree
            // for a frame): all inline buttons hide and this trigger, holding
            // every action, shows instead.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={MOBILE_OVERFLOW_TRIGGER_CLASS}
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
                <MessageActionMenuItems actions={actions} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Inline (always visible) actions for touch phones: same buttons and classes as
 * the desktop bar minus the tooltip trees, which have no hover to open on.
 */
function MobileInlineActions({
  actions,
  onCopied,
}: {
  actions: readonly MessageOverflowAction[];
  /**
   * Set when this row is about to be unmounted by the copy click itself, so
   * `CopyButton`'s own check would never be seen; the caller confirms instead.
   */
  onCopied?: () => void;
}) {
  return actions.map((action) =>
    action.kind === "copy" ? (
      onCopied ? (
        <button
          key={action.key ?? action.label}
          type="button"
          className={cn(
            ACTION_BUTTON_CLASS,
            HOVER_REVEAL_CLASS,
            MOBILE_INLINE_ACTION_CLASS,
          )}
          onClick={() => {
            void copyToClipboardWithToast(action.copyText ?? "", {
              successMessage: null,
              errorMessage: "Failed to copy",
            }).then((didCopy) => {
              if (didCopy) onCopied();
            });
          }}
          aria-label={action.label}
        >
          <Icon name="Copy" className="size-3" />
        </button>
      ) : (
        <CopyButton
          key={action.key ?? action.label}
          text={action.copyText ?? ""}
          label={action.label}
          className={cn(HOVER_REVEAL_CLASS, MOBILE_INLINE_ACTION_CLASS)}
        />
      )
    ) : (
      <button
        key={action.key ?? action.label}
        type="button"
        className={cn(
          ACTION_BUTTON_CLASS,
          HOVER_REVEAL_CLASS,
          MOBILE_INLINE_ACTION_CLASS,
        )}
        onClick={action.onSelect}
        disabled={action.disabled}
        aria-label={action.label}
      >
        {action.plugin ? (
          <PluginActionIcon
            pluginId={action.plugin.pluginId}
            icon={action.plugin.icon}
            className="size-3"
          />
        ) : (
          <Icon name={action.icon} className="size-3" />
        )}
      </button>
    ),
  );
}
