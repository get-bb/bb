type PanelToggleAction = "enter-full-screen" | "exit-full-screen";

/**
 * Icon names the toggle can render. A subset of the Icon component's `IconName`
 * union; validity is enforced where the value flows into `<Icon name={…} />`.
 */
type PanelToggleIconName = "Maximize2" | "Minimize2";

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
 * state:
 *
 *   enter-full-screen    → expand the right panel to fill the content area.
 *   exit-full-screen     → restore the previous thread-and-panel layout.
 * Both actions stay in the panel header so the control transforms in place.
 */
const PANEL_TOGGLE_ACTION_PRESENTATION = {
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

interface PanelToggleControlState {
  action: PanelToggleAction;
  label: string;
  isFullScreen: boolean;
  iconName: PanelToggleIconName;
  onClick: () => void;
}

interface ResolveConversationCollapseControlArgs {
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
