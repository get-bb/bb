// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarMenu, SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  PluginSidebarFooterDisclosure,
  PluginSidebarFooterItems,
  usePluginSidebarFooterDisclosure,
} from "./PluginSidebarFooterItems";

function DisclosureHarness() {
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
          suppressedTooltipKey={disclosure.suppressedTooltipKey}
          onTooltipSuppressionEnd={disclosure.clearTooltipSuppression}
          onDisclosureCommand={disclosure.handleCommand}
        />
      </SidebarMenu>
    </>
  );
}

function renderDisclosure() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <DisclosureHarness />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

it("keeps the active footer disclosure across a host remount", () => {
  const definition = definePluginApp((app) => {
    app.experimental_sidebarFooter.register({
      kind: "disclosure",
      id: "status",
      label: "Provider status",
      icon: "ChartColumn",
      component: ({ dismiss }) => (
        <div>
          <p>Provider status content</p>
          <button type="button" onClick={dismiss}>
            Close provider status
          </button>
        </div>
      ),
    });
  });
  setPluginSlotRegistrations(
    "status-plugin",
    collectPluginAppRegistrations(definition),
  );

  const firstHost = renderDisclosure();
  fireEvent.click(screen.getByRole("button", { name: "Provider status" }));
  expect(screen.getByText("Provider status content")).toBeTruthy();
  firstHost.unmount();

  const secondHost = renderDisclosure();
  expect(screen.getByText("Provider status content")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Provider status" })
      .getAttribute("aria-expanded"),
  ).toBe("true");

  fireEvent.click(
    screen.getByRole("button", { name: "Close provider status" }),
  );
  expect(screen.queryByText("Provider status content")).toBeNull();
  secondHost.unmount();

  renderDisclosure();
  expect(
    screen
      .getByRole("button", { name: "Provider status" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(screen.queryByText("Provider status content")).toBeNull();
});
