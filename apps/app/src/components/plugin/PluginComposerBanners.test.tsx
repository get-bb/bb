// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PluginComposerBanners } from "./PluginComposerBanners";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";

function registrations(
  composerCustomizations: PluginRegistrationSet["composerCustomizations"],
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    composerCustomizations,
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  };
}

beforeEach(() => {
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginComposerBanners", () => {
  it("uses card chrome by default and leaves bare banners unwrapped", () => {
    setPluginSlotRegistrations(
      "example-plugin",
      registrations([
        {
          id: "chrome",
          banners: [
            { id: "card", component: () => <div>card body</div> },
            {
              id: "bare",
              chrome: "bare",
              component: () => <div>bare body</div>,
            },
          ],
        },
      ]),
    );

    render(
      <PluginComposerBanners scope={{ kind: "thread", threadId: "t1" }} />,
    );

    expect(
      screen
        .getByRole("region", { name: "example-plugin" })
        .contains(screen.getByText("card body")),
    ).toBe(true);
    expect(screen.getByText("bare body").closest("section")).toBeNull();
  });

  it("collapses an empty card row when its component renders null", () => {
    setPluginSlotRegistrations(
      "empty-plugin",
      registrations([
        {
          id: "empty",
          banners: [{ id: "nothing", component: () => null }],
        },
      ]),
    );

    render(
      <PluginComposerBanners scope={{ kind: "thread", threadId: "t1" }} />,
    );

    expect(
      screen.getByRole("region", { name: "empty-plugin" }).className,
    ).toContain("empty:hidden");
  });

  it("collapses only the crashing banner", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crash(): never {
      throw new Error("banner exploded");
    }
    setPluginSlotRegistrations(
      "isolated-plugin",
      registrations([
        {
          id: "isolation",
          banners: [
            { id: "broken", component: Crash },
            { id: "healthy", component: () => <div>healthy banner</div> },
          ],
        },
      ]),
    );

    render(
      <PluginComposerBanners scope={{ kind: "thread", threadId: "t1" }} />,
    );

    expect(screen.queryByText("plugin isolated-plugin crashed")).toBeNull();
    expect(screen.getByText("healthy banner")).toBeDefined();
  });

  it("remounts banners when the scope identity changes", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function StatefulBanner() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <div>stateful banner</div>;
    }
    setPluginSlotRegistrations(
      "stateful-plugin",
      registrations([
        {
          id: "stateful",
          banners: [{ id: "banner", component: StatefulBanner }],
        },
      ]),
    );

    const view = render(
      <PluginComposerBanners scope={{ kind: "thread", threadId: "t1" }} />,
    );
    view.rerender(
      <PluginComposerBanners scope={{ kind: "thread", threadId: "t2" }} />,
    );

    expect(mounted).toHaveBeenCalledTimes(2);
    expect(unmounted).toHaveBeenCalledTimes(1);
  });

  it("preserves deterministic plugin and registration ordering", () => {
    setPluginSlotRegistrations(
      "zeta",
      registrations([
        {
          id: "last-plugin",
          banners: [{ id: "z", component: () => <div>zeta</div> }],
        },
      ]),
    );
    setPluginSlotRegistrations(
      "alpha",
      registrations([
        {
          id: "first-registration",
          banners: [
            { id: "a1", component: () => <div>alpha one</div> },
            { id: "a2", component: () => <div>alpha two</div> },
          ],
        },
        {
          id: "second-registration",
          banners: [{ id: "a3", component: () => <div>alpha three</div> }],
        },
      ]),
    );

    render(
      <PluginComposerBanners scope={{ kind: "thread", threadId: "t1" }} />,
    );

    expect(
      screen
        .getAllByText(/^(alpha|zeta)/)
        .map((element) => element.textContent),
    ).toEqual(["alpha one", "alpha two", "alpha three", "zeta"]);
  });
});
