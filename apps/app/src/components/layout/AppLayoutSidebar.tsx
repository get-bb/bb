import {
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useSidebarThreadReveal } from "@/components/sidebar/useSidebarThreadReveal";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { Sidebar, useSidebar } from "@/components/ui/sidebar.js";

const LazySettingsSidebar = lazy(() =>
  import("@/components/settings/SettingsSidebar").then((module) => ({
    default: module.SettingsSidebar,
  })),
);
const LazyResourceSidebar = lazy(() =>
  import("@/components/tools/ResourceSidebar").then((module) => ({
    default: module.ResourceSidebar,
  })),
);

function SidebarLoading({ mobileHosted }: { mobileHosted: boolean }) {
  const content = (
    <div role="status" className="p-3 text-sm text-muted-foreground">
      Loading navigation…
    </div>
  );
  return mobileHosted ? content : <Sidebar>{content}</Sidebar>;
}

function SettingsSidebar(props: ComponentProps<typeof LazySettingsSidebar>) {
  return (
    <Suspense
      fallback={<SidebarLoading mobileHosted={props.mobileHosted ?? false} />}
    >
      <LazySettingsSidebar {...props} />
    </Suspense>
  );
}

function ResourceSidebar(props: ComponentProps<typeof LazyResourceSidebar>) {
  return (
    <Suspense
      fallback={<SidebarLoading mobileHosted={props.mobileHosted ?? false} />}
    >
      <LazyResourceSidebar {...props} />
    </Suspense>
  );
}

export type AppLayoutSidebarMode = "app" | "settings" | "plugins" | "skills";

interface AppLayoutSidebarProps {
  mode: AppLayoutSidebarMode;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  appRoutePath: string;
  settingsRoutePath: string;
  toolsBackRoutePath: string;
}

export function AppLayoutSidebar({
  mode,
  onResizeMouseDown,
  isResizing,
  appRoutePath,
  settingsRoutePath,
  toolsBackRoutePath,
}: AppLayoutSidebarProps) {
  useSidebarThreadReveal();
  const { isCompactViewport, isMobileSidebarClosing } = useSidebar();
  const holdCurrentMode = isCompactViewport && isMobileSidebarClosing;
  const [lastVisibleMode, setLastVisibleMode] = useState(mode);
  if (!holdCurrentMode && lastVisibleMode !== mode) {
    setLastVisibleMode(mode);
  }
  const renderedMode = holdCurrentMode ? lastVisibleMode : mode;

  if (isCompactViewport) {
    return (
      <Sidebar>
        <AppSidebar
          onResizeMouseDown={onResizeMouseDown}
          isResizing={isResizing}
          settingsRoutePath={settingsRoutePath}
          mobileHosted={{ hidden: renderedMode !== "app" }}
        />
        {renderedMode === "settings" ? (
          <SettingsSidebar
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
            appRoutePath={appRoutePath}
            mobileHosted
          />
        ) : null}
        {renderedMode === "plugins" || renderedMode === "skills" ? (
          <ResourceSidebar
            key={renderedMode}
            workspace={renderedMode}
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
            appRoutePath={toolsBackRoutePath}
            mobileHosted
          />
        ) : null}
      </Sidebar>
    );
  }

  if (renderedMode === "settings") {
    return (
      <SettingsSidebar
        onResizeMouseDown={onResizeMouseDown}
        isResizing={isResizing}
        appRoutePath={appRoutePath}
      />
    );
  }

  if (renderedMode === "plugins" || renderedMode === "skills") {
    return (
      <ResourceSidebar
        key={renderedMode}
        workspace={renderedMode}
        onResizeMouseDown={onResizeMouseDown}
        isResizing={isResizing}
        appRoutePath={toolsBackRoutePath}
      />
    );
  }

  return (
    <AppSidebar
      onResizeMouseDown={onResizeMouseDown}
      isResizing={isResizing}
      settingsRoutePath={settingsRoutePath}
    />
  );
}
