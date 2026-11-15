import type { PointerEvent as ReactPointerEvent } from "react";
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
  backTo,
  isResizing,
  onResizePointerDown,
}: {
  workspace: ToolsSectionId;
  backTo: string | null;
  isResizing: boolean;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);
  const pages = workspace === "plugins" ? PLUGIN_PAGES : SKILL_PAGES;

  return (
    <SectionSidebar
      backTo={backTo}
      title={workspace === "plugins" ? "Plugins" : "Skills"}
      isResizing={isResizing}
      onResizePointerDown={onResizePointerDown}
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
