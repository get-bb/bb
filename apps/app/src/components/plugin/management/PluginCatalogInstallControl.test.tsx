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
    />,
  );
  const button = screen.getByRole("button", { name: "Install Notes" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(install).not.toHaveBeenCalled();
});
