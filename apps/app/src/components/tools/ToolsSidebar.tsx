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
  TOOLS_PAGES,
  TOOLS_SECTIONS,
} from "./tools-navigation";

/**
 * The Extensions navigation, in the settings-sidebar treatment: each section
 * is a label and each of its pages is a row, so the sidebar is the one place
 * that lists every page — the pages themselves carry no tab layer.
 *
 * Rows and active-state come from `tools-navigation`'s canonical tables, so
 * the highlight always agrees with the ownership the breadcrumb resolver and
 * detail-route origin encode.
 */
export function ToolsSidebar({
  appRoutePath,
  isResizing,
  mobileHosted,
  onResizeMouseDown,
  showTopReserve,
}: {
  appRoutePath: string;
  isResizing: boolean;
  /** Render the body only, inside a compact drawer panel owned by the caller. */
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
      testIdPrefix="tools"
    >
      {Object.values(TOOLS_SECTIONS)
        .sort((left, right) =>
          // Plugins first, matching TOOLS_PAGES order.
          left.id === "plugins" ? -1 : right.id === "plugins" ? 1 : 0,
        )
        .map((section, index) => (
          <div key={section.id} className={index > 0 ? "mt-4" : undefined}>
            <SectionSidebarLabel>{section.label}</SectionSidebarLabel>
            <div className="mt-1 space-y-0.5">
              {TOOLS_PAGES.filter((page) => page.section === section.id).map(
                (page) => (
                  <SectionSidebarRow
                    key={page.id}
                    active={activePage === page.id}
                    label={page.label}
                    to={page.to}
                  >
                    <SectionSidebarIcon name={page.icon} />
                  </SectionSidebarRow>
                ),
              )}
            </div>
          </div>
        ))}
    </SectionSidebar>
  );
}
