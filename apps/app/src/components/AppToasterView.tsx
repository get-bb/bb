import { useEffect } from "react";
import { toast, Toaster, type ToasterProps } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePreferredTheme } from "@/hooks/useTheme";
import { attachSonnerToast } from "./ui/app-toast-runtime";

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
      position={isCompactViewport ? "top-center" : "bottom-right"}
      offset={isCompactViewport ? COMPACT_TOAST_OFFSET : undefined}
      mobileOffset={isCompactViewport ? COMPACT_TOAST_OFFSET : undefined}
      swipeDirections={
        isCompactViewport ? COMPACT_TOAST_SWIPE_DIRECTIONS : undefined
      }
    />
  );
}
