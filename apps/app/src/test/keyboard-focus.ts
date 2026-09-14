import { fireEvent } from "@testing-library/react";

export function focusWithKeyboard(element: Element): void {
  fireEvent.keyDown(element.ownerDocument.body, { key: "Tab" });
  if (element instanceof HTMLElement) {
    element.focus();
  }
  fireEvent.focus(element);
}
