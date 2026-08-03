import type { ReactNode } from "react";

export interface SecondaryPanelTabReorderRequest {
  activeTabId: string;
  overTabId: string;
}

export type SecondaryPanelTabReorderHandler = (
  request: SecondaryPanelTabReorderRequest,
) => void;

/**
 * A single closable tab rendered in the right panel's scrolling tab strip.
 */
export interface SecondaryPanelFileTab {
  id: string;
  filename: string;
  isActive: boolean;
  isHidden?: boolean;
  isPinned?: boolean;
  leadingVisual: ReactNode;
  statusLabel: string | null;
  onSelect: () => void;
  onClose: () => void;
}
