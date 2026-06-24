// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppToaster } from "./AppToaster";

vi.mock("@/hooks/useTheme", () => ({
  usePreferredTheme: () => "light",
}));

vi.mock("@/components/ui/sonner.js", () => ({
  Toaster: ({ position, theme }: { position?: string; theme?: string }) => (
    <div
      data-testid="app-toaster"
      data-position={position}
      data-theme={theme}
    />
  ),
}));

function renderToaster(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppToaster position="bottom-right" />
    </MemoryRouter>,
  );
}

describe("AppToaster", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders on normal app routes", () => {
    renderToaster("/threads/thr_test");

    expect(screen.getByTestId("app-toaster").getAttribute("data-position")).toBe(
      "bottom-right",
    );
  });

  it.each([
    "/popout",
    "/popout/threads/thr_test",
    "/popout/projects/proj_test/threads/thr_test",
  ])(
    "does not render on %s",
    (path) => {
      renderToaster(path);

      expect(screen.queryByTestId("app-toaster")).toBeNull();
    },
  );
});
