import { describe, expect, it } from "vitest";
import type { ExperimentalSidebarNavigationSlot } from "@/lib/plugin-slots";
import {
  resolveSidebarNavigation,
  type ResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";

function slot(
  pluginId: string,
  id: string,
  placement: "rail" | "list",
): ExperimentalSidebarNavigationSlot {
  return {
    pluginId,
    id,
    title: `${pluginId}/${id}`,
    placement,
    component: () => null,
    generation: 1,
  };
}

function describeResolved(resolved: ResolvedSidebarNavigation): string {
  switch (resolved.kind) {
    case "plugin":
      return resolved.fallback === null
        ? resolved.slot.title
        : `${resolved.slot.title} over ${resolved.fallback.title}`;
    case "loading":
      return `loading:${resolved.placement}`;
    case "failed":
      return "failed";
    case "missing":
      return "missing";
  }
}

const RAIL = slot("navigation", "rail", "rail");
const TOP_LIST = slot("navigation", "top-list", "list");
const COMPACT = slot("compact", "nav", "list");
const SECTIONS = slot("sections", "nav", "rail");

describe("resolveSidebarNavigation", () => {
  it.each([
    {
      name: "uses a pinned bundled layout even with other providers installed",
      preference: "navigation/top-list",
      slots: [RAIL, TOP_LIST, COMPACT],
      settled: true,
      lastResolved: null,
      expected: "navigation/top-list",
    },
    {
      name: "uses a pinned plugin provider over the bundled one for its placement",
      preference: "sections/nav",
      slots: [RAIL, TOP_LIST, COMPACT, SECTIONS],
      settled: true,
      lastResolved: null,
      expected: "sections/nav over navigation/rail",
    },
    {
      name: "picks the first non-bundled provider for Automatic",
      preference: "__automatic__",
      slots: [RAIL, TOP_LIST, COMPACT, SECTIONS],
      settled: true,
      lastResolved: null,
      expected: "compact/nav over navigation/top-list",
    },
    {
      name: "draws the bundled Rail at boot when Automatic last resolved to it",
      preference: "__automatic__",
      slots: [RAIL, TOP_LIST],
      settled: false,
      lastResolved: { key: "navigation/rail", placement: "rail" },
      expected: "navigation/rail",
    },
    {
      name: "waits in the last placement for the plugin Automatic last chose",
      preference: "__automatic__",
      slots: [RAIL, TOP_LIST],
      settled: false,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: "loading:list",
    },
    {
      name: "waits in the last placement for a pinned provider that has not loaded",
      preference: "navigation/top-list",
      slots: [],
      settled: false,
      lastResolved: { key: "navigation/top-list", placement: "list" },
      expected: "loading:list",
    },
    {
      name: "waits in the rail for a pinned provider it has never drawn",
      preference: "compact/nav",
      slots: [RAIL],
      settled: false,
      lastResolved: null,
      expected: "loading:rail",
    },
    {
      name: "waits in the rail for Automatic before any provider registers",
      preference: "__automatic__",
      slots: [],
      settled: false,
      lastResolved: null,
      expected: "loading:rail",
    },
    {
      name: "falls back like Automatic once a pinned provider never registers",
      preference: "compact/nav",
      slots: [RAIL, TOP_LIST, SECTIONS],
      settled: true,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: "sections/nav over navigation/rail",
    },
    {
      name: "falls back to the bundled Rail once a pinned provider never registers",
      preference: "compact/nav",
      slots: [RAIL, TOP_LIST],
      settled: true,
      lastResolved: { key: "compact/nav", placement: "list" },
      expected: "navigation/rail",
    },
    {
      name: "uses the remaining provider when the bundled plugin is disabled",
      preference: "navigation/rail",
      slots: [COMPACT],
      settled: true,
      lastResolved: null,
      expected: "compact/nav",
    },
    {
      name: "reports no navigation once frontends settle without any provider",
      preference: "__automatic__",
      slots: [],
      settled: true,
      lastResolved: { key: "navigation/rail", placement: "rail" },
      expected: "missing",
    },
    {
      name: "reports a failed load instead of no navigation when a plugin frontend failed to load",
      preference: "__automatic__",
      slots: [],
      settled: true,
      loadFailed: true,
      lastResolved: { key: "navigation/rail", placement: "rail" },
      expected: "failed",
    },
  ] as const)("$name", ({ expected, ...input }) => {
    expect(
      describeResolved(
        resolveSidebarNavigation({
          loadFailed: false,
          ...input,
          builtinPluginIds: new Set(["navigation"]),
        }),
      ),
    ).toBe(expected);
  });
});
