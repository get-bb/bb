// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { BrowserAnnotationOverlay } from "./BrowserAnnotationReview";

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <CompactViewportOverrideProvider isCompactViewport>
      <main data-testid="app-root">
        <button onClick={() => setOpen(true)}>Open drawer</button>
        <BrowserAnnotationOverlay
          open={open}
          onClose={() => setOpen(false)}
          label="Annotation"
          fill={false}
        >
          {open && (
            <div>
              <textarea aria-label="Draft" defaultValue="Original" />
              <button onClick={() => setOpen(false)}>Close drawer</button>
            </div>
          )}
        </BrowserAnnotationOverlay>
      </main>
    </CompactViewportOverrideProvider>
  );
}

function DesktopOverlayHarness() {
  const [open, setOpen] = useState(false);
  return (
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <button onClick={() => setOpen(true)}>Open desktop dialog</button>
      <BrowserAnnotationOverlay
        open={open}
        onClose={() => setOpen(false)}
        label="Desktop annotation"
        fill={false}
      >
        {open && (
          <div>
            <textarea aria-label="Desktop draft" />
            <button onClick={() => setOpen(false)}>Close desktop dialog</button>
          </div>
        )}
      </BrowserAnnotationOverlay>
    </CompactViewportOverrideProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("defers annotation content two frames and retains drafts without mutating the app root", () => {
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  render(<DrawerHarness />);
  const root = screen.getByTestId("app-root");
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) =>
    mutations.push(...records),
  );
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["inert", "aria-hidden"],
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
    expect(screen.queryByLabelText("Draft")).toBeNull();
    act(() => {
      const wave = [...frames.values()];
      frames.clear();
      for (const callback of wave) callback(16);
    });
    expect(screen.queryByLabelText("Draft")).toBeNull();
    act(() => {
      const wave = [...frames.values()];
      frames.clear();
      for (const callback of wave) callback(32);
    });
    const draft = screen.getByLabelText("Draft");
    fireEvent.change(draft, { target: { value: "Kept draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(draft.isConnected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
    expect(screen.getByLabelText("Draft")).toBe(draft);
    expect(draft).toHaveProperty("value", "Kept draft");
    mutations.push(...observer.takeRecords());
    expect(mutations).toEqual([]);
    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.hasAttribute("aria-hidden")).toBe(false);
  } finally {
    observer.disconnect();
  }
});

it("contains desktop annotation focus and restores its trigger on close", () => {
  render(<DesktopOverlayHarness />);
  const trigger = screen.getByRole("button", { name: "Open desktop dialog" });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = screen.getByRole("dialog", { name: "Desktop annotation" });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByLabelText("Desktop draft"));

  fireEvent.click(screen.getByRole("button", { name: "Close desktop dialog" }));
  expect(document.activeElement).toBe(trigger);
});
