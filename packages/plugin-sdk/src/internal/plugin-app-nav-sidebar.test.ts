import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Page = () => null;
const Sidebar = () => null;

describe("route-scoped navigation sidebar", () => {
  it("preserves a component only on the declaring panel and keeps legacy panels unchanged", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.navPanel({
          id: "home",
          title: "Home",
          path: "home",
          icon: "House",
          component: Page,
          experimental_sidebar: Sidebar,
        });
        app.slots.navPanel({
          id: "other",
          title: "Other",
          path: "other",
          icon: "House",
          component: Page,
        });
      },
    });
    expect(captured.navPanels[0]?.experimental_sidebar).toBe(Sidebar);
    expect(captured.navPanels[1]).not.toHaveProperty("experimental_sidebar");
  });
  it("rejects malformed untyped components at registration", () => {
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.navPanel({
            id: "home",
            title: "Home",
            path: "home",
            icon: "House",
            component: Page,
            // @ts-expect-error Exercise an untyped plugin registration boundary.
            experimental_sidebar: true,
          });
        },
      }),
    ).toThrow('"experimental_sidebar" must be a React component function');
  });
});
