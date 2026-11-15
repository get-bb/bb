import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import {
  sidebarNavigationPlacement,
  useResolvedSidebarNavigation,
} from "@/components/sidebar/sidebarNavigationProvider";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useMobileRecentsThreadReveal } from "@/views/useMobileRecentsThreadReveal";
import type { RouteSidebar } from "./routeSidebar";

interface AppLayoutSidebarProps {
  routeSidebar: RouteSidebar | null;
  isSettingsActive: boolean;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  settingsRoutePath: string;
  backToAppRoutePath: string | null;
}

export function AppLayoutSidebar({
  routeSidebar,
  isSettingsActive,
  onResizePointerDown,
  isResizing,
  settingsRoutePath,
  backToAppRoutePath,
}: AppLayoutSidebarProps) {
  useMobileRecentsThreadReveal();
  const navigation = useResolvedSidebarNavigation();
  const { isCompactViewport, isMobileSidebarClosing } = useSidebar();
  const holdCurrentSidebar = isCompactViewport && isMobileSidebarClosing;
  const [lastVisible, setLastVisible] = useState({
    routeSidebar,
    backToAppRoutePath,
  });
  if (
    !holdCurrentSidebar &&
    (lastVisible.routeSidebar?.id !== routeSidebar?.id ||
      lastVisible.backToAppRoutePath !== backToAppRoutePath)
  ) {
    setLastVisible({ routeSidebar, backToAppRoutePath });
  }
  const rendered = holdCurrentSidebar
    ? lastVisible
    : { routeSidebar, backToAppRoutePath };
  const backTo =
    sidebarNavigationPlacement(navigation) === "list"
      ? rendered.backToAppRoutePath
      : null;

  return (
    <AppSidebar
      onResizePointerDown={onResizePointerDown}
      isResizing={isResizing}
      isBodyHidden={rendered.routeSidebar !== null}
      navigation={navigation}
      settingsRoutePath={settingsRoutePath}
      isSettingsActive={isSettingsActive}
      alternateBody={
        rendered.routeSidebar?.render({
          backTo,
          isResizing,
          onResizePointerDown,
        }) ?? null
      }
    />
  );
}
