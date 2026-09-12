// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginDetailRouteNavigationProvider,
  RouteAnchor,
  RouteNavigationProvider,
  useIsRouteNavigationPending,
  useRouteAnchorDelegate,
} from "./app-route-anchor";

const openPaneContentInSplit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/split-layout/openPaneContentInSplit", () => ({
  openPaneContentInSplit,
}));

afterEach(() => {
  cleanup();
  openPaneContentInSplit.mockReset();
});

interface NavigationSample {
  isPending: boolean;
  pathname: string;
}

const samples: NavigationSample[] = [];

function NavigationSampler() {
  const isPending = useIsRouteNavigationPending();
  const { pathname } = useLocation();
  samples.push({ isPending, pathname });
  return null;
}

function PluginDetailLinkDelegate() {
  const onRouteAnchorClick = useRouteAnchorDelegate();
  return (
    <div onClick={onRouteAnchorClick}>
      <a href="/plugins/secrets">Open Secrets plugin</a>
    </div>
  );
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
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

describe("useRouteAnchorDelegate plugin-detail links", () => {
  it("opens plugin-detail links in a split when no plugin-detail navigation is provided", () => {
    render(
      <MemoryRouter initialEntries={["/threads/thr-current"]}>
        <RouteNavigationProvider>
          <CurrentPath />
          <PluginDetailLinkDelegate />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    const notPrevented = fireEvent.click(
      screen.getByRole("link", { name: "Open Secrets plugin" }),
    );

    expect(notPrevented).toBe(false);
    expect(openPaneContentInSplit).toHaveBeenCalledTimes(1);
    expect(openPaneContentInSplit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { kind: "plugin-detail", pluginId: "secrets" },
        route: "/plugins/secrets",
      }),
    );
    expect(screen.getByTestId("current-path").textContent).toBe(
      "/threads/thr-current",
    );
  });

  it("lets a plugin-detail navigation provider handle the link without opening a split", () => {
    const onOpenPluginDetail = vi.fn(() => true);
    render(
      <MemoryRouter initialEntries={["/threads/thr-current"]}>
        <RouteNavigationProvider>
          <CurrentPath />
          <PluginDetailRouteNavigationProvider
            onOpenPluginDetail={onOpenPluginDetail}
          >
            <PluginDetailLinkDelegate />
          </PluginDetailRouteNavigationProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    const notPrevented = fireEvent.click(
      screen.getByRole("link", { name: "Open Secrets plugin" }),
    );

    expect(notPrevented).toBe(false);
    expect(onOpenPluginDetail).toHaveBeenCalledWith("secrets");
    expect(openPaneContentInSplit).not.toHaveBeenCalled();
    expect(screen.getByTestId("current-path").textContent).toBe(
      "/threads/thr-current",
    );
  });
});
