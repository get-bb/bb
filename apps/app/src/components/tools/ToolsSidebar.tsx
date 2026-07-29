import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import { TOOLS_NAV_ITEMS, resolveToolsSection } from "./tools-navigation";

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

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      onResizeMouseDown={onResizeMouseDown}
      showTopReserve={showTopReserve}
      testIdPrefix="tools"
    >
      <SectionSidebarLabel>Plugins &amp; Skills</SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {TOOLS_NAV_ITEMS.map((item) => (
          <SectionSidebarRow
            key={item.id}
            active={activeSection === item.id}
            current={
              location.pathname === item.to && location.search === ""
                ? "page"
                : "location"
            }
            label={item.label}
            to={item.to}
          >
            <SectionSidebarIcon name={item.icon} />
          </SectionSidebarRow>
        ))}
      </div>
    </SectionSidebar>
  );
}
