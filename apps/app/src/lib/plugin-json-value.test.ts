import { describe, expect, it } from "vitest";
import {
  parsePersistedPluginPanelParams,
  serializePluginPanelParams,
} from "./plugin-json-value";

describe("plugin panel JSON boundaries", () => {
  it("round-trips recursive JSON values and preserves explicit null", () => {
    const value = {
      title: "Issue",
      flags: [true, false, null],
      nested: { count: 2 },
    };
    const serialized = serializePluginPanelParams(value);

    expect(parsePersistedPluginPanelParams(serialized)).toEqual(value);
    expect(parsePersistedPluginPanelParams("null")).toBeNull();
    expect(parsePersistedPluginPanelParams(null)).toBeNull();
  });

  it.each([
    ["object coercion", new Date("2026-01-01")],
    ["undefined property", { missing: undefined }],
    ["non-finite number", Number.POSITIVE_INFINITY],
  ])("rejects %s before persistence", (_name, value) => {
    expect(() => serializePluginPanelParams(value as never)).toThrow(
      '"params" must be a JSON value',
    );
  });

  it("narrows malformed or non-finite persisted values to null", () => {
    expect(parsePersistedPluginPanelParams("not json")).toBeNull();
    expect(parsePersistedPluginPanelParams("1e999")).toBeNull();
  });
});
