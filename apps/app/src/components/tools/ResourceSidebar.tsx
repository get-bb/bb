import type { MouseEvent as ReactMouseEvent } from "react";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { usePluginListings } from "@/hooks/queries/plugin-listing-queries";
import { useLocation } from "react-router-dom";
import {
  SectionSidebar,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  PLUGIN_PAGES,
  resolveToolsActivePage,
  SKILL_PAGES,
  type ToolsSectionId,
} from "./tools-navigation";

function PluginSidebarPages() {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);
  const installed = usePluginList({ enabled: true });
  const authored = usePluginListings();
  const isEmpty =
    installed.data?.plugins.length === 0 && authored.data?.records.length === 0;
  return (
    <>
      {PLUGIN_PAGES.filter(
        (page) => !isEmpty || page.id !== "plugins-installed",
      ).map((page) => (
        <SectionSidebarRow
          key={page.id}
          active={activePage === page.id}
          label={page.label}
          to={page.to}
        />
      ))}
    </>
  );
}

export function ResourceSidebar({
  workspace,
  appRoutePath,
  isResizing,
  mobileHosted,
  onResizeMouseDown,
  showTopReserve,
}: {
  workspace: ToolsSectionId;
  appRoutePath: string;
  isResizing: boolean;
  mobileHosted?: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  showTopReserve: boolean;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);
  const pages = workspace === "plugins" ? PLUGIN_PAGES : SKILL_PAGES;

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      mobileHosted={mobileHosted}
      onResizeMouseDown={onResizeMouseDown}
      showTopReserve={showTopReserve}
      testIdPrefix={workspace}
    >
      <SectionSidebarLabel>
        {workspace === "plugins" ? "Plugins" : "Skills"}
      </SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {workspace === "plugins" ? (
          <PluginSidebarPages />
        ) : (
          pages.map((page) => (
            <SectionSidebarRow
              key={page.id}
              active={activePage === page.id}
              label={page.label}
              to={page.to}
            />
          ))
        )}
      </div>
    </SectionSidebar>
  );
}
