import { describe, expect, it } from "vitest";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import {
  AUTOMATIC_THREAD_LIST_PROVIDER,
  BUILT_IN_THREAD_LIST_PROVIDER,
  resolveThreadListProvider,
  threadListProviderKey,
} from "./threadListProvider";

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
    expect(
      resolveThreadListProvider(
        [first, slot("beta", "inbox")],
        AUTOMATIC_THREAD_LIST_PROVIDER,
      ),
    ).toBe(first);
  });

  it("lets the user keep BB's list", () => {
    expect(
      resolveThreadListProvider(
        [slot("alpha", "inbox")],
        BUILT_IN_THREAD_LIST_PROVIDER,
      ),
    ).toBeNull();
  });

  it("lets the user pin a specific provider", () => {
    const first = slot("alpha", "inbox");
    const second = slot("beta", "inbox");
    expect(
      resolveThreadListProvider([first, second], threadListProviderKey(second)),
    ).toBe(second);
  });

  it("uses BB while an explicitly selected provider is unavailable", () => {
    expect(resolveThreadListProvider([], "alpha/inbox")).toBeNull();
  });

  it("reveals the next replacement when the first is removed", () => {
    const first = slot("alpha", "inbox");
    const second = slot("beta", "inbox");
    expect(
      resolveThreadListProvider(
        [first, second],
        AUTOMATIC_THREAD_LIST_PROVIDER,
      ),
    ).toBe(first);
    expect(
      resolveThreadListProvider([second], AUTOMATIC_THREAD_LIST_PROVIDER),
    ).toBe(second);
  });
});
