import { describe, expect, it } from "vitest";
import type { ExperimentalSidebarNavigationSlot } from "@/lib/plugin-slots";
import {
  RAIL_NAVIGATION_PROVIDER,
  resolveSidebarNavigation,
  TOP_LIST_NAVIGATION_PROVIDER,
  type ResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";

function slot(
  pluginId: string,
  placement: "rail" | "list",
): ExperimentalSidebarNavigationSlot {
  return {
    pluginId,
    id: "nav",
    title: pluginId,
    placement,
    component: () => null,
    generation: 1,
  };
}

function describeResolved(resolved: ResolvedSidebarNavigation): string {
  switch (resolved.kind) {
    case "built-in":
      return resolved.provider.key;
    case "plugin":
      return `${resolved.slot.pluginId}/${resolved.slot.id}`;
    case "loading":
      return `loading:${resolved.placement}`;
  }
}

const COMPACT = slot("compact", "list");
const SECTIONS = slot("sections", "rail");

describe("resolveSidebarNavigation", () => {
  it.each([
    {
      name: "uses a pinned built-in even with plugin providers installed",
      preference: TOP_LIST_NAVIGATION_PROVIDER,
      slots: [COMPACT],
      settled: true,
      lastResolved: null,
      expected: TOP_LIST_NAVIGATION_PROVIDER,
    },
    {
      name: "uses a pinned plugin provider",
      preference: "sections/nav",
      slots: [COMPACT, SECTIONS],
      settled: true,
      lastResolved: null,
      expected: "sections/nav",
    },
    {
      name: "picks the first plugin provider for Automatic",
      preference: "__automatic__",
      slots: [COMPACT, SECTIONS],
      settled: false,
      lastResolved: null,
      expected: "compact/nav",
    },
    {
      name: "falls back to the rail for Automatic without plugin providers",
      preference: "__automatic__",
      slots: [],
      settled: true,
      lastResolved: null,
      expected: RAIL_NAVIGATION_PROVIDER,
    },
    {
      name: "draws the rail at boot for Automatic when the rail was last resolved",
      preference: "__automatic__",
      slots: [],
      settled: false,
      lastResolved: { key: RAIL_NAVIGATION_PROVIDER, placement: "rail" },
      expected: RAIL_NAVIGATION_PROVIDER,
    },
    {
      name: "waits in the last placement for a pinned plugin that has not loaded",
      preference: "compact/nav",
      slots: [],
      settled: false,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: "loading:list",
    },
    {
      name: "waits in the last placement for the plugin Automatic last chose",
      preference: "__automatic__",
      slots: [],
      settled: false,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: "loading:list",
    },
    {
      name: "waits in the rail for a pinned plugin it has never drawn",
      preference: "compact/nav",
      slots: [],
      settled: false,
      lastResolved: null,
      expected: "loading:rail",
    },
    {
      name: "falls back like Automatic once a pinned plugin never registers",
      preference: "compact/nav",
      slots: [SECTIONS],
      settled: true,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: "sections/nav",
    },
    {
      name: "falls back to the rail once a pinned plugin never registers and none remain",
      preference: "compact/nav",
      slots: [],
      settled: true,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: RAIL_NAVIGATION_PROVIDER,
    },
  ] as const)("$name", ({ expected, ...input }) => {
    expect(describeResolved(resolveSidebarNavigation(input))).toBe(expected);
  });
});
