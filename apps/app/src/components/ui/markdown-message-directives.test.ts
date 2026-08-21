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
  it("maps a unique directive id to its slot", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo" }),
    ]);
    expect(registry.get("inline-vis")).toEqual({
      status: "ok",
      slot: expect.objectContaining({
        id: "inline-vis",
        pluginId: "demo",
      }),
    });
  });

  it("records cross-plugin collisions with no winner and warns once", () => {
    const warn = vi.fn();
    const registry = buildMessageDirectiveRegistry(
      [
        slot({ id: "inline-vis", pluginId: "zeta" }),
        slot({ id: "inline-vis", pluginId: "alpha" }),
        slot({ id: "chart", pluginId: "alpha" }),
      ],
      { warn },
    );

    expect(registry.get("inline-vis")).toEqual({
      status: "collision",
      pluginIds: ["alpha", "zeta"],
    });
    expect(registry.get("chart")?.status).toBe("ok");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('message directive "inline-vis"');
    expect(warn.mock.calls[0]?.[0]).toContain("alpha");
    expect(warn.mock.calls[0]?.[0]).toContain("zeta");
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
