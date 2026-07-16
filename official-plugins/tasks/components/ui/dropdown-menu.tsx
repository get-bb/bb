/* shadcn/ui-derived */
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import { COARSE_POINTER_CHECK_SLOT_CLASS } from "./coarse-pointer-sizing.js";
import {
  type ResponsiveOverlayContextValue,
  useResponsiveRoot,
  MobileTrigger,
  ResponsiveDrawerShell,
  stripRadixContentProps,
} from "./responsive-overlay.js";
import {
  blurActiveKeyboardInputBeforeOverlayOpen,
  getOverlayTriggerClassName,
  isLastInputKeyboard,
  preventOverlayTriggerSelection,
} from "./overlay-trigger.js";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "./menu-item-hover.js";
import { LIST_HOVER_TRANSITION } from "./motion.js";
import { Icon } from "../../components/ui/icon.js";

// Item state by variant: hover (focus) and the persistent last-hovered tile use
// the same fill, so the highlight reads identically and simply persists on the
// last item (neutral = state-hover; destructive = a destructive-red tile).
const MENU_ITEM_NEUTRAL_STATE_CLASS =
  "focus:bg-state-hover focus:text-foreground data-[last-hovered]:bg-state-hover data-[last-hovered]:text-foreground";
const MENU_ITEM_DESTRUCTIVE_STATE_CLASS =
  "text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15";
const MENU_ITEM_DESTRUCTIVE_TOUCH_CLASS =
  "text-destructive focus:bg-destructive/15 focus:text-destructive active:bg-destructive/20 active:text-destructive";

// ---------------------------------------------------------------------------
// Context — separate instance from Popover to avoid cross-contamination
// ---------------------------------------------------------------------------

const ResponsiveMenuContext =
  React.createContext<ResponsiveOverlayContextValue>({
    isCompactViewport: false,
    open: false,
    onOpenChange: () => {},
  });

function useResponsiveMenu() {
  return React.useContext(ResponsiveMenuContext);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  defaultOpen,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const ctx = useResponsiveRoot(
    controlledOpen,
    controlledOnChange,
    defaultOpen,
  );

  if (ctx.isCompactViewport) {
    return (
      <ResponsiveMenuContext.Provider value={ctx}>
        {children}
      </ResponsiveMenuContext.Provider>
    );
  }

  return (
    <DropdownMenuPrimitive.Root
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      {...props}
    >
      <ResponsiveMenuContext.Provider value={ctx}>
        {children}
      </ResponsiveMenuContext.Provider>
    </DropdownMenuPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ asChild, children, className, ...props }, ref) => {
  const { isCompactViewport, open, onOpenChange } = useResponsiveMenu();

  if (isCompactViewport) {
    return (
      <MobileTrigger
        ref={ref}
        asChild={asChild}
        open={open}
        onOpenChange={onOpenChange}
        haspopup="menu"
        className={className}
        {...props}
      >
        {children}
      </MobileTrigger>
    );
  }

  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      asChild={asChild}
      className={getOverlayTriggerClassName(className)}
      onMouseDown={(event) => {
        if (!open) {
          blurActiveKeyboardInputBeforeOverlayOpen();
        }
        preventOverlayTriggerSelection(event);
      }}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
});
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    /** Title announced by screen readers when the mobile drawer opens. */
    mobileTitle?: string;
  }
