// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
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
    });

    const slot = renderSlot(app.navPanels[0]!, { subPath: "" });
    expect(await slot.findByText("Plugin API Tester is active")).toBeTruthy();
  });
});
