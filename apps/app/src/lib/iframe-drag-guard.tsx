import { cn } from "@bb/shared-ui/lib/utils";
import { BROWSER_VIEW_PASSTHROUGH_PROPS } from "@/components/secondary-panel/useBrowserViewOcclusion";

interface IframeDragGuardOverlayProps {
  active: boolean;
  cursor: "col-resize" | "row-resize";
}

export function IframeDragGuardOverlay({
  active,
  cursor,
}: IframeDragGuardOverlayProps) {
  if (!active) {
    return null;
  }
  return (
    <div
      aria-hidden
      data-testid="iframe-drag-guard-overlay"
      {...BROWSER_VIEW_PASSTHROUGH_PROPS}
      className={cn(
        "fixed inset-0 z-50",
        cursor === "col-resize" ? "cursor-col-resize" : "cursor-row-resize",
      )}
    />
  );
}
