import { Skeleton } from "@bb/shared-ui/skeleton";
import { useRef } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { SidebarFooterCustomizeHeader } from "./SidebarFooterCustomizeHeader";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";
import {
  useMeasureSidebarFooterCapacity,
  useSidebarFooterPreferences,
} from "./sidebarFooterPreferences";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";

function FooterCustomizePlaceholder({
  onDone,
  retry,
}: {
  onDone: () => void;
  retry?: () => void;
}) {
  const preferences = useSidebarFooterPreferences();
  const footerRowRef = useRef<HTMLDivElement>(null);
  const moreGlyphRef = useRef<HTMLSpanElement>(null);
  useMeasureSidebarFooterCapacity(footerRowRef, moreGlyphRef);
  return (
    <div
      className="rounded-lg bg-sidebar-accent/40 py-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onDone();
        }
      }}
    >
      <SidebarFooterCustomizeHeader onDone={onDone} autoFocus />
      {retry ? (
        <SplitLoadFailure retry={retry} />
      ) : (
        <div role="status" aria-label="Loading footer customization">
          <div
            ref={footerRowRef}
            className="relative flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground"
          >
            <div
              aria-hidden="true"
              className="flex h-8 w-full items-center max-md:pointer-coarse:h-9"
            >
              <Skeleton className="h-3 w-2/3 rounded-sm" />
            </div>
            <span
              ref={moreGlyphRef}
              aria-hidden="true"
              className={cn(
                SIDEBAR_FOOTER_ACTION_CLASS,
                "invisible absolute pointer-events-none",
              )}
            />
          </div>
          {preferences.more.length > 0 && (
            <div
              aria-hidden="true"
              style={{ height: `${1.75 + preferences.more.length * 1.875}rem` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export const LazySidebarFooterCustomize = defineSplit<{ onDone: () => void }>({
  id: "sidebar-footer-customize",
  load: () =>
    import("./SidebarFooterCustomize").then(
      (module) => module.SidebarFooterCustomize,
    ),
  loading: FooterCustomizePlaceholder,
  error: FooterCustomizePlaceholder,
  tier: "intent",
});
