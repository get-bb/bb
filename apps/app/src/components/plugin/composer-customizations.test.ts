import { describe, expect, it } from "vitest";
import type { PluginComposerCustomizationSlot } from "@/lib/plugin-slots";
import { resolveComposerCustomizations } from "@/lib/plugin-slot-resolvers";

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

describe("resolveComposerCustomizations", () => {
  it("preserves order and treats omitted scopes as all and empty scopes as none", () => {
    const all = customization("all");
    const thread = customization("thread", ["thread"]);
    const none = customization("none", []);
    const newThread = customization("new-thread", ["new-thread"]);

    expect(
      resolveComposerCustomizations([all, thread, none, newThread], "thread"),
    ).toEqual([all, thread]);
  });
});
