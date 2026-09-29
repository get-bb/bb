import type { ComponentProps, ReactNode } from "react";
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
        <div role="status" className="relative min-h-7 space-y-0.5 pb-0.5">
          <span className="absolute inset-x-0 top-0 flex h-7 items-center px-2 text-xs text-muted-foreground max-md:pointer-coarse:h-9">
            Loading…
          </span>
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
