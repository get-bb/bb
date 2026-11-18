import { fireEvent, waitFor } from "@testing-library/react";
import { expect } from "vitest";

export async function expectNonmodalPicker({
  trigger,
  open,
  content,
}: {
  trigger: HTMLElement;
  open: () => void;
  content: () => HTMLElement | null;
}): Promise<void> {
  const outside = document.body.appendChild(document.createElement("button"));
  try {
    open();
    expect(content()).not.toBeNull();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(getComputedStyle(document.body).pointerEvents).not.toBe("none");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(content()).toBeNull());
    expect(document.activeElement).toBe(trigger);

    open();
    expect(content()).not.toBeNull();
    outside.focus();
    await waitFor(() => expect(content()).toBeNull());
    expect(document.activeElement).toBe(outside);
  } finally {
    outside.remove();
  }
}
