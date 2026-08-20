// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

describe("GitHub app fixed-tab navigation", () => {
  it("registers an owner-validated targeted details tab", () => {
    const details = app.navPanels[0]?.experimental_fixedTabs?.[0];
    expect(details).toMatchObject({
      id: "details",
      title: "Details",
      icon: "Info",
      layout: "padded",
    });
    expect(
      details?.experimental_target?.validate({
        kind: "item",
        itemKind: "pr",
        repo: "get-bb/bb",
        number: 42,
      }),
    ).toBe(true);
    expect(
      details?.experimental_target?.validate({
        kind: "item",
        itemKind: "pr",
        repo: "get-bb/bb",
        number: -1,
      }),
    ).toBe(false);
  });

  it("uses the standard responsive page inset for the main panel", () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listItems: () => ({ items: [] }),
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [],
            lastSyncedAt: null,
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );

    expect(slot.container.firstElementChild?.className).toContain("p-4 md:p-5");
    expect(slot.container.firstElementChild?.className).not.toContain("p-3");
    slot.lifecycle.unmount();
  });
});
