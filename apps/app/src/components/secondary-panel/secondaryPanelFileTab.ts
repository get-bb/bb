import type { ReactNode } from "react";

export interface SecondaryPanelTabReorderRequest {
  activeTabId: string;
  overTabId: string;
}

export type SecondaryPanelTabReorderHandler = (
  request: SecondaryPanelTabReorderRequest,
) => void;

/** One entry in a tab's right-click context menu (e.g. "Open with…"). */
export interface SecondaryPanelTabMenuItem {
  id: string;
  label: string;
  /** Renders a check-style item reflecting this state when set. */
  checked?: boolean;
  onSelect: () => void;
}

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
  /** Right-click context menu; omitted = no menu. */
  menuItems?: readonly SecondaryPanelTabMenuItem[];
  onSelect: () => void;
  onClose: () => void;
}
