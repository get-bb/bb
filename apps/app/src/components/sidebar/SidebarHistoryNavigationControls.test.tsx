// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type InitialEntry,
  type NavigateFunction,
} from "react-router-dom";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";

interface RenderControlsArgs {
  initialEntries?: InitialEntry[];
  initialIndex?: number;
  onNavigate?: () => void;
}

interface NavigateToOptions {
  replace?: boolean;
}

// Captured from inside the router so tests can drive PUSH/REPLACE/POP
// navigations the same way the rest of the app does, without reaching into
// React Router internals.
let capturedNavigate: NavigateFunction | null = null;

function NavigateProbe() {
  capturedNavigate = useNavigate();
  return null;
}

function CurrentLocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="current-location">
      {`${location.pathname}${location.search}`}
    </div>
  );
}

function renderControls(args: RenderControlsArgs = {}) {
  capturedNavigate = null;
  render(
    <MemoryRouter
      initialEntries={args.initialEntries ?? ["/"]}
      initialIndex={args.initialIndex}
    >
      <NavigateProbe />
      <CurrentLocationProbe />
      <SidebarHistoryNavigationControls onNavigate={args.onNavigate} />
    </MemoryRouter>,
  );
}

function backButton() {
  return screen.getByRole("button", { name: "Go back" });
}

function forwardButton() {
  return screen.getByRole("button", { name: "Go forward" });
}

function currentLocation(): string | null {
  return screen.getByTestId("current-location").textContent;
}

function navigateTo(to: string, options?: NavigateToOptions) {
  act(() => {
    capturedNavigate?.(to, options);
  });
}

function navigateByDelta(delta: number) {
  act(() => {
    capturedNavigate?.(delta);
  });
}

afterEach(() => {
  cleanup();
  capturedNavigate = null;
});

