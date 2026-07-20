/* shadcn/ui-derived */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import { useBrowserDimmingModal } from "../../hooks/useBrowserDimmingModal";
import {
  DrawerDescription as DrawerDescriptionPrimitive,
  DrawerTitle as DrawerTitlePrimitive,
} from "./drawer.js";
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
  preventOverlayTriggerSelection,
} from "./overlay-trigger.js";
import { Icon } from "../../components/ui/icon.js";

// ---------------------------------------------------------------------------
// Context — separate instance from DropdownMenu / Popover.
// ---------------------------------------------------------------------------

const ResponsiveDialogContext =
  React.createContext<ResponsiveOverlayContextValue>({
    isCompactViewport: false,
    open: false,
    onOpenChange: () => {},
  });

function useResponsiveDialog() {
  return React.useContext(ResponsiveDialogContext);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function Dialog({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const ctx = useResponsiveRoot(controlledOpen, controlledOnChange);

  const body = ctx.isCompactViewport ? (
    children
  ) : (
    <DialogPrimitive.Root
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      {...props}
    >
      {children}
    </DialogPrimitive.Root>
  );

  return (
    <ResponsiveDialogContext.Provider value={ctx}>
      {body}
    </ResponsiveDialogContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

const DialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>(({ asChild, children, className, ...props }, ref) => {
  const { isCompactViewport, open, onOpenChange } = useResponsiveDialog();

  if (isCompactViewport) {
    return (
      <MobileTrigger
        ref={ref}
        asChild={asChild}
        open={open}
        onOpenChange={onOpenChange}
        haspopup="dialog"
        className={className}
        {...props}
      >
        {children}
      </MobileTrigger>
    );
  }

  return (
    <DialogPrimitive.Trigger
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
    </DialogPrimitive.Trigger>
  );
});
DialogTrigger.displayName = "DialogTrigger";

// ---------------------------------------------------------------------------
// Close — closes the dialog/drawer. Works in both modes.
// ---------------------------------------------------------------------------

interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DialogClose = React.forwardRef<HTMLButtonElement, DialogCloseProps>(
  ({ asChild, onClick, children, ...props }, ref) => {
    const { isCompactViewport, onOpenChange } = useResponsiveDialog();

    if (isCompactViewport) {
      const Comp = asChild ? Slot : "button";
      const handleClick: React.MouseEventHandler<HTMLButtonElement> = (
        event,
      ) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange(false);
        }
      };
      return (
        <Comp ref={ref} onClick={handleClick} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <DialogPrimitive.Close
        ref={ref}
        asChild={asChild}
        onClick={onClick}
        {...props}
      >
        {children}
      </DialogPrimitive.Close>
    );
  },
);
DialogClose.displayName = "DialogClose";

// ---------------------------------------------------------------------------
// Overlay — desktop only. Kept for backwards compatibility; the drawer
// provides its own overlay on mobile.
// ---------------------------------------------------------------------------

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // Portaled outside every plugin mount; re-attach the plugin CSS scope
    // when rendered from a plugin slot (see portal-scope.ts).
    {...usePortalScopeProps()}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
>;

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const { isCompactViewport, open, onOpenChange } = useResponsiveDialog();
    useBrowserDimmingModal(open);
    // Unconditional (rules of hooks — the compact branch returns early); the
    // compact drawer path is covered by DrawerContent's own stamp.
    const scopeProps = usePortalScopeProps();

    if (isCompactViewport) {
      const domProps = stripRadixContentProps(props);
      return (
        <ResponsiveDrawerShell open={open} onOpenChange={onOpenChange}>
          <div
            ref={ref}
            className={cn(
              "grid gap-4 overflow-y-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]",
              className,
              // The drawer spans the full viewport width; ignore any desktop
              // max-width override a caller passes so content fills the drawer.
              "max-w-none",
            )}
            {...domProps}
          >
            {children}
          </div>
        </ResponsiveDrawerShell>
      );
    }

    return (
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          {...scopeProps}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-sm duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-state-active data-[state=open]:text-foreground">
            <Icon name="X" className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
DialogContent.displayName = "DialogContent";

// ---------------------------------------------------------------------------
// Header / Footer — layout primitives, unchanged.
// ---------------------------------------------------------------------------

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

// ---------------------------------------------------------------------------
// Title / Description — render through the drawer's primitives on mobile so
// Radix Drawer/Vaul announces them to assistive tech.
// ---------------------------------------------------------------------------

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => {
  const { isCompactViewport } = useResponsiveDialog();
  const Comp = isCompactViewport ? DrawerTitlePrimitive : DialogPrimitive.Title;
  return (
    <Comp
      ref={ref}
      className={cn(
        "text-base font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const { isCompactViewport } = useResponsiveDialog();
  const Comp = isCompactViewport
    ? DrawerDescriptionPrimitive
    : DialogPrimitive.Description;
  return (
    <Comp
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
