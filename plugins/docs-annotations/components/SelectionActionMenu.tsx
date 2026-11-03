import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";

const buttonClass =
  "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none max-md:pointer-coarse:min-h-7 max-md:pointer-coarse:px-2 max-md:pointer-coarse:py-1";
const menuClass =
  "pointer-events-auto z-50 flex w-auto items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

export function SelectionActionMenu({
  range,
  onAddToChat,
  onDismiss,
}: {
  range: Range;
  onAddToChat(): void;
  onDismiss(): void;
}) {
  const contextElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const anchor = useMemo(
    () => ({
      ...(contextElement ? { contextElement } : {}),
      getBoundingClientRect() {
        const rects = range.getClientRects();
        const rect = rects.length ? rects[0]! : range.getBoundingClientRect();
        return new DOMRect(rect.left + rect.width / 2, rect.top, 0, 0);
      },
    }),
    [contextElement, range],
  );
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const portalScopeProps = usePortalScopeProps();
  const ignoreClickRef = useRef(false);

  useEffect(() => {
    const dismissIfDetached = () => {
      if (
        !range.startContainer.isConnected ||
        !range.endContainer.isConnected
      ) {
        onDismiss();
      }
    };
    window.addEventListener("scroll", dismissIfDetached, true);
    window.addEventListener("resize", dismissIfDetached);
    return () => {
      window.removeEventListener("scroll", dismissIfDetached, true);
      window.removeEventListener("resize", dismissIfDetached);
    };
  }, [onDismiss, range]);

  const activate = () => {
    onAddToChat();
    onDismiss();
  };

  return (
    <PopoverPrimitive.Root open onOpenChange={(open) => !open && onDismiss()}>
      <PopoverPrimitive.Anchor virtualRef={anchorRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          {...portalScopeProps}
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className={menuClass}
          onEscapeKeyDown={onDismiss}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className={buttonClass}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              ignoreClickRef.current = true;
            }}
            onPointerUp={(event: PointerEvent<HTMLButtonElement>) => {
              if (event.pointerType === "mouse" || !ignoreClickRef.current)
                return;
              activate();
            }}
            onPointerCancel={() => {
              ignoreClickRef.current = false;
            }}
            onClick={() => {
              if (ignoreClickRef.current) {
                ignoreClickRef.current = false;
                return;
              }
              activate();
            }}
          >
            <Icon
              name="MessageSquarePlus"
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            Add to chat
          </button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
