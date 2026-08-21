import type { ReactNode } from "react";
import type { SecondaryFileFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

export interface SecondaryPanelTabReorderRequest {
  activeTabId: string;
  overTabId: string;
}

export type SecondaryPanelTabReorderHandler = (
  request: SecondaryPanelTabReorderRequest,
) => void;

export interface SecondaryPanelPaneRenderContext {
  isFocused: boolean;
  onFocusPane: () => void;
}

/**
 * One closable right-panel tab, including its persisted model, chrome, and
 * pane-local content. Keeping these together prevents the panel from joining
 * parallel representations by id when tabs move between split panes.
 */
export interface SecondaryPanelRenderableTab {
  contentFillsRegion?: boolean;
  label: string;
  isHidden?: boolean;
  isPinned?: boolean;
  leadingVisual: ReactNode;
  onClose: () => void;
  onSelect: () => void;
  renderContent: (pane: SecondaryPanelPaneRenderContext) => ReactNode;
  statusLabel: string | null;
  tab: SecondaryFileFixedPanelTab;
}
