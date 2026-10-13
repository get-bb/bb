import { useEffect } from "react";
import { toast, Toaster, type ToasterProps } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePreferredTheme } from "@/hooks/useTheme";
import { attachSonnerToast } from "./ui/app-toast-runtime";
import { APP_OVERLAY_LAYER } from "./ui/app-overlay-layers";

const COMPACT_TOAST_OFFSET: NonNullable<ToasterProps["offset"]> = {
  top: "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)",
};
const COMPACT_TOAST_SWIPE_DIRECTIONS: NonNullable<
  ToasterProps["swipeDirections"]
> = ["top", "left", "right"];

export function AppToasterView() {
  const theme = usePreferredTheme();
  const isCompactViewport = useIsCompactViewport();
  useEffect(() => {
    attachSonnerToast(toast);
  }, []);
  return (
    <Toaster
      theme={theme}
      style={{ zIndex: APP_OVERLAY_LAYER.toast }}
      position={isCompactViewport ? "top-center" : "bottom-right"}
      offset={isCompactViewport ? COMPACT_TOAST_OFFSET : undefined}
      mobileOffset={isCompactViewport ? COMPACT_TOAST_OFFSET : undefined}
      swipeDirections={
        isCompactViewport ? COMPACT_TOAST_SWIPE_DIRECTIONS : undefined
      }
    />
  );
}
