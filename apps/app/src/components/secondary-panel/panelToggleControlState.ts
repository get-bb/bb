export type PanelToggleAction =
  | "show-panel"
  | "expand-panel"
  | "restore-conversation";

/**
 * Icon names the toggle can render. A subset of the Icon component's `IconName`
 * union; validity is enforced where the value flows into `<Icon name={…} />`.
 */
export type PanelToggleIconName = "PanelRight" | "Maximize2" | "Minimize2";

interface PanelToggleActionPresentation {
  label: string;
  iconName: PanelToggleIconName;
  /**
   * `aria-expanded` reflects whether the conversation pane is currently
   * expanded (shown). The collapse toggle flips it; the "show panel" button is
   * never an expanded disclosure.
   */
  isExpanded: boolean;
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
 *   expand-panel         → conversation shown: collapse it so the panel fills
 *                          the content area. Renders the maximize glyph. Lives
 *                          in the panel header.
 *   restore-conversation → conversation collapsed: restore it. Renders the
 *                          minimize glyph. Lives in the panel header (the
 *                          collapsed-conversation rail surfaces the same action
 *                          on its own).
 */
const PANEL_TOGGLE_ACTION_PRESENTATION = {
  "show-panel": { label: "Show panel", iconName: "PanelRight", isExpanded: false },
  "expand-panel": { label: "Expand panel", iconName: "Maximize2", isExpanded: true },
  "restore-conversation": {
    label: "Restore conversation",
    iconName: "Minimize2",
    isExpanded: false,
  },
} as const satisfies Record<PanelToggleAction, PanelToggleActionPresentation>;

export interface PanelToggleControlState {
  action: PanelToggleAction;
  label: string;
  isExpanded: boolean;
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
 * The panel header's collapse toggle. Only ever represents the two panel-open
 * states — collapse the conversation so the panel fills the view, and restore
 * it — so it takes just the conversation-collapse handler.
 */
export function resolveConversationCollapseControl({
  isConversationCollapsed,
  onToggleConversationCollapse,
}: ResolveConversationCollapseControlArgs): PanelToggleControlState {
  const action: PanelToggleAction = isConversationCollapsed
    ? "restore-conversation"
    : "expand-panel";
  return {
    action,
    ...PANEL_TOGGLE_ACTION_PRESENTATION[action],
    onClick: onToggleConversationCollapse,
  };
}
