import {
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { flushSync } from "react-dom";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { preventOverlayTriggerSelection } from "@bb/shared-ui/overlay-trigger";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { PluginItemIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import {
  firstClientRect,
  readSelectedMessageMarkdown,
  type MessageProseSelection,
} from "./SelectableMessageProse.js";
import type { ThreadTimelinePluginMessageAction } from "./types.js";

const SELECTION_ACTION_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none max-md:pointer-coarse:min-h-7 max-md:pointer-coarse:px-2 max-md:pointer-coarse:py-1";
const SELECTION_MENU_CONTENT_CLASS =
  "pointer-events-auto z-50 flex w-auto items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

interface SelectionAction {
  icon: IconName;
  plugin?: { pluginId: string | null; icon: string | null };
  key?: string;
  label: string;
  onSelect: (selection: MessageProseSelection) => void;
}

export interface TimelineSelectionMenuProps {
  selection: MessageProseSelection | null;
  onAddToChat?: (text: string) => void;
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
  onDismiss: () => void;
  container?: HTMLElement | null;
}

interface SelectionAnchorElement {
  contextElement?: Element;
  getBoundingClientRect: () => DOMRect;
  hold: () => void;
  release: () => void;
}

const DETACHED_ANCHOR: SelectionAnchorElement = {
  getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  hold: () => {},
  release: () => {},
};

function liveSelectionRange(): Range | null {
  const live = window.getSelection();
  if (live === null || live.rangeCount === 0 || live.isCollapsed) return null;
  return live.getRangeAt(0);
}

function findClippingAncestor(element: HTMLElement): HTMLElement | undefined {
  for (
    let ancestor = element.parentElement;
    ancestor !== null;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      return ancestor;
    }
  }
  return undefined;
}

function createSelectionAnchor(
  selection: MessageProseSelection,
): SelectionAnchorElement {
  const side = selection.anchorSide ?? "top";
  const left =
    selection.anchorPoint?.x ?? selection.rect.left + selection.rect.width / 2;
  const top =
    selection.anchorPoint?.y ??
    (side === "bottom" ? selection.rect.bottom : selection.rect.top);
  const range = typeof window === "undefined" ? null : liveSelectionRange();
  const start = range?.startContainer ?? null;
  const contextElement =
    start instanceof Element ? start : (start?.parentElement ?? undefined);
  const liveRect = () => {
    const rect = range === null ? null : firstClientRect(range);
    return new DOMRect(
      left + (rect === null ? 0 : rect.left - selection.rect.left),
      top + (rect === null ? 0 : rect.top - selection.rect.top),
      0,
      0,
    );
  };
  let held: DOMRect | null = null;
  return {
    ...(contextElement === undefined ? {} : { contextElement }),
    getBoundingClientRect: () => held ?? liveRect(),
    hold: () => {
      held = liveRect();
    },
    release: () => {
      held = null;
    },
  };
}

function ActionButton({
  action,
  onDismiss,
  selection,
}: {
  action: SelectionAction;
  onDismiss: () => void;
  selection: MessageProseSelection;
}) {
  const ignoreNextClickRef = useRef(false);
  const activate = () => {
    flushSync(() => {
      action.onSelect(selection);
      window.getSelection()?.removeAllRanges();
      onDismiss();
    });
  };
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    ignoreNextClickRef.current = true;
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" || !ignoreNextClickRef.current) return;
    activate();
  };
  return (
    <button
      type="button"
      className={SELECTION_ACTION_BUTTON_CLASS}
      onMouseDown={(event: MouseEvent) => preventOverlayTriggerSelection(event)}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        ignoreNextClickRef.current = false;
      }}
      onClick={() => {
        if (ignoreNextClickRef.current) {
          ignoreNextClickRef.current = false;
          return;
        }
        activate();
      }}
    >
      {action.plugin ? (
        action.plugin.pluginId === null ? (
          <Icon
            name={pluginIconName(action.plugin.icon)}
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <PluginItemIcon
            pluginId={action.plugin.pluginId}
            icon={action.plugin.icon}
            className="size-3.5 text-muted-foreground"
          />
        )
      ) : (
        <Icon
          name={action.icon}
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      {action.label}
    </button>
  );
}

export function TimelineSelectionMenu({
  selection,
  onAddToChat,
  pluginActions = [],
  onDismiss,
  container,
}: TimelineSelectionMenuProps) {
  const portalScopeProps = usePortalScopeProps();

  useEffect(() => {
    if (selection === null || typeof window === "undefined") return;
    const dismissWhenSelectionLeaves = () => {
      const range = liveSelectionRange();
      const rect = range === null ? null : firstClientRect(range);
      if (rect === null || rect.bottom < 0 || rect.top > window.innerHeight) {
        onDismiss();
      }
    };
    window.addEventListener("scroll", dismissWhenSelectionLeaves, true);
    window.addEventListener("resize", dismissWhenSelectionLeaves);
    return () => {
      window.removeEventListener("scroll", dismissWhenSelectionLeaves, true);
      window.removeEventListener("resize", dismissWhenSelectionLeaves);
    };
  }, [selection, onDismiss]);

  const anchorSide = selection?.anchorSide ?? "top";
  const virtualAnchor = useMemo(
    () =>
      selection === null ? DETACHED_ANCHOR : createSelectionAnchor(selection),
    [selection],
  );
  const virtualAnchorRef = useRef(virtualAnchor);
  virtualAnchorRef.current = virtualAnchor;
  const collisionBoundary = useMemo(
    () => (container ? findClippingAncestor(container) : undefined),
    [container],
  );

  if (!selection) return null;

  const actions: SelectionAction[] = [
    ...(onAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: (currentSelection: MessageProseSelection) =>
              onAddToChat(
                readSelectedMessageMarkdown() ?? currentSelection.text,
              ),
          },
        ]
      : []),
    ...pluginActions.map((action) => ({
      icon: "MessageSquarePlus" as const,
      plugin: { pluginId: action.pluginId, icon: action.icon },
      key: action.key,
      label: action.label,
      onSelect: () => action.onSelect(),
    })),
  ];
  if (actions.length === 0) return null;

  return (
    <PopoverPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <PopoverPrimitive.Anchor virtualRef={virtualAnchorRef} />
      <PopoverPrimitive.Portal container={container ?? undefined}>
        <PopoverPrimitive.Content
          {...portalScopeProps}
          side={anchorSide}
          align="center"
          sideOffset={6}
          collisionPadding={8}
          collisionBoundary={collisionBoundary}
          className={SELECTION_MENU_CONTENT_CLASS}
          onPointerEnter={() => virtualAnchorRef.current.hold()}
          onPointerLeave={() => virtualAnchorRef.current.release()}
          onEscapeKeyDown={() => onDismiss()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {actions.map((action, index) => (
            <div key={action.key ?? action.label} className="flex items-center">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="mx-0.5 h-4 w-px bg-border"
                />
              ) : null}
              <ActionButton
                action={action}
                onDismiss={onDismiss}
                selection={selection}
              />
            </div>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
