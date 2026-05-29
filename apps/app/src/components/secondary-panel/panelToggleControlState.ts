export type PanelToggleAction =
  | "show-panel"
  | "expand-panel"
  | "expand-conversation";

/**
 * Icon names the toggle can render. A subset of the Icon component's `IconName`
 * union; validity is enforced where the value flows into `<Icon name={…} />`.
 */
export type PanelToggleIconName = "PanelRight" | "ChevronLeft" | "ChevronRight";

export interface PanelToggleControlState {
  action: PanelToggleAction;
  label: string;
  isExpanded: boolean;
  iconName: PanelToggleIconName;
  onClick: () => void;
}

export interface ResolvePanelToggleControlArgs {
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
}

/**
 * Maps the (panel open, conversation collapsed) state pair to the label, icon,
 * disclosure state, and click handler that the secondary-panel toggle should
 * expose. The single source of truth for the in-conversation-header toggle, so
 * its copy, icon, and handler stay in lockstep:
 *
 *   panel closed                   → open the panel ("Show panel"). Renders the
 *                                    PanelRight icon so it reads as "open the
 *                                    right side panel" — matching the in-panel
 *                                    hide button.
 *   panel open, conversation shown → collapse the conversation so the panel
 *                                    fills the area ("Expand panel").
 *   conversation collapsed         → restore the conversation ("Expand
 *                                    conversation"). In this state the
 *                                    conversation header is hidden, so the
 *                                    rail surfaces this action instead.
 */
export function resolvePanelToggleControl({
  isSecondaryPanelOpen,
  isConversationCollapsed,
  onToggleSecondaryPanel,
  onToggleConversationCollapse,
}: ResolvePanelToggleControlArgs): PanelToggleControlState {
  if (!isSecondaryPanelOpen) {
    return {
      action: "show-panel",
      label: "Show panel",
      isExpanded: false,
      iconName: "PanelRight",
      onClick: onToggleSecondaryPanel,
    };
  }
  if (isConversationCollapsed) {
    return {
      action: "expand-conversation",
      label: "Expand conversation",
      isExpanded: false,
      iconName: "ChevronRight",
      onClick: onToggleConversationCollapse,
    };
  }
  return {
    action: "expand-panel",
    label: "Expand panel",
    isExpanded: true,
    iconName: "ChevronLeft",
    onClick: onToggleConversationCollapse,
  };
}
