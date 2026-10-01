import type { ComponentProps, ReactNode } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import type { SidebarVisibilityCustomize as SidebarVisibilityCustomizeView } from "./SidebarVisibilityCustomize";
import { SidebarVisibilityCustomizeFrame } from "./SidebarVisibilityCustomizeFrame";

export interface SidebarVisibilityItem {
  id: string;
  title: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SidebarActivationModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
}

type SidebarVisibilityCustomizeProps = ComponentProps<
  typeof SidebarVisibilityCustomizeView
>;

function SidebarVisibilityCustomizePlaceholder({
  items,
  onDone,
  retry,
  title,
  variant,
}: SidebarVisibilityCustomizeProps & { retry?: () => void }) {
  return (
    <SidebarVisibilityCustomizeFrame
      autoFocusDone
      onDone={onDone}
      title={title}
      variant={variant}
    >
      {retry ? (
        <SplitLoadFailure retry={retry} />
      ) : (
        <div
          role="status"
          aria-label="Loading sidebar customization"
          className="relative min-h-7 space-y-0.5 pb-0.5"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-2 top-2 space-y-3"
          >
            <Skeleton className="h-3 w-3/4 rounded-sm" />
            <Skeleton className="h-3 w-1/2 rounded-sm" />
            <Skeleton className="h-3 w-2/3 rounded-sm" />
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              aria-hidden="true"
              className={COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS}
            />
          ))}
        </div>
      )}
    </SidebarVisibilityCustomizeFrame>
  );
}

export const SidebarVisibilityCustomize = defineSplit({
  id: "sidebar-visibility-customize",
  load: () =>
    import("./SidebarVisibilityCustomize").then(
      (module) => module.SidebarVisibilityCustomize,
    ),
  loading: SidebarVisibilityCustomizePlaceholder,
  error: SidebarVisibilityCustomizePlaceholder,
  preload: "render",
});
