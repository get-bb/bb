// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  RouteAnchor,
  RouteNavigationProvider,
  useIsRouteNavigationPending,
} from "./app-route-anchor";

afterEach(() => {
  cleanup();
});

interface NavigationSample {
  isPending: boolean;
  pathname: string;
}

const samples: NavigationSample[] = [];

/**
 * Records every committed (isPending, pathname) pair. The pairs prove commit
 * ordering: a `{ isPending: true, pathname: <old> }` sample means the pending
 * flag painted while the previous route was still on screen, i.e. the tap's
 * event did not flush the destination route synchronously.
 */
function NavigationSampler() {
  const isPending = useIsRouteNavigationPending();
  const { pathname } = useLocation();
  samples.push({ isPending, pathname });
  return null;
}

describe("RouteAnchor transition navigation", () => {
  it("swaps the route in a later commit than the tap and signals pending in between", () => {
    samples.length = 0;
    render(
      <MemoryRouter initialEntries={["/threads/thr-old"]}>
        <RouteNavigationProvider>
          <NavigationSampler />
          <RouteAnchor href="/threads/thr-new">open thr-new</RouteAnchor>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    expect(samples).toEqual([
      { isPending: false, pathname: "/threads/thr-old" },
    ]);

    fireEvent.click(screen.getByRole("link", { name: "open thr-new" }));

    // The tap's urgent commit shows the pending affordance with the old route
    // still mounted; the destination route lands in a follow-up transition
    // commit, which also clears the pending flag.
    expect(samples).toContainEqual({
      isPending: true,
      pathname: "/threads/thr-old",
    });
    expect(samples.at(-1)).toEqual({
      isPending: false,
      pathname: "/threads/thr-new",
    });
  });
});
