import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import {
  buildMessageDirectiveRegistry,
  normalizeDirectiveAttributes,
  reconstructDirectiveSource,
} from "./markdown-message-directives";
import type { PluginMessageDirectiveSlot } from "@/lib/plugin-slots";

function DirectiveStub(_props: PluginMessageDirectiveProps) {
  return null;
}

function slot(
  overrides: Partial<PluginMessageDirectiveSlot> &
    Pick<PluginMessageDirectiveSlot, "id" | "pluginId">,
): PluginMessageDirectiveSlot {
  return {
    component: DirectiveStub,
    generation: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMessageDirectiveRegistry", () => {
  const settled = {
    bbPluginIds: new Set(["tasks"]),
    settled: true,
    settledOnce: true,
  };
  const claimants = [
    slot({ id: "task", pluginId: "tasks" }),
    slot({ id: "task", pluginId: "tasks-plus" }),
    slot({ id: "chart", pluginId: "alpha" }),
  ];

  it("gives a directive several plugins claim no automatic winner, bundled or not", () => {
    const registry = buildMessageDirectiveRegistry(claimants, {
      unclaimed: "literal",
      picks: {},
      boot: settled,
    });

    expect(registry.directives.get("task")).toEqual({
      status: "collision",
      pluginIds: ["tasks", "tasks-plus"],
    });
    expect(registry.directives.get("chart")?.status).toBe("ok");
  });

  it("renders the picked plugin, shows text for __builtin__, and holds an absent pick until plugins settle", () => {
    const picked = buildMessageDirectiveRegistry(claimants, {
      unclaimed: "literal",
      picks: { task: "tasks/task" },
      boot: settled,
    }).directives.get("task");
    expect(picked?.status === "ok" ? picked.slot.pluginId : null).toBe("tasks");

    expect(
      buildMessageDirectiveRegistry(claimants, {
        unclaimed: "literal",
        picks: { task: "__builtin__" },
        boot: settled,
      }).directives.get("task"),
    ).toEqual({ status: "literal" });

    expect(
      buildMessageDirectiveRegistry(claimants, {
        unclaimed: "hold",
        picks: { task: "scott-tasks/task" },
        boot: { ...settled, settled: false, settledOnce: false },
      }).directives.get("task"),
    ).toEqual({ status: "loading" });
  });
});

describe("normalizeDirectiveAttributes / reconstructDirectiveSource", () => {
  it("keeps only string attribute values", () => {
    expect(
      normalizeDirectiveAttributes({
        file: "demo.html",
        empty: "",
        dropped: null,
        alsoDropped: undefined,
      }),
    ).toEqual({ file: "demo.html", empty: "" });
  });

  it("reconstructs leaf directive source with JSON-quoted attributes", () => {
    expect(reconstructDirectiveSource("inline-vis", {})).toBe("::inline-vis");
    expect(
      reconstructDirectiveSource("inline-vis", { file: 'demo"x".html' }),
    ).toBe('::inline-vis{file="demo\\"x\\".html"}');
  });

  it("uses the supplied marker for text directives", () => {
    expect(reconstructDirectiveSource("30", {}, ":")).toBe(":30");
    expect(reconstructDirectiveSource("x", { a: "1" }, ":")).toBe(':x{a="1"}');
  });
});
