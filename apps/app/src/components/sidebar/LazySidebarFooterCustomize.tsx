import { useRef } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { SidebarFooterCustomizeHeader } from "./SidebarFooterCustomizeHeader";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";
import {
  useMeasureSidebarFooterCapacity,
  useSidebarFooterPreferences,
} from "./sidebarFooterPreferences";
import { Skeleton } from "@bb/shared-ui/skeleton";
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
  const emptySlots = Math.max(
    0,
    (preferences.capacity ?? 0) - preferences.footer.length,
  );
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
            className="flex items-center gap-1 overflow-hidden bg-sidebar-accent py-2"
            aria-hidden="true"
          >
            <div className="flex min-w-0 items-center gap-1">
              {preferences.footer.map((item) => (
                <div
                  key={item.key}
                  className={cn(
                    SIDEBAR_FOOTER_ACTION_CLASS,
                    "flex shrink-0 items-center justify-center rounded-md border border-sidebar-foreground/15 bg-sidebar",
                  )}
                >
                  <Skeleton className="size-4 rounded-sm" />
                </div>
              ))}
              {Array.from({ length: emptySlots }, (_, index) => (
                <div
                  key={index}
                  className={cn(
                    SIDEBAR_FOOTER_ACTION_CLASS,
                    "shrink-0 rounded-md border border-dashed border-sidebar-foreground/20",
                  )}
                />
              ))}
            </div>
            <span
              ref={moreGlyphRef}
              className={cn(
                SIDEBAR_FOOTER_ACTION_CLASS,
                "flex shrink-0 items-center justify-center text-muted-foreground",
              )}
            >
              <Icon name="MoreHorizontal" />
            </span>
          </div>
          {preferences.more.length > 0 && (
            <div aria-hidden="true">
              <div className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
                More menu
              </div>
              <div className="space-y-0.5 px-1 pb-0.5">
                {preferences.more.map((item) => (
                  <div
                    key={item.key}
                    className="flex min-h-7 items-center gap-1 rounded-md px-1"
                  >
                    <span className="size-6 shrink-0" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            </div>
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
  preload: "render",
});
