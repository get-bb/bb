// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Icon } from "@bb/shared-ui/icon";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import {
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";

const ProviderIcon = pluginSdkAppImplementation.experimental_ProviderIcon;

function register(setup: (app: PluginAppBuilder) => void) {
  act(() =>
    setPluginSlotRegistrations(
      "acme",
      collectPluginAppRegistrations({ __bbPluginApp: true, setup }),
    ),
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

it("resolves slot, asset, registered glyph and fallback in order", () => {
  const view = render(
    <ProviderIcon
      provider={{
        id: "acme",
        logoUrl: "/mark.svg",
        icon: { glyph: "acme/mark" },
      }}
      fallback="Check"
      className="size-4"
      aria-label="Acme"
    />,
  );
  expect(view.getByRole("img", { name: "Acme" }).className).toContain("size-4");
  expect(
    view.container.querySelector('[data-provider-logo="/mark.svg"]'),
  ).not.toBeNull();
  register((app) => {
    app.experimental_icons.register({
      name: "acme/mark",
      component: () => <svg data-mark="glyph" />,
    });
    app.slots.experimental_providerIcon({
      providerId: "acme",
      icon: () => <Icon name="acme/mark" />,
    });
  });
  expect(view.container.querySelector('[data-mark="glyph"]')).not.toBeNull();
  expect(view.container.querySelector("[data-provider-logo]")).toBeNull();
  register((app) => {
    app.experimental_icons.register({
      name: "acme/mark",
      component: () => <svg data-mark="glyph" />,
    });
  });
  expect(view.container.querySelector("[data-provider-logo]")).not.toBeNull();
  view.rerender(
    <ProviderIcon
      provider={{ id: "acme", icon: { glyph: "acme/mark" } }}
      fallback="Check"
    />,
  );
  expect(view.container.querySelector('[data-mark="glyph"]')).not.toBeNull();
  act(() => removePluginSlotRegistrations("acme"));
  expect(view.container.querySelector('[data-icon="Check"]')).not.toBeNull();
});

it("accepts the environment provider string icon shape", () => {
  const view = render(
    <ProviderIcon provider={{ id: "worktree", icon: "Check" }} />,
  );
  expect(view.container.querySelector('[data-icon="Check"]')).not.toBeNull();
  expect(view.container.firstElementChild?.getAttribute("aria-hidden")).toBe(
    "true",
  );
});

it("remounts the same provider component on reload and restores fallback on unload", () => {
  let mounts = 0;
  function Mark() {
    const [generation] = useState(() => ++mounts);
    return <svg data-generation={generation} />;
  }
  const setup = (app: PluginAppBuilder) =>
    app.slots.experimental_providerIcon({ providerId: "env", icon: Mark });
  const view = render(<ProviderIcon provider={{ id: "env" }} />);
  expect(view.container.querySelector('[data-icon="Code"]')).not.toBeNull();
  register(setup);
  expect(view.container.querySelector('[data-generation="1"]')).not.toBeNull();
  register(setup);
  expect(view.container.querySelector('[data-generation="2"]')).not.toBeNull();
  act(() => removePluginSlotRegistrations("acme"));
  expect(view.container.querySelector('[data-icon="Code"]')).not.toBeNull();
});

it("contains throwing overrides and recovers after reload", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const view = render(
    <ProviderIcon provider={{ id: "acme", logoUrl: "/mark.svg" }} />,
  );
  register((app) =>
    app.slots.experimental_providerIcon({
      providerId: "acme",
      icon: () => {
        throw new Error("broken artwork");
      },
    }),
  );
  expect(view.container.querySelector("[data-provider-logo]")).not.toBeNull();
  register((app) =>
    app.slots.experimental_providerIcon({
      providerId: "acme",
      icon: () => <svg data-recovered="" />,
    }),
  );
  expect(view.container.querySelector("[data-recovered]")).not.toBeNull();
});

it("breaks recursive provider overrides at their declared artwork", () => {
  register((app) =>
    app.slots.experimental_providerIcon({
      providerId: "acme",
      icon: () => (
        <ProviderIcon provider={{ id: "acme", icon: { glyph: "Check" } }} />
      ),
    }),
  );
  const view = render(<ProviderIcon provider={{ id: "acme" }} />);
  expect(view.container.querySelector('[data-icon="Check"]')).not.toBeNull();
});

it("escapes asset URLs and applies only valid theme tints", () => {
  const view = render(
    <ProviderIcon
      provider={{
        id: "acme",
        logoUrl: '/mark".svg',
        strings: { iconTint: { light: "#123456", dark: "#abcdef" } },
      }}
      aria-label="Acme"
    />,
  );
  const mask = view.container.querySelector<HTMLElement>(
    "[data-provider-logo]",
  );
  expect(mask?.style.maskImage).toContain('\\"');
  expect(view.getByRole("img").style.color).toBe(
    "light-dark(rgb(18, 52, 86), rgb(171, 205, 239))",
  );
  view.rerender(
    <ProviderIcon
      provider={{
        id: "acme",
        strings: { iconTint: { light: "url(evil)", dark: "red" } },
      }}
      aria-label="Acme"
    />,
  );
  expect(view.getByRole("img").style.color).toBe("");
});
