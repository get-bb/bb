// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

describe("GitHub app fixed-tab navigation", () => {
  it("registers an owner-validated targeted details tab", () => {
    const details = app.navPanels[0]?.experimental_fixedTabs?.[0];
    expect(details).toMatchObject({
      id: "details",
      title: "Details",
      icon: "Info",
      layout: "flush",
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
});
