import { describe, expect, it } from "vitest";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { resolveThreadListProvider } from "./threadListProvider";

function slot(pluginId: string, id: string): PluginThreadListSlot {
  return {
    pluginId,
    id,
    generation: 1,
    title: `${pluginId} list`,
    component: () => null,
  };
}

describe("resolveThreadListProvider", () => {
  it("uses the built-in list when no replacement is registered", () => {
    expect(resolveThreadListProvider([])).toBeNull();
  });

  it("activates the first registered replacement", () => {
    const first = slot("alpha", "inbox");
    expect(resolveThreadListProvider([first, slot("beta", "inbox")])).toBe(
      first,
    );
  });

  it("reveals the next replacement when the first is removed", () => {
    const first = slot("alpha", "inbox");
    const second = slot("beta", "inbox");
    expect(resolveThreadListProvider([first, second])).toBe(first);
    expect(resolveThreadListProvider([second])).toBe(second);
  });
});
