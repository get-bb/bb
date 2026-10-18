import * as React from "react";

function isAnchorInteractive(anchor: Element): boolean {
  return anchor.isConnected && anchor.closest("[inert]") === null;
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null) {
    ref.current = value;
  }
}

export function useCloseWhenAnchorDetaches<T extends Element>(
  forwardedRef: React.ForwardedRef<T>,
  open: boolean,
  onOpenChange: (open: boolean) => void,
): React.RefCallback<T> {
  const anchorRef = React.useRef<T | null>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  React.useEffect(() => {
    const anchor = anchorRef.current;
    if (!open || anchor === null) return;

    let closed = false;
    const close = () => {
      if (closed) return;
      if (anchorRef.current !== null && anchorRef.current !== anchor) return;
      closed = true;
      onOpenChangeRef.current(false);
    };

    let wasInteractive = isAnchorInteractive(anchor);
    const mutationObserver = new MutationObserver(() => {
      if (isAnchorInteractive(anchor)) {
        wasInteractive = true;
      } else if (wasInteractive) {
        close();
      }
    });
    mutationObserver.observe(anchor.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["inert"],
      childList: true,
      subtree: true,
    });

    if (typeof IntersectionObserver !== "function") {
      return () => mutationObserver.disconnect();
    }

    let wasVisible = false;
    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      if (entry.isIntersecting) {
        wasVisible = true;
      } else if (wasVisible) {
        close();
      }
    });
    intersectionObserver.observe(anchor);

    return () => {
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, [open]);

  return React.useCallback(
    (element: T | null) => {
      anchorRef.current = element;
      assignRef(forwardedRef, element);
    },
    [forwardedRef],
  );
}
