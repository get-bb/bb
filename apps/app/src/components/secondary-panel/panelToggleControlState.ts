export type PanelToggleAction =
  | "show-panel"
  | "enter-full-screen"
  | "exit-full-screen";

/**
 * Icon names the toggle can render. A subset of the Icon component's `IconName`
 * union; validity is enforced where the value flows into `<Icon name={…} />`.
 */
export type PanelToggleIconName = "PanelRight" | "Maximize2" | "Minimize2";

interface PanelToggleActionPresentation {
  label: string;
  iconName: PanelToggleIconName;
  /**
   * Whether the action is currently presenting the panel in full-screen mode.
   * This drives the toggle button's `aria-pressed` state.
   */
  isFullScreen: boolean;
}

/**
 * The single source of truth for each action's copy, icon, and disclosure
 * state. Both the conversation-header "show panel" button and the in-panel
 * collapse toggle resolve their presentation from here, so the two surfaces
 * stay in lockstep:
 *
 *   show-panel           → open the panel. Renders the PanelRight icon so it
 *                          reads as "open the right side panel" — matching the
 *                          in-panel hide button. Lives in the conversation
 *                          header, only while the panel is closed.
 *   enter-full-screen    → expand the right panel to fill the content area.
 *   exit-full-screen     → restore the previous thread-and-panel layout.
 * Both actions stay in the panel header so the control transforms in place.
 */
const PANEL_TOGGLE_ACTION_PRESENTATION = {
  "show-panel": {
    label: "Show right panel",
    iconName: "PanelRight",
    isFullScreen: false,
  },
  "enter-full-screen": {
    label: "Full Screen",
    iconName: "Maximize2",
    isFullScreen: false,
  },
  "exit-full-screen": {
    label: "Exit Full Screen",
    iconName: "Minimize2",
    isFullScreen: true,
  },
} as const satisfies Record<PanelToggleAction, PanelToggleActionPresentation>;

export interface PanelToggleControlState {
  action: PanelToggleAction;
  label: string;
  isFullScreen: boolean;
  iconName: PanelToggleIconName;
  onClick: () => void;
}

export interface ResolveShowPanelControlArgs {
  onToggleSecondaryPanel: () => void;
}

/**
 * The conversation header's panel affordance, used only while the secondary
 * panel is closed: a button that opens it. Once the panel is open the toggle
 * moves into the panel header (see {@link resolveConversationCollapseControl}).
 */
export function resolveShowPanelControl({
  onToggleSecondaryPanel,
}: ResolveShowPanelControlArgs): PanelToggleControlState {
  return {
    action: "show-panel",
    ...PANEL_TOGGLE_ACTION_PRESENTATION["show-panel"],
    onClick: onToggleSecondaryPanel,
  };
}

export interface ResolveConversationCollapseControlArgs {
  isConversationCollapsed: boolean;
  onToggleConversationCollapse: () => void;
}

/**
 * Resolves the paired conversation disclosure states. One control in the panel
 * header renders both: it expands the panel while the conversation is visible,
 * and restores the conversation while the panel owns the full canvas.
 */
export function resolveConversationCollapseControl({
  isConversationCollapsed,
  onToggleConversationCollapse,
}: ResolveConversationCollapseControlArgs): PanelToggleControlState {
  const action: PanelToggleAction = isConversationCollapsed
    ? "exit-full-screen"
    : "enter-full-screen";
  return {
    action,
    ...PANEL_TOGGLE_ACTION_PRESENTATION[action],
    onClick: onToggleConversationCollapse,
  };
}
