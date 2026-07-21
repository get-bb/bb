import { describe, expect, it } from "vitest";
import type { PluginComposerCustomizationSlot } from "@/lib/plugin-slots";
import { composerCustomizationsForScope } from "./composer-customizations";

function customization(
  id: string,
  scopes?: PluginComposerCustomizationSlot["scopes"],
): PluginComposerCustomizationSlot {
  return {
    id,
    pluginId: "scope-test",
    generation: 1,
    ...(scopes === undefined ? {} : { scopes }),
  };
}

describe("composerCustomizationsForScope", () => {
  it("preserves order and treats omitted scopes as all and empty scopes as none", () => {
    const all = customization("all");
    const thread = customization("thread", ["thread"]);
    const none = customization("none", []);
    const newThread = customization("new-thread", ["new-thread"]);

    expect(
      composerCustomizationsForScope([all, thread, none, newThread], "thread"),
    ).toEqual([all, thread]);
  });
});
