// @vitest-environment jsdom

import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { AppToaster } from "./AppToaster";

afterEach(() => {
  toast.dismiss();
  cleanup();
  vi.restoreAllMocks();
});

function mockPointerCoarse(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

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

interface ToastFlickOptions {
  duration?: number;
  endX?: number;
  endY?: number;
  startX?: number;
  startY?: number;
  terminal?: "cancel" | "up";
  terminalTarget?: Document | HTMLElement;
}

function fireTimedPointerEvent(
  target: Document | HTMLElement,
  type: "cancel" | "down" | "move" | "up",
  init: PointerEventInit,
  timeStamp: number,
): void {
  const event =
    type === "down"
      ? createEvent.pointerDown(target, init)
      : type === "move"
        ? createEvent.pointerMove(target, init)
        : type === "up"
          ? createEvent.pointerUp(target, init)
          : createEvent.pointerCancel(target, init);
  Object.defineProperty(event, "timeStamp", {
    configurable: true,
    value: timeStamp,
  });
  fireEvent(target, event);
}

function flickToast(
  toastElement: HTMLElement,
  pointerId: number,
  {
    duration = 200,
    endX = 200,
    endY = 100,
    startX = 120,
    startY = 100,
    terminal = "up",
    terminalTarget = toastElement,
  }: ToastFlickOptions = {},
): void {
  Object.defineProperty(toastElement, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  const pointerInit = {
    pointerId,
    pointerType: "touch",
  };
  fireTimedPointerEvent(
    toastElement,
    "down",
    {
      ...pointerInit,
      clientX: startX,
      clientY: startY,
    },
    100,
  );
  fireTimedPointerEvent(
    toastElement,
    "move",
    {
      ...pointerInit,
      clientX: endX,
      clientY: endY,
    },
    100 + duration / 2,
  );
  fireTimedPointerEvent(
    terminalTarget,
    terminal,
    {
      ...pointerInit,
      clientX: endX,
      clientY: endY,
    },
    100 + duration,
  );
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
    ["left flick", 200, 100, 120, 100, true],
    ["right flick", 120, 100, 200, 100, true],
    ["up flick", 160, 120, 160, 80, true],
    ["down flick", 160, 100, 160, 180, true],
    ["down-right diagonal flick", 120, 100, 180, 170, true],
    ["down-left diagonal flick", 200, 100, 140, 170, true],
    ["short horizontal drag", 160, 100, 172, 100, false],
  ] as const)(
    "handles a compact viewport single-move %s",
    async (_gesture, startX, startY, endX, endY, shouldDismiss) => {
      await renderToaster(true);
      const toastElement = document.querySelector<HTMLElement>(
        "[data-sonner-toast]",
      );
      expect(toastElement).not.toBeNull();
      if (toastElement === null) {
        return;
      }
      flickToast(toastElement, 1, {
        endX,
        endY,
        startX,
        startY,
      });

      if (shouldDismiss) {
        await waitFor(() => {
          expect(document.querySelector("[data-sonner-toast]")).toBeNull();
        });
      } else {
        await act(async () => Promise.resolve());
        expect(document.querySelector("[data-sonner-toast]")).toBe(
          toastElement,
        );
      }
    },
  );

  it("handles a short high-velocity flick", async () => {
    await renderToaster(true);
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    expect(toastElement).not.toBeNull();
    if (toastElement === null) {
      return;
    }

    flickToast(toastElement, 1, { duration: 50, endX: 132 });

    await waitFor(() => {
      expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    });
  });

  it("handles a flick released outside the toast", async () => {
    await renderToaster(true);
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    expect(toastElement).not.toBeNull();
    if (toastElement === null) {
      return;
    }

    flickToast(toastElement, 1, { terminalTarget: document });

    await waitFor(() => {
      expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    });
  });

  it("handles a flick while unrelated page text is selected", async () => {
    await renderToaster(true);
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    expect(toastElement).not.toBeNull();
    if (toastElement === null) {
      return;
    }
    const unrelatedText = document.createElement("p");
    unrelatedText.textContent = "Unrelated selection";
    document.body.append(unrelatedText);
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(unrelatedText);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      flickToast(toastElement, 1);

      await waitFor(() => {
        expect(document.querySelector("[data-sonner-toast]")).toBeNull();
      });
    } finally {
      selection?.removeAllRanges();
      unrelatedText.remove();
    }
  });

  it("completes a qualified flick after pointer cancellation", async () => {
    await renderToaster(true);
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    expect(toastElement).not.toBeNull();
    if (toastElement === null) {
      return;
    }

    flickToast(toastElement, 1, { terminal: "cancel" });

    await waitFor(() => {
      expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    });
  });

  it("handles touch flicks outside the compact viewport", async () => {
    mockPointerCoarse();
    await renderToaster(false);
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    expect(toastElement).not.toBeNull();
    if (toastElement === null) {
      return;
    }

    flickToast(toastElement, 1);

    await waitFor(() => {
      expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    });
  });

  it("dismisses rapid stacked flicks by stable toast identity", async () => {
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

    flickToast(toastC, 1);
    await act(async () => Promise.resolve());
    flickToast(toastB, 2);
    await act(async () => Promise.resolve());

    expect(onDismissC).toHaveBeenCalledOnce();
    expect(onDismissB).toHaveBeenCalledOnce();
    expect(onDismissA).not.toHaveBeenCalled();
  });
});