describe("SidebarHistoryNavigationControls", () => {
  it("renders both controls disabled at the initial route", () => {
    renderControls();

    expect(currentLocation()).toBe("/");
    expect(backButton()).toHaveProperty("disabled", true);
    expect(forwardButton()).toHaveProperty("disabled", true);
  });

  it("exposes accessible labels and hides the icons from assistive tech", () => {
    renderControls();

    const back = backButton();
    expect(back).toHaveProperty("tagName", "BUTTON");
    expect(back.getAttribute("type")).toBe("button");
    expect(back.getAttribute("title")).toBe("Go back");
    expect(forwardButton().getAttribute("title")).toBe("Go forward");
    expect(back.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("enables Back only after a push navigation", () => {
    renderControls();

    navigateTo("/settings");

    expect(currentLocation()).toBe("/settings");
    expect(backButton()).toHaveProperty("disabled", false);
    expect(forwardButton()).toHaveProperty("disabled", true);
  });

  it("moves the URL and disabled states through Back then Forward", () => {
    renderControls();

    navigateTo("/settings");

    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/");
    expect(backButton()).toHaveProperty("disabled", true);
    expect(forwardButton()).toHaveProperty("disabled", false);

    fireEvent.click(forwardButton());
    expect(currentLocation()).toBe("/settings");
    expect(backButton()).toHaveProperty("disabled", false);
    expect(forwardButton()).toHaveProperty("disabled", true);
  });

  it("skips duplicate same-URL entries so one click lands on a visibly different route", () => {
    renderControls();

    // A -> B -> B with two distinct history entries for the same URL.
    navigateTo("/projects/proj_1");
    navigateTo("/projects/proj_1");
    expect(currentLocation()).toBe("/projects/proj_1");

    // One Back skips the duplicate B and lands on A, with no fake no-op step.
    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/");
    expect(backButton()).toHaveProperty("disabled", true);

    // One Forward returns to B.
    fireEvent.click(forwardButton());
    expect(currentLocation()).toBe("/projects/proj_1");
    expect(forwardButton()).toHaveProperty("disabled", true);
  });

  it("clears the forward stack when pushing after going back", () => {
    renderControls();

    navigateTo("/b");
    navigateTo("/c");

    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/b");
    expect(forwardButton()).toHaveProperty("disabled", false);

    navigateTo("/d");
    expect(currentLocation()).toBe("/d");
    // C is no longer reachable going forward.
    expect(forwardButton()).toHaveProperty("disabled", true);
    expect(backButton()).toHaveProperty("disabled", false);

    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/b");
  });

  it("replaces the current slot without adding a Back entry", () => {
    renderControls();

    navigateTo("/settings");
    navigateTo("/threads/thr_review", { replace: true });
    expect(currentLocation()).toBe("/threads/thr_review");
    expect(backButton()).toHaveProperty("disabled", false);

    // Back skips the replaced-away /settings (which no longer exists) to /.
    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/");

    // Forward returns to the replaced slot, proving /settings was overwritten
    // rather than left behind as an extra entry.
    fireEvent.click(forwardButton());
    expect(currentLocation()).toBe("/threads/thr_review");
  });

  it("reconciles a native POP to a known entry", () => {
    renderControls();

    navigateTo("/b");
    navigateTo("/c");

    // Native browser Back into a recorded entry reconciles to it and keeps the
    // forward entry reachable.
    navigateByDelta(-1);
    expect(currentLocation()).toBe("/b");
    expect(backButton()).toHaveProperty("disabled", false);
    expect(forwardButton()).toHaveProperty("disabled", false);

    fireEvent.click(forwardButton());
    expect(currentLocation()).toBe("/c");
  });

  it("treats a POP to an unrecorded entry as the app-owned history boundary", () => {
    // The hook mounts at /settings and only records that entry; the earlier "/"
    // entry exists in the router but was never seen by the app.
    renderControls({ initialEntries: ["/", "/settings"], initialIndex: 1 });

    expect(currentLocation()).toBe("/settings");
    expect(backButton()).toHaveProperty("disabled", true);

    navigateByDelta(-1);

    expect(currentLocation()).toBe("/");
    // Unknown key -> boundary: neither direction is offered into unrecorded
    // history.
    expect(backButton()).toHaveProperty("disabled", true);
    expect(forwardButton()).toHaveProperty("disabled", true);
  });

  it("treats a same-key POP to a different URL as the history boundary", () => {
    // BrowserRouter labels unkeyed document-history entries "default", so two
    // routes can share that key. The hook mounts on the second one and only
    // records it.
    renderControls({
      initialEntries: [
        { pathname: "/", key: "default" },
        { pathname: "/settings", key: "default" },
      ],
      initialIndex: 1,
    });

    expect(currentLocation()).toBe("/settings");
    expect(backButton()).toHaveProperty("disabled", true);

    // POP onto "/" shares the recorded entry's "default" key but is a different
    // route. It must become the boundary, not reconcile to the stale /settings
    // slot.
    navigateByDelta(-1);
    expect(currentLocation()).toBe("/");
    expect(backButton()).toHaveProperty("disabled", true);
    expect(forwardButton()).toHaveProperty("disabled", true);

    // A later push must enable Back to "/". If the boundary had kept the stale
    // "/settings" URL, the recorded current URL would equal the pushed URL and
    // Back would wrongly stay disabled.
    navigateTo("/settings");
    expect(currentLocation()).toBe("/settings");
    expect(backButton()).toHaveProperty("disabled", false);

    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/");
  });

  it("invokes onNavigate after an enabled press and not while disabled", () => {
    const onNavigate = vi.fn();
    renderControls({ onNavigate });

    // Disabled Back must not request the drawer close.
    fireEvent.click(backButton());
    expect(onNavigate).not.toHaveBeenCalled();

    navigateTo("/settings");

    fireEvent.click(backButton());
    expect(currentLocation()).toBe("/");
    expect(onNavigate).toHaveBeenCalledTimes(1);

    fireEvent.click(forwardButton());
    expect(currentLocation()).toBe("/settings");
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});
