// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import {
  sidebarFooterOrderAtom,
  sidebarFooterHiddenAtom,
} from "@/components/sidebar/sidebarFooterPreferences";
import { SidebarFooterSettings } from "@/components/settings/SidebarFooterSettings";
import type { ReactNode } from "react";
import type {
  ExperimentalSidebarFooterActionContext,
  ExperimentalSidebarFooterDisclosureController,
} from "@get-bb/plugin-sdk";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarMenu, SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import {
  PluginSidebarFooterDisclosure,
  PluginSidebarFooterItems,
  usePluginSidebarFooterDisclosure,
} from "./PluginSidebarFooterItems";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="Current path">
      {location.pathname}
      {location.hash}
    </output>
  );
}

function renderWithProviders(ui: ReactNode, store = createStore()) {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <SidebarProvider>
            {ui}
            <LocationProbe />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function FooterHarness() {
  const disclosure = usePluginSidebarFooterDisclosure();
  return (
    <>
      <PluginSidebarFooterDisclosure
        item={disclosure.activeItem}
        onDismiss={disclosure.dismiss}
      />
      <SidebarMenu>
        <PluginSidebarFooterItems
          activeDisclosureKey={disclosure.activeKey}
          onDisclosureCommand={disclosure.handleCommand}
        />
      </SidebarMenu>
    </>
  );
}

function UsageDisclosure({ dismiss }: { dismiss(): void }) {
  return (
    <div>
      <p>Provider usage content</p>
      <button type="button" onClick={dismiss}>
        Dismiss usage
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginLogoStoreForTest();
  vi.restoreAllMocks();
});

describe("PluginSidebarFooterItems", () => {
  it("prefers branding.icon over the logo and contribution icon", () => {
    setPluginLogoUrls(
      new Map([
        [
          "remote",
          {
            displayName: "Remote",
            icon: "FileText",
            compactIconUrl: null,
            logoUrl: "/api/v1/plugins/remote/assets/logo?h=abc",
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    setPluginSlotRegistrations(
      "remote",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "open",
            title: "Remote",
            icon: "Smartphone",
            run: () => {},
          },
        ],
      }),
    );

    renderWithProviders(<FooterHarness />);

    expect(screen.getByRole("button", { name: "Remote" }).dataset.testid).toBe(
      "plugin-sidebar-footer-action-remote-open",
    );
    expect(document.querySelector('[data-icon="FileText"]')).not.toBeNull();
    expect(document.querySelector('[data-icon="Smartphone"]')).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("contains a throwing run without breaking the sidebar", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "boom",
            title: "Boom",
            icon: "Zap",
            run: () => {
              throw new Error("nope");
            },
          },
        ],
      }),
    );

    renderWithProviders(<FooterHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Boom" }));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('sidebarFooterAction "boom" failed: nope'),
    );
  });

  it("opens plugin Settings", () => {
    setPluginSlotRegistrations(
      "remote",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "settings",
            title: "Remote settings",
            icon: "Settings",
            run: ({ openSettings }) => openSettings(),
          },
        ],
      }),
    );

    renderWithProviders(<FooterHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Remote settings" }));

    expect(screen.getByLabelText("Current path").textContent).toBe(
      "/settings/plugins/remote",
    );
  });

  it("runs a unified footer action with plugin-detail navigation", () => {
    const onActivate = vi.fn(
      ({ openPluginDetails }: ExperimentalSidebarFooterActionContext) =>
        openPluginDetails(),
    );
    const definition = definePluginApp((app) => {
      app.experimental_sidebarFooter.register({
        kind: "action",
        id: "remote",
        label: "Remote access",
        icon: "Smartphone",
        onActivate,
      });
    });
    setPluginSlotRegistrations(
      "connect",
      collectPluginAppRegistrations(definition),
    );

    renderWithProviders(<FooterHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Remote access" }));

    expect(onActivate).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current path").textContent).toBe(
      "/settings/plugins/connect",
    );
  });

  it("toggles and dismisses a disclosure accessibly", () => {
    const definition = definePluginApp((app) => {
      app.experimental_sidebarFooter.register({
        kind: "disclosure",
        id: "usage",
        label: "Provider usage",
        icon: "ChartColumn",
        component: UsageDisclosure,
      });
    });
    const registrations = collectPluginAppRegistrations(definition);
    setPluginLogoUrls(
      new Map([
        [
          "usage-plugin",
          {
            displayName: "Usage plugin",
            icon: "Beaker",
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    setPluginSlotRegistrations("usage-plugin", registrations);

    renderWithProviders(<FooterHarness />);

    const trigger = screen.getByRole("button", { name: "Provider usage" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-icon="ChartColumn"]')).not.toBeNull();
    expect(document.querySelector('[data-icon="Beaker"]')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByText("Provider usage content")).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss usage" }));
    expect(screen.queryByText("Provider usage content")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the tooltip closed when the More drawer returns focus after a touch dismissal", () => {
    const definition = definePluginApp((app) => {
      app.experimental_sidebarFooter.register({
        kind: "disclosure",
        id: "usage",
        label: "Provider usage",
        icon: "ChartColumn",
        component: UsageDisclosure,
      });
    });
    setPluginSlotRegistrations(
      "usage-plugin",
      collectPluginAppRegistrations(definition),
    );

    renderWithProviders(<FooterHarness />);
    const trigger = screen.getByRole("button", { name: "Provider usage" });

    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.pointerUp(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);
    expect(screen.getByText("Provider usage content")).toBeDefined();

    const dismissButton = screen.getByRole("button", { name: "Dismiss usage" });
    fireEvent.pointerDown(dismissButton, { pointerType: "touch" });
    fireEvent.pointerUp(dismissButton, { pointerType: "touch" });
    fireEvent.click(dismissButton);
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    fireEvent.pointerUp(document.body, { pointerType: "touch" });
    fireEvent.blur(trigger);
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    fireEvent.pointerUp(document.body, { pointerType: "touch" });
    trigger.focus();
    fireEvent.focus(trigger);

    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lets the host coordinate disclosures from multiple plugins", () => {
    let first: ExperimentalSidebarFooterDisclosureController | null = null;
    let second: ExperimentalSidebarFooterDisclosureController | null = null;
    const firstDefinition = definePluginApp((app) => {
      first = app.experimental_sidebarFooter.register({
        kind: "disclosure",
        id: "status",
        label: "First status",
        icon: "ChartColumn",
        component: () => <p>First content</p>,
      });
    });
    const secondDefinition = definePluginApp((app) => {
      second = app.experimental_sidebarFooter.register({
        kind: "disclosure",
        id: "status",
        label: "Second status",
        icon: "ChartColumn",
        component: () => <p>Second content</p>,
      });
    });
    setPluginSlotRegistrations(
      "first-plugin",
      collectPluginAppRegistrations(firstDefinition),
    );
    setPluginSlotRegistrations(
      "second-plugin",
      collectPluginAppRegistrations(secondDefinition),
    );
    renderWithProviders(<FooterHarness />);

    const firstTrigger = screen.getByRole("button", { name: "First status" });
    const secondTrigger = screen.getByRole("button", {
      name: "Second status",
    });

    fireEvent.click(firstTrigger);
    expect(screen.getByText("First content")).toBeDefined();
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(secondTrigger);
    expect(screen.queryByText("First content")).toBeNull();
    expect(screen.getByText("Second content")).toBeDefined();
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(secondTrigger.getAttribute("aria-expanded")).toBe("true");

    act(() => first!.close());
    expect(screen.getByText("Second content")).toBeDefined();

    act(() => {
      second!.open();
      first!.open();
    });
    expect(screen.getByText("First content")).toBeDefined();
    expect(screen.queryByText("Second content")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("First content")).toBeNull();
  });

  it("moves an open disclosure into More, still opens it there, and restores it through appearance settings", async () => {
    const definition = definePluginApp((app) => {
      app.experimental_sidebarFooter.register({
        kind: "disclosure",
        id: "usage",
        label: "Provider usage",
        icon: "ChartColumn",
        component: () => <p>Usage detail</p>,
      });
    });
    setPluginSlotRegistrations(
      "usage-plugin",
      collectPluginAppRegistrations(definition),
    );
    const store = createStore();
    renderWithProviders(
      <>
        <FooterHarness />
        <SidebarFooterSettings />
      </>,
      store,
    );
    expect(
      screen.queryByRole("button", { name: "More footer actions" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Provider usage" }));
    expect(screen.getByText("Usage detail")).toBeDefined();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Provider usage" }),
    );
    fireEvent.pointerUp(
      await screen.findByRole("menuitem", { name: "Customize footer" }),
      { button: 2, pointerType: "mouse" },
    );
    expect(screen.getByLabelText("Current path").textContent).toBe("/");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hide" }));
    await waitFor(() => expect(screen.queryByText("Usage detail")).toBeNull());
    expect(store.get(sidebarFooterHiddenAtom)).toEqual([
      "plugin:usage-plugin/usage",
    ]);
    expect(screen.queryByRole("button", { name: "Provider usage" })).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More footer actions" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Provider usage" }),
    );
    await screen.findByText("Usage detail");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("sidebar-footer-more"),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Show Provider usage in footer" }),
    );
    expect(
      screen.getByRole("button", { name: "Provider usage" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "More footer actions" }),
    ).toBeNull();
  });

  it("keeps hidden actions callable and preserves preferences across plugin reloads", async () => {
    const run = vi.fn();
    const registration = collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.experimental_sidebarFooter.register({
          kind: "action",
          id: "action",
          label: "Run action",
          icon: "Zap",
          onActivate: run,
        });
      }),
    );
    setPluginSlotRegistrations("example", registration);
    const store = createStore();
    store.set(sidebarFooterHiddenAtom, ["plugin:example/action"]);
    store.set(sidebarFooterOrderAtom, [
      "plugin:missing/item",
      "plugin:example/action",
    ]);
    renderWithProviders(<FooterHarness />, store);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More footer actions" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Run action" }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    act(() => removePluginSlotRegistrations("example"));
    expect(
      screen.queryByRole("button", { name: "More footer actions" }),
    ).toBeNull();
    act(() =>
      setPluginSlotRegistrations(
        "new-plugin",
        collectPluginAppRegistrations(
          definePluginApp((app) => {
            app.experimental_sidebarFooter.register({
              kind: "action",
              id: "new",
              label: "New action",
              icon: "Zap",
              onActivate: run,
            });
          }),
        ),
      ),
    );
    expect(screen.getByRole("button", { name: "New action" })).toBeDefined();
    act(() => setPluginSlotRegistrations("example", registration));
    expect(screen.queryByRole("button", { name: "Run action" })).toBeNull();
    expect(store.get(sidebarFooterHiddenAtom)).toEqual([
      "plugin:example/action",
    ]);
    expect(store.get(sidebarFooterOrderAtom)).toEqual([
      "plugin:missing/item",
      "plugin:example/action",
    ]);
  });

  it("orders built-in and plugin shortcuts together and keeps all-hidden actions reachable", async () => {
    const run = vi.fn();
    setPluginSlotRegistrations(
      "example",
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.experimental_sidebarFooter.register({
            kind: "action",
            id: "action",
            label: "Run action",
            icon: "Zap",
            onActivate: run,
          });
        }),
      ),
    );
    const store = createStore();
    store.set(sidebarFooterOrderAtom, [
      "builtin:report-bug",
      "plugin:example/action",
      "builtin:settings",
    ]);
    const view = renderWithProviders(
      <SidebarMenu>
        <PluginSidebarFooterItems
          activeDisclosureKey={null}
          onDisclosureCommand={vi.fn()}
          builtInActions={[
            { id: "settings", onActivate: run },
            { id: "report-bug", onActivate: run },
          ]}
        />
      </SidebarMenu>,
      store,
    );
    expect(
      [...view.container.querySelectorAll("[data-footer-item]")].map((item) =>
        item.getAttribute("data-footer-item"),
      ),
    ).toEqual([
      "builtin:report-bug",
      "plugin:example/action",
      "builtin:settings",
    ]);
    act(() =>
      store.set(sidebarFooterHiddenAtom, [
        "builtin:settings",
        "builtin:report-bug",
        "plugin:example/action",
      ]),
    );
    expect(view.container.querySelectorAll("[data-footer-item]")).toHaveLength(
      0,
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More footer actions" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
