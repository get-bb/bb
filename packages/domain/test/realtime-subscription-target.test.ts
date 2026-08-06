import { describe, expect, it } from "vitest";
import {
  PLUGIN_REALTIME_CHANNEL_MAX_LENGTH,
  realtimeSubscriptionTargetKey,
  realtimeSubscriptionTargetSchema,
} from "../src/change-kinds.js";

describe("realtimeSubscriptionTargetSchema plugin-channel", () => {
  it("accepts exact plugin-channel targets within the channel bound", () => {
    const target = {
      kind: "plugin-channel" as const,
      pluginId: "linear",
      channel: "issues-updated",
    };
    expect(realtimeSubscriptionTargetSchema.parse(target)).toEqual(target);
    const maxChannel = realtimeSubscriptionTargetSchema.parse({
      kind: "plugin-channel",
      pluginId: "linear",
      channel: "x".repeat(PLUGIN_REALTIME_CHANNEL_MAX_LENGTH),
    });
    expect(maxChannel).toMatchObject({
      kind: "plugin-channel",
      channel: "x".repeat(PLUGIN_REALTIME_CHANNEL_MAX_LENGTH),
    });
  });

  it("rejects empty, oversized, and missing channel fields", () => {
    expect(
      realtimeSubscriptionTargetSchema.safeParse({
        kind: "plugin-channel",
        pluginId: "linear",
        channel: "",
      }).success,
    ).toBe(false);
    expect(
      realtimeSubscriptionTargetSchema.safeParse({
        kind: "plugin-channel",
        pluginId: "linear",
        channel: "x".repeat(PLUGIN_REALTIME_CHANNEL_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      realtimeSubscriptionTargetSchema.safeParse({
        kind: "plugin-channel",
        pluginId: "",
        channel: "x",
      }).success,
    ).toBe(false);
  });

  it("keys plugin-channel with a collision-proof JSON tuple", () => {
    const colonTrap = {
      kind: "plugin-channel" as const,
      pluginId: "a:b",
      channel: "c:d",
    };
    const slashTrap = {
      kind: "plugin-channel" as const,
      pluginId: "a",
      channel: "b:c",
    };
    const other = {
      kind: "plugin-channel" as const,
      pluginId: "a:b:c",
      channel: "d",
    };
    const keyColon = realtimeSubscriptionTargetKey(colonTrap);
    const keySlash = realtimeSubscriptionTargetKey(slashTrap);
    const keyOther = realtimeSubscriptionTargetKey(other);
    expect(keyColon).toBe(JSON.stringify(["plugin-channel", "a:b", "c:d"]));
    expect(keyColon).not.toBe(keySlash);
    expect(keyColon).not.toBe(keyOther);
    expect(keySlash).not.toBe(keyOther);
    // Distinct pairs never share a key even when delimiter concatenation would.
    expect(
      new Set([keyColon, keySlash, keyOther, "plugin-channel:a:b:c:d"]).size,
    ).toBe(4);
  });
});
