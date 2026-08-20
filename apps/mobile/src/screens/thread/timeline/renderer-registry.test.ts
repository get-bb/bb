import { describe, expect, it } from "vitest";
import { createTimelineRowRendererRegistry } from "./renderer-registry";

describe("createTimelineRowRendererRegistry", () => {
  it("falls back for unregistered kinds and lets a registration be undone", () => {
    const fallback = () => "fallback";
    const registry = createTimelineRowRendererRegistry<() => string>(fallback);
    expect(registry.get("system")).toBe(fallback);
    expect(registry.has("system")).toBe(false);

    const systemRow = () => "system";
    const unregister = registry.register("system", systemRow);
    expect(registry.get("system")).toBe(systemRow);
    expect(registry.get("turn")).toBe(fallback);
    expect(registry.registeredKinds()).toEqual(["system"]);

    unregister();
    expect(registry.get("system")).toBe(fallback);
    expect(registry.has("system")).toBe(false);
  });

  it("a stale unregister does not remove a newer registration for the same kind", () => {
    const registry = createTimelineRowRendererRegistry<() => string>(
      () => "fallback",
    );
    const first = () => "first";
    const second = () => "second";
    const unregisterFirst = registry.register("work:command", first);
    registry.register("work:command", second);
    unregisterFirst();
    expect(registry.get("work:command")).toBe(second);
  });
});
