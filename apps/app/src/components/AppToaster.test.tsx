// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AppToaster } from "./AppToaster";

afterEach(cleanup);

function renderToaster(isCompactViewport: boolean) {
  render(
    <CompactViewportOverrideProvider
      isCompactViewport={isCompactViewport}
    >
      <AppToaster position="bottom-right" />
    </CompactViewportOverrideProvider>,
  );

  return document.querySelector("[data-sonner-toaster]");
}

describe("AppToaster", () => {
  it("places compact viewport toasts at the top center", () => {
    const toaster = renderToaster(true);
    expect(toaster?.getAttribute("data-x-position")).toBe("center");
    expect(toaster?.getAttribute("data-y-position")).toBe("top");
  });

  it("preserves the configured desktop toast position", () => {
    const toaster = renderToaster(false);
    expect(toaster?.getAttribute("data-x-position")).toBe("right");
    expect(toaster?.getAttribute("data-y-position")).toBe("bottom");
  });
});
