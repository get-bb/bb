import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

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

const LazySidebarVisibilityCustomize = lazy(() =>
  import("./SidebarVisibilityCustomize").then(
    ({ SidebarVisibilityCustomize }) => ({
      default: SidebarVisibilityCustomize,
    }),
  ),
);

export function SidebarVisibilityCustomize(
  props: ComponentProps<typeof LazySidebarVisibilityCustomize>,
) {
  return (
    <Suspense fallback={<span role="status">Loading…</span>}>
      <LazySidebarVisibilityCustomize {...props} />
    </Suspense>
  );
}
