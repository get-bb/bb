// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("Plugin API Tester panel", () => {
  it("registers and renders the placeholder panel", async () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "plugin-api-tester",
      title: "Plugin API Tester",
      icon: "Beaker",
      path: "plugin-api-tester",
      experimental_sidebarAccessory: expect.any(Function),
      experimental_sidebarSubItems: [
        {
          id: "overview",
          title: "Overview",
          icon: "Info",
          subPath: "overview",
        },
        {
          id: "activity",
          title: "Activity",
          icon: "Workflow",
          subPath: "activity",
        },
      ],
    });

    const slot = renderSlot(app.navPanels[0]!, { subPath: "activity" });
    expect(await slot.findByText("Plugin API Tester is active")).toBeTruthy();
    expect(slot.getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(slot.getByText("Current sub-path: activity")).toBeTruthy();

    const ParentAccessory = app.navPanels[0]?.experimental_sidebarAccessory;
    expect(ParentAccessory).toBeTypeOf("function");
    const parentAccessory = render(createElement(ParentAccessory!));
    expect(parentAccessory.getByText("API")).toBeTruthy();

    const Accessory =
      app.navPanels[0]?.experimental_sidebarSubItems?.[1]
        ?.experimental_sidebarAccessory;
    expect(Accessory).toBeTypeOf("function");
    const accessory = render(createElement(Accessory!));
    expect(accessory.getByText("3")).toBeTruthy();
  });
});
