// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";

afterEach(cleanup);

it.each([true, false])(
  "protects included plugins while keeping one Installed control: %s",
  (included) => {
    const uninstall = vi.fn();
    render(
      <PluginCatalogInstallControl
        displayName="Notes"
        installed
        included={included}
        onUninstall={uninstall}
      />,
    );
    const button = screen.getByRole("button", { name: "Notes installed" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-disabled")).toBe(String(included));
    expect(uninstall).toHaveBeenCalledTimes(included ? 0 : 1);
  },
);

it("does not install incompatible catalog entries", () => {
  const install = vi.fn();
  render(
    <PluginCatalogInstallControl
      displayName="Notes"
      installed={false}
      disabled
      onInstall={install}
      installJob={null}
      onCancelInstall={vi.fn()}
    />,
  );
  const button = screen.getByRole("button", { name: "Install Notes" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(install).not.toHaveBeenCalled();
});

it.each([
  { state: "installable", disabled: false, installed: false, icon: "Download" },
  { state: "blocked", disabled: true, installed: false, icon: "AlertTriangle" },
  { state: "installed", disabled: false, installed: true, icon: "Check" },
])("shows the $state state with the $icon icon", (state) => {
  render(
    state.installed ? (
      <PluginCatalogInstallControl
        displayName="Notes"
        installed
        included={false}
        onUninstall={vi.fn()}
      />
    ) : (
      <PluginCatalogInstallControl
        displayName="Notes"
        installed={false}
        disabled={state.disabled}
        onInstall={vi.fn()}
        installJob={null}
        onCancelInstall={vi.fn()}
      />
    ),
  );
  const button = screen.getByRole("button");
  expect(button.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
    state.icon,
  );
});

it.each([
  { state: "running" as const, cancels: true },
  { state: "cancelling" as const, cancels: false },
])("cancels a $state install only once", ({ state, cancels }) => {
  const install = vi.fn();
  const cancel = vi.fn();
  render(
    <PluginCatalogInstallControl
      displayName="Notes"
      installed={false}
      disabled={false}
      onInstall={install}
      installJob={{
        id: "job-1",
        target: {
          kind: "catalog",
          entryId: "notes",
          marketplace: "bb-community",
        },
        displayName: "Notes",
        state,
      }}
      onCancelInstall={cancel}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(install).not.toHaveBeenCalled();
  expect(cancel.mock.calls).toEqual(cancels ? [["job-1"]] : []);
});
