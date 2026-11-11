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

describe("page title registration", () => {
  it.each([undefined, () => ({ title: "Detail" }), false])(
    "accepts a hook or absence and rejects untyped values: %s",
    (hook) => {
      const collect = () =>
        collectPluginAppRegistrations({
          __bbPluginApp: true,
          setup(app) {
            app.slots.navPanel({
              id: "main",
              title: "Main",
              path: "main",
              icon: "House",
              component: Page,
              // @ts-expect-error Exercise the JavaScript registration boundary.
              experimental_usePageTitle: hook,
            });
          },
        });
      if (hook === false)
        expect(collect).toThrow(
          '"experimental_usePageTitle" must be a React hook function',
        );
      else expect(collect().navPanels[0]?.experimental_usePageTitle).toBe(hook);
    },
  );
});

describe("header title and hidden navigation registration", () => {
  function collectPanel(fields: Record<string, unknown>) {
    return () =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.navPanel({
            id: "new-chat",
            title: "New chat",
            path: "new-chat",
            icon: "Chat",
            component: Page,
            ...fields,
          });
        },
      }).navPanels[0];
  }

  it("keeps a header title component and a true hide flag", () => {
    const panel = collectPanel({
      experimental_headerTitle: Sidebar,
      experimental_hideFromNavigation: true,
    })();
    expect(panel?.experimental_headerTitle).toBe(Sidebar);
    expect(panel?.experimental_hideFromNavigation).toBe(true);
  });

  it("leaves both out when they are absent or the flag is false", () => {
    expect(collectPanel({})()).not.toHaveProperty("experimental_headerTitle");
    expect(
      collectPanel({ experimental_hideFromNavigation: false })(),
    ).not.toHaveProperty("experimental_hideFromNavigation");
  });

  it("rejects a header title that is not a component and a non-boolean flag", () => {
    expect(collectPanel({ experimental_headerTitle: "Breadcrumb" })).toThrow(
      '"experimental_headerTitle" must be a React component function',
    );
    expect(collectPanel({ experimental_hideFromNavigation: "yes" })).toThrow(
      '"experimental_hideFromNavigation" must be a boolean',
    );
  });
});
