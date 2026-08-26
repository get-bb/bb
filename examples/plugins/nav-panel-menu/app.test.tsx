// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalPluginNavPanelMenuContext } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("nav panel menu example", () => {
  it("registers two groups and keeps API surface children lazy", async () => {
    const panel = app.navPanels[0];
    expect(panel).toMatchObject({
      id: "nav-panel-menu",
      title: "Nav panel menu",
      path: "nav-panel-menu",
    });
    expect(panel?.experimental_menu).toHaveLength(2);
    expect(panel?.experimental_menu?.map((group) => group.label)).toEqual([
      "Navigation",
      "Workspace",
    ]);

    const lazySubmenu = panel?.experimental_menu?.[0]?.items[1];
    expect(lazySubmenu).toBeDefined();
    if (lazySubmenu === undefined || !("items" in lazySubmenu)) {
      throw new Error("Expected the API surfaces submenu");
    }
    expect(lazySubmenu.items).toBeTypeOf("function");
    if (typeof lazySubmenu.items !== "function") {
      throw new Error("Expected lazy submenu items to be a function");
    }

    const navigate = vi.fn();
    const context: ExperimentalPluginNavPanelMenuContext = {
      pluginId: "nav-panel-menu",
      panelId: "nav-panel-menu",
      navigate,
      openInSplit: vi.fn(),
    };
    const items = await lazySubmenu.items(context);
    expect(items.map((item) => item.label)).toEqual([
      "Agents",
      "App slots",
      "Storage",
    ]);

    await items[1]?.run(context);
    expect(navigate).toHaveBeenCalledWith("surfaces/app-slots");
  });

  it("renders the selected surface route", async () => {
    const panel = app.navPanels[0];
    if (panel === undefined) throw new Error("Expected a nav panel");

    const slot = renderSlot(panel, { subPath: "surfaces/agents" });
    expect(await slot.findByRole("heading", { name: "Agents" })).toBeTruthy();
  });
});
