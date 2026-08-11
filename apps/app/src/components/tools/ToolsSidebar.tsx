import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  TOOLS_NAV_ITEMS,
  TOOLS_SECTIONS,
  resolveToolsSection,
  type ToolsSectionId,
} from "./tools-navigation";

export function ToolsSidebar({
  appRoutePath,
  isResizing,
  onResizeMouseDown,
  showTopReserve,
}: {
  appRoutePath: string;
  isResizing: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  showTopReserve: boolean;
}) {
  const location = useLocation();
  const activeSection = resolveToolsSection(location.pathname);
  const [sectionRoutePaths, setSectionRoutePaths] = useState<
    Record<ToolsSectionId, string>
  >({
    plugins: TOOLS_SECTIONS.plugins.to,
    skills: TOOLS_SECTIONS.skills.to,
  });
  const currentRoutePath = `${location.pathname}${location.search}${location.hash}`;

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      onResizeMouseDown={onResizeMouseDown}
      showTopReserve={showTopReserve}
      testIdPrefix="tools"
    >
      <SectionSidebarLabel>Extensions</SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {TOOLS_NAV_ITEMS.map((item) => (
          <div
            key={item.id}
            onClick={() => {
              if (item.id === activeSection) return;
              setSectionRoutePaths((current) =>
                current[activeSection] === currentRoutePath
                  ? current
                  : { ...current, [activeSection]: currentRoutePath },
              );
            }}
          >
            <SectionSidebarRow
              active={activeSection === item.id}
              current={
                location.pathname === item.to && location.search === ""
                  ? "page"
                  : "location"
              }
              label={item.label}
              to={
                item.id === activeSection ? item.to : sectionRoutePaths[item.id]
              }
            >
              <SectionSidebarIcon name={item.icon} />
            </SectionSidebarRow>
          </div>
        ))}
      </div>
    </SectionSidebar>
  );
}
