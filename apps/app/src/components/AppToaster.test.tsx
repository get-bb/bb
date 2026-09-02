// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toast } from "sonner";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AppToaster } from "./AppToaster";

afterEach(() => {
  toast.dismiss();
  cleanup();
});

async function renderToaster(isCompactViewport: boolean) {
  render(
    <CompactViewportOverrideProvider
      isCompactViewport={isCompactViewport}
    >
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
});
