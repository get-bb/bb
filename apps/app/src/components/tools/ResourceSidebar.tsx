import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  SectionSidebar,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  PLUGIN_PAGES,
  resolveToolsActivePage,
  SKILL_PAGES,
  type ToolsSectionId,
} from "./tools-navigation";

export function ResourceSidebar({
  workspace,
  isResizing,
  onResizeMouseDown,
}: {
  workspace: ToolsSectionId;
  isResizing: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);
  const pages = workspace === "plugins" ? PLUGIN_PAGES : SKILL_PAGES;

  return (
    <SectionSidebar
      isResizing={isResizing}
      onResizeMouseDown={onResizeMouseDown}
      testIdPrefix={workspace}
    >
      <div className="mt-1 space-y-0.5">
        {pages.map((page) => (
          <SectionSidebarRow
            key={page.id}
            active={activePage === page.id}
            label={page.label}
            to={page.to}
          />
        ))}
      </div>
    </SectionSidebar>
  );
}
