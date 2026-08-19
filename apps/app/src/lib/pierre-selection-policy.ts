export const PIERRE_SELECTION_POLICY_CSS = `
[data-merge-conflict-action] {
  -webkit-user-select: none;
  user-select: none;
}
`;

export function applyPierreSelectionPolicy(unsafeCSS?: string): string {
  return unsafeCSS === undefined || unsafeCSS.length === 0
    ? PIERRE_SELECTION_POLICY_CSS
    : `${unsafeCSS}\n${PIERRE_SELECTION_POLICY_CSS}`;
}
