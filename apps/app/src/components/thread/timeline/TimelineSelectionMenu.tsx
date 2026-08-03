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
import { PluginIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import type { MessageProseSelection } from "./SelectableMessageProse.js";
import type { ThreadTimelinePluginMessageAction } from "./types.js";

// Labeled horizontal action button for the floating selection menu. Unlike the
// hover-revealed icon-only `MessageActionBar` buttons, the floating menu IS the
// affordance, so each action shows its label (matching the approved mock).
const SELECTION_ACTION_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none max-md:pointer-coarse:min-h-7 max-md:pointer-coarse:px-2 max-md:pointer-coarse:py-1";
const SELECTION_MENU_CONTENT_CLASS =
  "z-50 flex w-auto items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

interface SelectionAction {
  icon: IconName;
  /** Set on plugin-contributed actions; renders PluginIcon over `icon`. */
  plugin?: { pluginId: string | null; icon: string | null };
  /** Render key when `label` may not be unique (plugin actions). */
  key?: string;
  label: string;
  onSelect: (selection: MessageProseSelection) => void;
}

export interface TimelineSelectionMenuProps {
  selection: MessageProseSelection | null;
  onAddToChat?: (text: string) => void;
  /**
   * Plugin-contributed actions for the current selection, resolved by the
   * timeline root (each `onSelect` already carries the selection context).
   */
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
  onDismiss: () => void;
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
    // On mobile browsers, showing the keyboard requires focus to reach the
    // destination editor before the deliberate touch action returns. The
    // selection action can mount a side chat or update the main draft, while
    // dismissing this popover unmounts its focus trap; let neither update drift
    // beyond pointer-up.
    flushSync(() => {
      action.onSelect(selection);
      // Clear the lingering highlight so the source text doesn't read as
      // "still selected" after the quote/side-chat has been created.
      window.getSelection()?.removeAllRanges();
      onDismiss();
    });
  };
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    // Preserve the native touch/pen selection until pointer-up activates the
    // action. The stored selection remains the source of truth for the action.
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
      // Keep the text selection alive through the click so the action still
      // receives the selected text (and the menu stays anchored).
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
          <PluginIcon
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

/**
 * Floating horizontal menu shown near an agent-message text selection. Built as
 * a self-contained component driven by `selection` + callbacks; the timeline
 * controller that supplies them is wired separately.
 */
export function TimelineSelectionMenu({
  selection,
  onAddToChat,
  pluginActions = [],
  onDismiss,
}: TimelineSelectionMenuProps) {
  const open = selection !== null;
  const portalScopeProps = usePortalScopeProps();

  // Dismiss on scroll/resize rather than re-anchoring: the captured rect goes
  // stale the moment the viewport moves, so closing is the honest behavior.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const dismiss = () => onDismiss();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, onDismiss]);

  const anchorSide = selection?.anchorSide ?? "top";
  const anchorLeft =
    selection?.anchorPoint?.x ??
    (selection === null ? 0 : selection.rect.left + selection.rect.width / 2);
  const anchorTop =
    selection?.anchorPoint?.y ??
    (selection === null
      ? 0
      : anchorSide === "bottom"
        ? selection.rect.bottom
        : selection.rect.top);
  const virtualAnchor = useMemo(
    () => ({
      getBoundingClientRect: () => new DOMRect(anchorLeft, anchorTop, 0, 0),
    }),
    [anchorLeft, anchorTop],
  );
  const virtualAnchorRef = useRef(virtualAnchor);
  virtualAnchorRef.current = virtualAnchor;

  if (!selection) return null;

  const actions: SelectionAction[] = [
    ...(onAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: (currentSelection: MessageProseSelection) =>
              onAddToChat(currentSelection.text),
          },
        ]
      : []),
    ...pluginActions.map((action) => ({
      // Unused when `plugin` is set; a valid member keeps the type narrow.
      icon: "MessageSquarePlus" as const,
      plugin: { pluginId: action.pluginId, icon: action.icon },
      key: action.key,
      label: action.label,
      onSelect: () => action.onSelect(),
    })),
  ];
  if (actions.length === 0) return null;

  // Prefer the conventional above-selection placement on every input type.
  // Radix's collision handling flips the menu below only when the viewport
  // does not have enough room above the virtual anchor.
  return (
    <PopoverPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {/*
        Use a virtual viewport anchor. A real fixed-position anchor can be
        distorted by transformed ancestors in diff/preview panels.
      */}
      <PopoverPrimitive.Anchor virtualRef={virtualAnchorRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          {...portalScopeProps}
          side={anchorSide}
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className={SELECTION_MENU_CONTENT_CLASS}
          onEscapeKeyDown={() => onDismiss()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          // Selection actions explicitly hand focus to their destination
          // composer. Do not let the popover restore focus to its now-closed
          // action button and steal that handoff on mobile.
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
