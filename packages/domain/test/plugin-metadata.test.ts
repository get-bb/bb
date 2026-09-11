import { describe, expect, it } from "vitest";
import {
  PLUGIN_METADATA_MAX_BYTES,
  parsePersistedPluginMetadata,
  pluginMetadataSchema,
  validatePluginMetadata,
} from "../src/plugin-metadata.js";

describe("plugin metadata", () => {
  it("requires a plain object and deep-clones input", () => {
    const input = { nested: { count: 1 } };
    const result = validatePluginMetadata(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.nested).not.toBe(input.nested);
    expect(() => validatePluginMetadata(null)).toThrow();
    expect(() => validatePluginMetadata("value")).toThrow();
    expect(() => validatePluginMetadata(["value"])).toThrow();
  });

  it("rejects cycles, custom prototypes, array subclasses, and own toJSON hooks", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validatePluginMetadata(cyclic)).toThrow(/cycle/);
    expect(() => validatePluginMetadata({ date: new Date() })).toThrow(
      /plain JSON/,
    );
    expect(() => validatePluginMetadata(Object.create(null))).toThrow(
      /plain JSON/,
    );
    class CustomArray extends Array<unknown> {}
    expect(() => validatePluginMetadata({ values: new CustomArray() })).toThrow(
      /plain JSON/,
    );
    expect(() => validatePluginMetadata({ toJSON: "not-a-hook" })).toThrow(
      /plain JSON/,
    );
    const accessor = {};
    Object.defineProperty(accessor, "toJSON", { get: () => undefined });
    expect(() => validatePluginMetadata(accessor)).toThrow(/plain JSON/);
  });

  it("enforces normalized UTF-8 bytes", () => {
    const overhead = new TextEncoder().encode(JSON.stringify({ value: "" })).byteLength;
    const prefix = "a".repeat(PLUGIN_METADATA_MAX_BYTES - overhead - 4);
    const exact = { value: `${prefix}😀` };
    expect(pluginMetadataSchema.safeParse(exact).success).toBe(true);
    expect(() => validatePluginMetadata({ value: `${prefix}😀x` })).toThrow(/256 KiB/);
  });

  it("parses persisted objects and rejects invalid values", () => {
    expect(parsePersistedPluginMetadata('{"ok":true}')).toEqual({ ok: true });
    expect(parsePersistedPluginMetadata("null")).toBeUndefined();
    expect(parsePersistedPluginMetadata("not-json")).toBeUndefined();
  });
});
