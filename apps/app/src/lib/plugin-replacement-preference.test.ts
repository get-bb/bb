import { describe, expect, it } from "vitest";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  NO_AUTOMATIC_RULE,
  PLUGIN_ONLY_RULE,
  REPLACEMENT_RULE,
  replacementProviderKey,
  resolveExclusive,
  type ExclusiveResolveInput,
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

const BUNDLED = slot("thread-list", "thread-list");
const COMMUNITY = slot("zen", "list");

function resolve(
  overrides: Partial<ExclusiveResolveInput<PluginThreadListSlot>>,
) {
  return resolveExclusive({
    claimants: [BUNDLED, COMMUNITY],
    pick: AUTOMATIC_REPLACEMENT_PROVIDER,
    bbPluginIds: new Set(["thread-list"]),
    settledOnce: true,
    rememberedAutomatic: null,
    rule: REPLACEMENT_RULE,
    ...overrides,
  });
}

describe("resolveExclusive", () => {
  it("prefers an installed claimant over a bundled one regardless of plugin order, and offers the bundled one for crashes", () => {
    expect(resolve({})).toEqual({
      kind: "plugin",
      registration: COMMUNITY,
      fallback: BUNDLED,
    });
    expect(resolve({ claimants: [BUNDLED] })).toEqual({
      kind: "plugin",
      registration: BUNDLED,
      fallback: null,
    });
    expect(resolve({ claimants: [] })).toEqual({ kind: "builtin" });
  });

  it("uses a present pick, including a bundled claimant, through the same path", () => {
    expect(resolve({ pick: replacementProviderKey(BUNDLED) })).toMatchObject({
      registration: BUNDLED,
    });
  });

  it("uses core's own for __builtin__ only where core has its own", () => {
    expect(resolve({ pick: BUILT_IN_REPLACEMENT_PROVIDER })).toEqual({
      kind: "builtin",
    });
    expect(
      resolve({ pick: BUILT_IN_REPLACEMENT_PROVIDER, rule: PLUGIN_ONLY_RULE }),
    ).toMatchObject({ kind: "plugin", registration: COMMUNITY });
  });

  it("waits for an absent pick until plugins first settle, then falls back to Automatic", () => {
    expect(resolve({ pick: "gone/list", settledOnce: false })).toEqual({
      kind: "loading",
    });
    expect(resolve({ pick: "gone/list" })).toMatchObject({
      registration: COMMUNITY,
    });
  });

  it("waits for the remembered Automatic winner only during boot, not when a later plugin reload runs after the winner changed", () => {
    const rememberedAutomatic = replacementProviderKey(COMMUNITY);
    expect(
      resolve({
        claimants: [BUNDLED],
        settledOnce: false,
        rememberedAutomatic,
      }),
    ).toEqual({ kind: "loading" });
    expect(resolve({ settledOnce: false, rememberedAutomatic })).toMatchObject({
      registration: COMMUNITY,
    });
    expect(
      resolve({ claimants: [BUNDLED], rememberedAutomatic }),
    ).toMatchObject({ kind: "plugin", registration: BUNDLED });
  });

  it("names no Automatic winner when several claim a no-automatic key", () => {
    expect(resolve({ rule: NO_AUTOMATIC_RULE })).toEqual({
      kind: "contested",
      claimants: [BUNDLED, COMMUNITY],
    });
    expect(
      resolve({ rule: NO_AUTOMATIC_RULE, claimants: [COMMUNITY] }),
    ).toMatchObject({ registration: COMMUNITY });
    expect(
      resolve({
        rule: NO_AUTOMATIC_RULE,
        pick: replacementProviderKey(BUNDLED),
      }),
    ).toMatchObject({ registration: BUNDLED });
  });
});
