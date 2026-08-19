import {
  SELECTION_CONTROL_SELECTORS,
  SELECT_ALL_HIGHLIGHT_NAME,
} from "./select-all-scope";

const PIERRE_CONTROL_SELECTORS = [
  ...SELECTION_CONTROL_SELECTORS,
  "[data-expand-button]",
  "[data-utility-button]",
  "[data-merge-conflict-action]",
];

export const PIERRE_SELECTION_POLICY_CSS = `
:where(${PIERRE_CONTROL_SELECTORS.join(", ")}) {
  -webkit-user-select: none;
  user-select: none;
}

::highlight(${SELECT_ALL_HIGHLIGHT_NAME}) {
  background-color: Highlight;
  color: HighlightText;
}
`;

export function applyPierreSelectionPolicy(unsafeCSS?: string): string {
  return unsafeCSS === undefined || unsafeCSS.length === 0
    ? PIERRE_SELECTION_POLICY_CSS
    : `${unsafeCSS}\n${PIERRE_SELECTION_POLICY_CSS}`;
}
