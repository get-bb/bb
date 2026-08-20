import { SELECT_ALL_SHADOW_POLICY_CSS } from "./select-all-scope";

const PIERRE_CONTROL_SELECTORS = [
  "[data-expand-button]",
  "[data-utility-button]",
  "[data-merge-conflict-action]",
];

export const PIERRE_SELECTION_POLICY_CSS = `
${SELECT_ALL_SHADOW_POLICY_CSS}

:where(${PIERRE_CONTROL_SELECTORS.join(", ")}) {
  -webkit-user-select: none;
  user-select: none;
}
`;

export function applyPierreSelectionPolicy(unsafeCSS?: string): string {
  return unsafeCSS === undefined || unsafeCSS.length === 0
    ? PIERRE_SELECTION_POLICY_CSS
    : `${unsafeCSS}\n${PIERRE_SELECTION_POLICY_CSS}`;
}
