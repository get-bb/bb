import { describe, expect, it } from "vitest";
import {
  collectPluginAppRegistrations,
  registeredComponents,
} from "./plugin-app-collector.js";

const Settings = () => null;
const Summary = () => null;
const Details = () => null;
const Banner = () => null;
const Action = () => null;
const Popup = () => null;
const Page = () => null;
const PageSidebar = () => null;

describe("registered components", () => {
  it("lists every component a registration declares, including nested composer parts, and no other functions", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.settingsSection({ id: "settings", component: Settings });
        app.slots.experimental_threadContextSegment({
          id: "segment",
          title: "Segment",
          group: "git",
          summary: Summary,
          details: Details,
          useVisible: () => true,
        });
        app.slots.navPanel({
          id: "panel",
          title: "Panel",
          path: "panel",
          icon: "House",
          component: Page,
          experimental_sidebar: PageSidebar,
        });
        app.composer.customize({
          id: "custom",
          banners: [{ id: "banner", component: Banner }],
          actions: [{ id: "action", component: Action }],
          experimental_popups: [
            { id: "popup", label: "Popup", component: Popup },
          ],
        });
      },
    });

    const components = registeredComponents(captured);
    for (const component of [
      Settings,
      Summary,
      Details,
      Page,
      PageSidebar,
      Banner,
      Action,
      Popup,
    ]) {
      expect(components).toContain(component);
    }
    expect(
      components.filter((component) => typeof component === "function"),
    ).toHaveLength(8);
  });
});
