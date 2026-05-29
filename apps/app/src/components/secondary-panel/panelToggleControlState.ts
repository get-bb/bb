export type PanelToggleAction =
  | "show-panel"
  | "expand-panel"
  | "expand-conversation";

export interface PanelToggleControlState {
  action: PanelToggleAction;
  label: string;
  isExpanded: boolean;
  pointsRight: boolean;
  onClick: () => void;
}

export interface ResolvePanelToggleControlArgs {
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
}

/**
 * Maps the (panel open, conversation collapsed) state pair to the label,
 * direction, disclosure state, and click handler that the secondary-panel
 * toggle should expose. Shared so the in-conversation-header chevron and the
 * (deprecated) seam arrow stay in lockstep:
 *
 *   panel closed                   → open the panel ("Show panel").
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
      pointsRight: false,
      onClick: onToggleSecondaryPanel,
    };
  }
  if (isConversationCollapsed) {
    return {
      action: "expand-conversation",
      label: "Expand conversation",
      isExpanded: false,
      pointsRight: true,
      onClick: onToggleConversationCollapse,
    };
  }
  return {
    action: "expand-panel",
    label: "Expand panel",
    isExpanded: true,
    pointsRight: false,
    onClick: onToggleConversationCollapse,
  };
}
