// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { defaultAppSettings } from "@bb/domain";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { BackToAppCommandHandler } from "./BackToAppCommandHandler";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindings: [
        {
          command: "app.back",
          desktopOnly: false,
          shortcut: {
            key: "Escape",
            mod: false,
            meta: false,
            control: false,
            alt: false,
            shift: false,
          },
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderHandler(routePath: string | null, children: ReactNode = null) {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <AppCommandProvider>
        <BackToAppCommandHandler routePath={routePath} />
        <LocationProbe />
        {children}
      </AppCommandProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("BackToAppCommandHandler", () => {
  it("returns to the remembered app route on Escape", async () => {
    renderHandler("/projects/proj_one/threads/thr_one");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj_one/threads/thr_one",
      );
    });
  });

  it("leaves Escape unhandled when no Back to app destination is visible", () => {
    renderHandler(null);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId("location").textContent).toBe("/settings");
  });

  it("leaves Escape to an open modal before navigating", () => {
    renderHandler(
      "/projects/proj_one/threads/thr_one",
      <div aria-modal="true" data-state="open" role="dialog">
        <button type="button">Modal action</button>
      </div>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Modal action" }), {
      key: "Escape",
    });

    expect(screen.getByTestId("location").textContent).toBe("/settings");
  });

  it("leaves Escape to a focused interaction that consumes it", () => {
    renderHandler(
      "/projects/proj_one/threads/thr_one",
      <button
        type="button"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault();
        }}
      >
        Close picker
      </button>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Close picker" }), {
      key: "Escape",
    });

    expect(screen.getByTestId("location").textContent).toBe("/settings");
  });
});
