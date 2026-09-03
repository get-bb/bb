// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AppToaster } from "./AppToaster";

afterEach(() => {
  toast.dismiss();
  cleanup();
});

async function renderToaster(isCompactViewport: boolean) {
  render(
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <AppToaster position="bottom-right" />
    </CompactViewportOverrideProvider>,
  );

  act(() => {
    toast("Position test", { duration: Number.POSITIVE_INFINITY });
  });

  return waitFor(() => {
    const toaster = document.querySelector<HTMLElement>(
      "[data-sonner-toaster]",
    );
    expect(toaster).not.toBeNull();
    return toaster;
  });
}

function swipeToast(
  toastElement: HTMLElement,
  pointerId: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  Object.defineProperty(toastElement, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  fireEvent.pointerDown(toastElement, {
    clientX: startX,
    clientY: startY,
    pointerId,
    pointerType: "touch",
  });
  fireEvent.pointerMove(toastElement, {
    clientX: endX,
    clientY: endY,
    pointerId,
    pointerType: "touch",
  });
  fireEvent.pointerUp(toastElement, {
    clientX: endX,
    clientY: endY,
    pointerId,
    pointerType: "touch",
  });
}

describe("AppToaster", () => {
  it("places compact viewport toasts at the top center", async () => {
    const toaster = await renderToaster(true);
    expect(toaster?.getAttribute("data-x-position")).toBe("center");
    expect(toaster?.getAttribute("data-y-position")).toBe("top");
    expect(toaster?.style.getPropertyValue("--offset-top")).toBe(
      "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)",
    );
    expect(toaster?.style.getPropertyValue("--mobile-offset-top")).toBe(
      "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)",
    );
  });

  it("preserves the configured desktop toast position", async () => {
    const toaster = await renderToaster(false);
    expect(toaster?.getAttribute("data-x-position")).toBe("right");
    expect(toaster?.getAttribute("data-y-position")).toBe("bottom");
  });

  it.each([
    ["left", 200, 120],
    ["right", 120, 200],
  ] as const)(
    "dismisses a compact toast to the %s",
    async (_name, startX, endX) => {
      await renderToaster(true);
      const toastElement = document.querySelector<HTMLElement>(
        "[data-sonner-toast]",
      );
      expect(toastElement).not.toBeNull();
      if (toastElement === null) {
        return;
      }

      swipeToast(toastElement, 1, startX, 100, endX, 100);

      await waitFor(() => {
        expect(document.querySelector("[data-sonner-toast]")).toBeNull();
      });
    },
  );

  it("keeps a downward drag onscreen", async () => {
    await renderToaster(true);
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    expect(toastElement).not.toBeNull();
    if (toastElement === null) {
      return;
    }

    swipeToast(toastElement, 1, 160, 100, 160, 180);

    expect(document.querySelector("[data-sonner-toast]")).toBe(toastElement);
  });

  it("keeps stacked toast identity during rapid swipes", async () => {
    const onDismissA = vi.fn();
    const onDismissB = vi.fn();
    const onDismissC = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <AppToaster position="bottom-right" />
      </CompactViewportOverrideProvider>,
    );
    act(() => {
      toast("Stack A", {
        duration: Number.POSITIVE_INFINITY,
        id: "stack-a",
        onDismiss: onDismissA,
      });
      toast("Stack B", {
        duration: Number.POSITIVE_INFINITY,
        id: "stack-b",
        onDismiss: onDismissB,
      });
      toast("Stack C", {
        duration: Number.POSITIVE_INFINITY,
        id: "stack-c",
        onDismiss: onDismissC,
      });
    });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(3);
    });
    const toastElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-sonner-toast]"),
    );
    const toastB = toastElements.find(
      (toastElement) => toastElement.textContent === "Stack B",
    );
    const toastC = toastElements.find(
      (toastElement) => toastElement.textContent === "Stack C",
    );
    expect(toastB).toBeDefined();
    expect(toastC).toBeDefined();
    if (toastB === undefined || toastC === undefined) {
      return;
    }

    swipeToast(toastC, 1, 120, 100, 200, 100);
    swipeToast(toastB, 2, 200, 100, 120, 100);

    expect(onDismissC).toHaveBeenCalledOnce();
    expect(onDismissB).toHaveBeenCalledOnce();
    expect(onDismissA).not.toHaveBeenCalled();
  });
});