>(
  (
    {
      className,
      sideOffset = 4,
      children,
      mobileTitle,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const { isCompactViewport, open, onOpenChange } = useResponsiveMenu();
    // Unconditional (rules of hooks — the compact branch returns early); the
    // compact drawer path is covered by DrawerContent's own stamp.
    const scopeProps = usePortalScopeProps();

    if (isCompactViewport) {
      const domProps = stripRadixContentProps(props);
      return (
        <ResponsiveDrawerShell
          open={open}
          onOpenChange={onOpenChange}
          srLabel={mobileTitle ?? "Menu"}
          repositionInputs={false}
        >
          <div
            ref={ref}
            className={cn(
              "flex flex-col gap-0.5 overflow-y-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
              className,
            )}
            style={{ minWidth: "auto", maxWidth: "none", width: "auto" }}
            {...domProps}
          >
            {children}
          </div>
        </ResponsiveDrawerShell>
      );
    }

    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={ref}
          {...scopeProps}
          sideOffset={sideOffset}
          onCloseAutoFocus={(event) => {
            // Radix's DropdownMenu trigger preventDefaults pointerdown so the
            // menu can claim focus on open; that leaves the trigger without
            // mouse-set focus, and the close-time `.focus()` then trips the
            // browser's :focus-visible heuristic — painting a ring after every
            // mouse-driven close. Suppress the trigger refocus when the user's
            // last input was a pointer; keep it for keyboard close so Tab order
            // and focus indication stay intact for keyboard users.
            if (!isLastInputKeyboard()) {
              event.preventDefault();
            }
            onCloseAutoFocus?.(event);
          }}
          className={cn(
            "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        >
          <MenuHoverProvider>{children}</MenuHoverProvider>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    );
  },
);
DropdownMenuContent.displayName = "DropdownMenuContent";

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

/**
 * Creates a real DOM Event so that onSelect handlers can call
 * preventDefault() / read defaultPrevented without a synthetic shim.
 */
function createSelectEvent(): Event {
  return new Event("select", { cancelable: true });
}

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
  }
>(
  (
    {
      className,
      inset,
      variant = "default",
      onSelect,
      disabled,
      textValue: _textValue,
      children,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...domProps
    },
    ref,
  ) => {
    const { isCompactViewport, onOpenChange } = useResponsiveMenu();
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    if (isCompactViewport) {
      return (
        <button
          ref={ref as React.RefCallback<HTMLButtonElement> | null}
          type="button"
          role="menuitem"
          disabled={disabled}
          aria-disabled={disabled || undefined}
          className={cn(
            "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-left text-xs outline-none transition-colors focus:bg-state-hover focus:text-foreground active:bg-state-active active:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
            inset && "pl-8",
            variant === "destructive" && MENU_ITEM_DESTRUCTIVE_TOUCH_CLASS,
            className,
          )}
          data-disabled={disabled ? "" : undefined}
          onClick={() => {
            if (disabled) return;
            const event = createSelectEvent();
            onSelect?.(event);
            if (!event.defaultPrevented) {
              onOpenChange(false);
            }
          }}
        >
          {children}
        </button>
      );
    }

    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
          LIST_HOVER_TRANSITION,
          variant === "destructive"
            ? MENU_ITEM_DESTRUCTIVE_STATE_CLASS
            : MENU_ITEM_NEUTRAL_STATE_CLASS,
          inset && "pl-8",
          className,
        )}
        disabled={disabled}
        onSelect={onSelect}
        textValue={_textValue}
        {...domProps}
        {...hoverProps}
      >
        {children}
      </DropdownMenuPrimitive.Item>
    );
  },
);
DropdownMenuItem.displayName = "DropdownMenuItem";

// ---------------------------------------------------------------------------
// CheckboxItem
// ---------------------------------------------------------------------------

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(
  (
    {
      className,
      children,
      checked,
      onSelect,
      onCheckedChange,
      disabled,
      textValue: _textValue,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...domProps
    },
    ref,
  ) => {
    const { isCompactViewport, onOpenChange } = useResponsiveMenu();
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    if (isCompactViewport) {
      return (
        <button
          ref={ref as React.RefCallback<HTMLButtonElement> | null}
          type="button"
          role="menuitemcheckbox"
          aria-checked={
            checked === "indeterminate" ? "mixed" : checked === true
          }
          disabled={disabled}
          aria-disabled={disabled || undefined}
          className={cn(
            "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-2 pr-8 text-left text-xs outline-none transition-colors focus:bg-state-hover focus:text-foreground active:bg-state-active active:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
            className,
          )}
          data-disabled={disabled ? "" : undefined}
          onClick={() => {
            if (disabled) return;
            const event = createSelectEvent();
            onSelect?.(event);
            // Radix semantics: preventDefault() on onSelect prevents the menu
            // from closing but does NOT prevent the checked state from toggling.
            // Indeterminate toggles to true (matching Radix behavior).
            onCheckedChange?.(checked === "indeterminate" ? true : !checked);
            if (!event.defaultPrevented) {
              onOpenChange(false);
            }
          }}
        >
          <span
            className={cn(
              "absolute right-2 flex items-center justify-center",
              COARSE_POINTER_CHECK_SLOT_CLASS,
            )}
          >
            {(checked === true || checked === "indeterminate") && (
              <Icon name="Check" className={COARSE_POINTER_CHECK_SLOT_CLASS} />
            )}
          </span>
          {children}
        </button>
      );
    }

    return (
      <DropdownMenuPrimitive.CheckboxItem
        ref={ref}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm py-[0.3125rem] pl-2 pr-8 text-xs outline-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_LAST_HOVERED_CLASS,
          className,
        )}
        checked={checked}
        onSelect={onSelect}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        textValue={_textValue}
        {...domProps}
        {...hoverProps}
      >
        <span
          className={cn(
            "absolute right-2 flex items-center justify-center",
            COARSE_POINTER_CHECK_SLOT_CLASS,
          )}
        >
          <DropdownMenuPrimitive.ItemIndicator>
            <Icon name="Check" className={COARSE_POINTER_CHECK_SLOT_CLASS} />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
      </DropdownMenuPrimitive.CheckboxItem>
    );
  },
);
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

