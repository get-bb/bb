import { describe, expect, it } from "vitest";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  replacementProviderKey,
  resolvePreferredReplacement,
} from "./plugin-replacement-preference";

function slot(pluginId: string, id: string): PluginThreadListSlot {
  return {
    pluginId,
    id,
    generation: 1,
    title: `${pluginId} list`,
    component: () => null,
  };
}

function resolve(
  slots: readonly PluginThreadListSlot[],
  preference?: string,
): PluginThreadListSlot | null {
  const resolved = resolvePreferredReplacement(slots, preference);
  return resolved.kind === "plugin" ? resolved.registration : null;
}

describe("resolvePreferredReplacement", () => {
  it("uses the owner when no replacement is registered", () => {
    expect(resolve([])).toBeNull();
  });

  it("activates the first registered replacement", () => {
    const first = slot("alpha", "inbox");
    expect(
      resolve([first, slot("beta", "inbox")], AUTOMATIC_REPLACEMENT_PROVIDER),
    ).toBe(first);
  });

  it("lets the user keep BB's implementation", () => {
    expect(
      resolve([slot("alpha", "inbox")], BUILT_IN_REPLACEMENT_PROVIDER),
    ).toBeNull();
  });

  it("lets the user pin a specific provider", () => {
    const first = slot("alpha", "inbox");
    const second = slot("beta", "inbox");
    expect(resolve([first, second], replacementProviderKey(second))).toBe(
      second,
    );
  });

  it("uses the owner while an explicitly selected provider is unavailable", () => {
    expect(resolve([], "alpha/inbox")).toBeNull();
  });

  it("reveals the next replacement when the first is removed", () => {
    const first = slot("alpha", "inbox");
    const second = slot("beta", "inbox");
    expect(resolve([first, second], AUTOMATIC_REPLACEMENT_PROVIDER)).toBe(
      first,
    );
    expect(resolve([second], AUTOMATIC_REPLACEMENT_PROVIDER)).toBe(second);
  });
});
