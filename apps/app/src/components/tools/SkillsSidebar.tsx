import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  resolveToolsActivePage,
  SKILL_PAGES,
} from "./tools-navigation";

export function SkillsSidebar({
  appRoutePath,
  isResizing,
  mobileHosted,
  onResizeMouseDown,
  showTopReserve,
}: {
  appRoutePath: string;
  isResizing: boolean;
  mobileHosted?: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  showTopReserve: boolean;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      mobileHosted={mobileHosted}
      onResizeMouseDown={onResizeMouseDown}
      showTopReserve={showTopReserve}
      testIdPrefix="skills"
    >
      <SectionSidebarLabel>Skills</SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {SKILL_PAGES.map((page) => (
          <SectionSidebarRow
            key={page.id}
            active={activePage === page.id}
            label={page.label}
            to={page.to}
          >
            <SectionSidebarIcon name={page.icon} />
          </SectionSidebarRow>
        ))}
      </div>
    </SectionSidebar>
  );
}