// ---------------------------------------------------------------------------
// RadioGroup + RadioItem
// Desktop-only Radix primitives. On mobile these components render nothing
// because they require DropdownMenuPrimitive.Root context which is not
// mounted on the mobile path. No current callers use these on mobile.
// ---------------------------------------------------------------------------

function DropdownMenuRadioGroup({
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  const { isCompactViewport } = useResponsiveMenu();

  if (isCompactViewport) {
    return null;
  }

  return (
    <DropdownMenuPrimitive.RadioGroup {...props}>
      {children}
    </DropdownMenuPrimitive.RadioGroup>
  );
}

const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(
  (
    {
      className,
      children,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...props
    },
    ref,
  ) => {
    const { isCompactViewport } = useResponsiveMenu();
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    if (isCompactViewport) {
      return null;
    }

    return (
      <DropdownMenuPrimitive.RadioItem
        ref={ref}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm py-[0.3125rem] pl-8 pr-2 text-xs outline-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_LAST_HOVERED_CLASS,
          className,
        )}
        {...props}
        {...hoverProps}
      >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <Icon name="Circle" className="h-2 w-2 fill-current" />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
      </DropdownMenuPrimitive.RadioItem>
    );
  },
);
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => {
  const { isCompactViewport } = useResponsiveMenu();

  if (isCompactViewport) {
    return (
      <div
        ref={ref}
        className={cn(
          "px-2 py-1.5 text-xs font-medium text-muted-foreground",
          inset && "pl-8",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={cn(
        "px-2 py-[0.3125rem] text-xs font-medium text-muted-foreground",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Label>
  );
});
DropdownMenuLabel.displayName = "DropdownMenuLabel";

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

const DropdownMenuSeparator = React.forwardRef<
  HTMLHRElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => {
  const { isCompactViewport } = useResponsiveMenu();

  if (isCompactViewport) {
    return (
      <hr
        ref={ref as React.RefCallback<HTMLHRElement> | null}
        className={cn("-mx-1 my-1 h-px border-0 bg-muted", className)}
      />
    );
  }

  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  );
});
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

const DropdownMenuGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>
>(({ children, ...props }, ref) => {
  const { isCompactViewport } = useResponsiveMenu();

  if (isCompactViewport) {
    return (
      <div ref={ref} role="group" {...props}>
        {children}
      </div>
    );
  }

  return (
    <DropdownMenuPrimitive.Group ref={ref} {...props}>
      {children}
    </DropdownMenuPrimitive.Group>
  );
});
DropdownMenuGroup.displayName = "DropdownMenuGroup";

// ---------------------------------------------------------------------------
// Sub-menu components (desktop-only, no callers on mobile)
// ---------------------------------------------------------------------------

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(
  (
    {
      className,
      inset,
      children,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...props
    },
    ref,
  ) => {
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    return (
      <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        className={cn(
          "flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-[0.3125rem] text-xs outline-none focus:bg-state-hover focus:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_LAST_HOVERED_CLASS,
          inset && "pl-8",
          className,
        )}
        {...props}
        {...hoverProps}
      >
        {children}
        <Icon name="ChevronRight" className="ml-auto" />
      </DropdownMenuPrimitive.SubTrigger>
    );
  },
);
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    // Sub menus portal beside the root content, not inside it — stamp them
    // too so plugin CSS reaches sub-menu items (see portal-scope.ts).
    {...usePortalScopeProps()}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

// ---------------------------------------------------------------------------
// Shortcut (plain span, no responsive branching needed)
// ---------------------------------------------------------------------------

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  );
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
