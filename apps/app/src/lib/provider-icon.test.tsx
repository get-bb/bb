import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "./plugin-app-definition";
// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";
import { getProviderIconInfo } from "./provider-icon";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const EMPTY_REGISTRATIONS = makePluginRegistrationSet();

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
  it("isolates same-id providers, prefers specific overrides, and restores legacy and asset fallbacks on unload", () => {
    const kinds = ["agent", "machine", "environment"] as const;
    const legacy = collectPluginAppRegistrations(
      definePluginApp((app) => {
        // @ts-expect-error legacy plugin declaration
        app.slots.experimental_providerIcon({
          providerId: "shared",
          icon: () => <svg data-mark="legacy" />,
        });
      }),
    );
    setPluginSlotRegistrations("aaa-legacy", legacy);
    const views = kinds.map((kind) => {
      const info = getProviderIconInfo(kind, "shared", {
        logoUrl: "/shared.svg",
      });
      if (!info) throw new Error("Missing icon");
      return render(createElement(info.icon));
    });
    for (const view of views)
      expect(
        view.container.querySelector('[data-mark="legacy"]'),
      ).not.toBeNull();
    act(() => {
      for (const providerKind of kinds) {
        setPluginSlotRegistrations(
          `zzz-${providerKind}`,
          collectPluginAppRegistrations(
            definePluginApp((app) => {
              app.slots.experimental_providerIcon({
                providerKind,
                providerId: "shared",
                icon: () => <svg data-mark={providerKind} />,
              });
            }),
          ),
        );
      }
    });
    for (const [index, kind] of kinds.entries()) {
      expect(
        views[index]!.container.querySelector("[data-mark]")?.getAttribute(
          "data-mark",
        ),
      ).toBe(kind);
    }
    act(() => removePluginSlotRegistrations("zzz-machine"));
    expect(
      views[1]!.container
        .querySelector("[data-mark]")
        ?.getAttribute("data-mark"),
    ).toBe("legacy");
    expect(
      views[0]!.container
        .querySelector("[data-mark]")
        ?.getAttribute("data-mark"),
    ).toBe("agent");
    expect(
      views[2]!.container
        .querySelector("[data-mark]")
        ?.getAttribute("data-mark"),
    ).toBe("environment");
    act(() => removePluginSlotRegistrations("aaa-legacy"));
    expect(
      views[1]!.container.querySelector("[data-provider-logo]"),
    ).not.toBeNull();
    for (const kind of ["agent", "environment"] as const)
      act(() => removePluginSlotRegistrations(`zzz-${kind}`));
    for (const view of views) {
      expect(
        view.container.querySelector("[data-provider-logo]"),
      ).not.toBeNull();
      view.unmount();
    }
  });

  it("draws a served logo as a currentColor mask", () => {
    const iconInfo = getProviderIconInfo("agent", "acp-do-computer", {
      logoUrl: "/api/v1/system/providers/acp-do-computer/logo",
      family: "acp",
      displayName: "Do Computer",
    });
    if (iconInfo === undefined) {
      throw new Error("Expected configured provider logo icon info");
    }
    expect(iconInfo.ariaLabel).toBe("Do Computer");
    expect(
      getProviderIconInfo("agent", "acp-do-computer", {
        logoUrl: "/api/v1/system/providers/acp-do-computer/logo",
        family: "acp",
        displayName: "Do Computer",
      })?.icon,
    ).toBe(iconInfo.icon);

    const view = render(
      createElement(iconInfo.icon, { className: "size-4 shrink-0" }),
    );
    const mask = view.container.querySelector<HTMLElement>(
      "[data-provider-logo]",
    );
    expect(mask).not.toBeNull();
    if (mask === null) {
      throw new Error("Expected provider logo mask");
    }
    expect(mask.style.maskImage).toContain(
      "/api/v1/system/providers/acp-do-computer/logo",
    );
    expect(mask.className).toContain("bg-current");
    expect(mask.parentElement?.className).toContain("size-4");

    expect(view.container.querySelector("img")).toBeNull();
  });

  it("renders a generic fallback for a provider known only by id", () => {
    const info = getProviderIconInfo("agent", "codex");
    const view = render(createElement(info.icon));
    expect(view.container.querySelector('[data-icon="Code"]')).not.toBeNull();
    act(() =>
      setPluginSlotRegistrations("provider-codex", {
        ...EMPTY_REGISTRATIONS,
        providerIcons: [
          { providerKind: "agent", providerId: "codex", icon: PluginCodexIcon },
        ],
      }),
    );
    expect(
      view.container.querySelector('[data-testid="plugin-codex-icon"]'),
    ).not.toBeNull();
    view.unmount();
  });

  it("draws a declared host glyph for a provider without a logo, and keeps it below a logo", () => {
    const glyphInfo = getProviderIconInfo("agent", "echo-agent", {
      logoUrl: null,
      icon: { glyph: "Zap" },
    });
    if (glyphInfo === undefined) {
      throw new Error("Expected a glyph icon for echo-agent");
    }
    expect(
      getProviderIconInfo("agent", "echo-agent", {
        logoUrl: null,
        icon: { glyph: "Zap" },
      })?.icon,
    ).toBe(glyphInfo.icon);
    const glyphView = render(
      createElement(glyphInfo.icon, { className: "size-4" }),
    );
    expect(
      glyphView.container.querySelector("[data-provider-logo]"),
    ).toBeNull();
    expect(
      glyphView.container.querySelector('svg[data-icon="Zap"]'),
    ).not.toBeNull();
    glyphView.unmount();

    const missingInfo = getProviderIconInfo("agent", "echo-agent", {
      logoUrl: null,
      icon: { glyph: "NoSuchGlyph" },
    });
    expect(missingInfo).toBeDefined();
    const missingView = render(createElement(missingInfo!.icon, {}));
    expect(
      missingView.container.querySelector('[data-icon="Code"]'),
    ).not.toBeNull();
    missingView.unmount();

    const bothInfo = getProviderIconInfo("agent", "echo-agent", {
      logoUrl: "/api/v1/system/providers/echo-agent/logo",
      icon: { glyph: "Zap" },
    });
    if (bothInfo === undefined) {
      throw new Error("Expected icon info when both forms are present");
    }
    const bothView = render(createElement(bothInfo.icon, {}));
    expect(
      bothView.container.querySelector("[data-provider-logo]"),
    ).not.toBeNull();
    bothView.unmount();

    expect(
      getProviderIconInfo("agent", "echo-agent", { logoUrl: null }),
    ).toBeDefined();
  });

  it("lets a plugin-registered component win, and falls back when it goes away", () => {
    const iconInfo = getProviderIconInfo("agent", "codex", {
      logoUrl: "/api/v1/system/providers/codex/logo",
    });
    if (iconInfo === undefined) {
      throw new Error("Expected icon info for codex");
    }
    const view = render(createElement(iconInfo.icon, { className: "size-4" }));
    expect(view.container.querySelector("[data-testid]")).toBeNull();
    expect(view.container.querySelector("[data-provider-logo]")).not.toBeNull();

    act(() => {
      setPluginSlotRegistrations("provider-codex", {
        ...EMPTY_REGISTRATIONS,
        providerIcons: [
          { providerKind: "agent", providerId: "codex", icon: PluginCodexIcon },
        ],
      });
    });

    const pluginMark = view.container.querySelector(
      '[data-testid="plugin-codex-icon"]',
    );
    expect(pluginMark).not.toBeNull();
    expect(view.container.querySelector("[data-provider-logo]")).toBeNull();

    act(() => {
      removePluginSlotRegistrations("provider-codex");
    });
    expect(
      view.container.querySelector('[data-testid="plugin-codex-icon"]'),
    ).toBeNull();
    expect(view.container.querySelector("[data-provider-logo]")).not.toBeNull();
    view.unmount();
  });

  it("renders a plugin icon for a provider that has no vendored mark", () => {
    setPluginSlotRegistrations("provider-thing", {
      ...EMPTY_REGISTRATIONS,
      providerIcons: [
        { providerKind: "agent", providerId: "thing", icon: PluginCodexIcon },
      ],
    });
    const iconInfo = getProviderIconInfo("agent", "thing");
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
      providerIcons: [
        { providerKind: "agent", providerId: "codex", icon: PluginCodexIcon },
      ],
    });
    setPluginSlotRegistrations("provider-codex", {
      ...EMPTY_REGISTRATIONS,
      providerIcons: [
        {
          providerKind: "agent",
          providerId: "codex",
          icon: ({ className }: { className?: string }) => (
            <svg className={className} data-testid="second-icon" />
          ),
        },
      ],
    });
    const iconInfo = getProviderIconInfo("agent", "codex");
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

  it("uses the declared family for the generic mark, not the id prefix", () => {
    const byFamily = getProviderIconInfo("agent", "amp", {
      logoUrl: null,
      family: "acp",
    });
    if (byFamily === undefined) {
      throw new Error("Expected a family-based icon");
    }
    const familyView = render(createElement(byFamily.icon, {}));
    expect(familyView.container.querySelector("svg")).not.toBeNull();
    expect(byFamily.ariaLabel).toBe("ACP provider");
    familyView.unmount();

    expect(getProviderIconInfo("agent", "acp-unregistered")).toBeDefined();
  });
});
