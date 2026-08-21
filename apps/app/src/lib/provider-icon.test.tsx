// @vitest-environment jsdom

import { createElement } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "./plugin-slots";
import { getProviderIconInfo } from "./provider-icon";

const EMPTY_REGISTRATIONS: PluginRegistrationSet = {
  homepageSections: [],
  settingsSections: [],
  navPanels: [],
  threadPanelActions: [],
  sidebarFooterActions: [],
  fileOpeners: [],
  messageDirectives: [],
};

function PluginCodexIcon({ className }: { className?: string }) {
  return (
    <svg className={className} data-testid="plugin-codex-icon">
      <title>Codex from the plugin</title>
    </svg>
  );
}

afterEach(() => {
  resetPluginSlotStoreForTest();
});

describe("getProviderIconInfo", () => {
  it("prefers a configured provider logo over the generic ACP icon", () => {
    const iconInfo = getProviderIconInfo(
      "acp-do-computer",
      "/api/v1/system/providers/acp-do-computer/logo",
    );
    if (iconInfo === undefined) {
      throw new Error("Expected configured provider logo icon info");
    }
    expect(
      getProviderIconInfo(
        "acp-do-computer",
        "/api/v1/system/providers/acp-do-computer/logo",
      )?.icon,
    ).toBe(iconInfo.icon);

    const view = render(
      createElement(iconInfo.icon, { className: "size-4 shrink-0" }),
    );
    const logo = view.container.querySelector("img");
    expect(logo).not.toBeNull();
    if (logo === null) {
      throw new Error("Expected provider logo image");
    }
    expect(logo.getAttribute("src")).toBe(
      "/api/v1/system/providers/acp-do-computer/logo",
    );

    fireEvent.error(logo);
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("svg")).not.toBeNull();
  });

  it("keeps vendored theme-aware brand marks over a server logoUrl", () => {
    // An SVG rendered through <img> is a separate document: currentColor
    // resolves to black there, invisible on dark themes. Known ids must keep
    // their inline React marks even when the server provides a logoUrl.
    for (const providerId of ["codex", "claude-code", "pi", "acp-opencode"]) {
      const iconInfo = getProviderIconInfo(
        providerId,
        `/api/v1/system/providers/${providerId}/logo`,
      );
      if (iconInfo === undefined) {
        throw new Error(`Expected icon info for ${providerId}`);
      }
      const view = render(createElement(iconInfo.icon, {}));
      expect(view.container.querySelector("img"), providerId).toBeNull();
      expect(view.container.querySelector("svg"), providerId).not.toBeNull();
      view.unmount();
    }
  });

  it("lets a plugin-registered component win, and falls back when it goes away", () => {
    const iconInfo = getProviderIconInfo(
      "codex",
      "/api/v1/system/providers/codex/logo",
    );
    if (iconInfo === undefined) {
      throw new Error("Expected icon info for codex");
    }
    const view = render(createElement(iconInfo.icon, { className: "size-4" }));
    // Vendored mark before any plugin frontend has booted.
    expect(view.container.querySelector("[data-testid]")).toBeNull();
    expect(view.container.querySelector("svg")).not.toBeNull();

    act(() => {
      setPluginSlotRegistrations("provider-codex", {
        ...EMPTY_REGISTRATIONS,
        providerIcons: [{ providerId: "codex", icon: PluginCodexIcon }],
      });
    });

    const pluginMark = view.container.querySelector(
      '[data-testid="plugin-codex-icon"]',
    );
    expect(pluginMark).not.toBeNull();
    // Inline SVG, not an <img>: currentColor has to reach the app theme.
    expect(view.container.querySelector("img")).toBeNull();

    // Disable / failed reload disposes the registration.
    act(() => {
      removePluginSlotRegistrations("provider-codex");
    });
    expect(
      view.container.querySelector('[data-testid="plugin-codex-icon"]'),
    ).toBeNull();
    expect(view.container.querySelector("svg")).not.toBeNull();
    view.unmount();
  });

  it("renders a plugin icon for a provider that has no vendored mark", () => {
    setPluginSlotRegistrations("provider-thing", {
      ...EMPTY_REGISTRATIONS,
      providerIcons: [{ providerId: "thing", icon: PluginCodexIcon }],
    });
    const iconInfo = getProviderIconInfo("thing");
    if (iconInfo === undefined) {
      throw new Error("Expected plugin icon info for thing");
    }
    expect(iconInfo.ariaLabel).toBe("thing");
    const view = render(createElement(iconInfo.icon, {}));
    expect(
      view.container.querySelector('[data-testid="plugin-codex-icon"]'),
    ).not.toBeNull();
    view.unmount();
  });

  it("keeps the first plugin by id when two claim one provider", () => {
    setPluginSlotRegistrations("aaa-squatter", {
      ...EMPTY_REGISTRATIONS,
      providerIcons: [{ providerId: "codex", icon: PluginCodexIcon }],
    });
    setPluginSlotRegistrations("provider-codex", {
      ...EMPTY_REGISTRATIONS,
      providerIcons: [
        {
          providerId: "codex",
          icon: ({ className }: { className?: string }) => (
            <svg className={className} data-testid="second-icon" />
          ),
        },
      ],
    });
    const iconInfo = getProviderIconInfo("codex");
    if (iconInfo === undefined) {
      throw new Error("Expected icon info for codex");
    }
    const view = render(createElement(iconInfo.icon, {}));
    expect(
      view.container.querySelector('[data-testid="plugin-codex-icon"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector('[data-testid="second-icon"]'),
    ).toBeNull();
    view.unmount();
  });
});
