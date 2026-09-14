import { describe, expect, it } from "vitest";
import {
  PLUGIN_METADATA_MAX_BYTES,
  deepFreezePluginMetadata,
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

  it("rejects cycles, custom prototypes, and array subclasses", () => {
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
    expect(() => validatePluginMetadata({ missing: undefined })).toThrow();
    expect(() => validatePluginMetadata({ value: Number.NaN })).toThrow();
  });

  it("keeps toJSON keys as ordinary data", () => {
    expect(
      validatePluginMetadata({ toJSON: 1, nested: { toJSON: "x" } }),
    ).toEqual({ toJSON: 1, nested: { toJSON: "x" } });
  });

  it("rejects an accessor that yields a function during validation", () => {
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "toJSON", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? "first" : () => "hook";
      },
    });
    expect(() => validatePluginMetadata(accessor)).toThrow();
  });

  it("enforces normalized UTF-8 bytes", () => {
    const overhead = new TextEncoder().encode(
      JSON.stringify({ value: "" }),
    ).byteLength;
    const prefix = "a".repeat(PLUGIN_METADATA_MAX_BYTES - overhead - 4);
    const exact = { value: `${prefix}😀` };
    expect(pluginMetadataSchema.safeParse(exact).success).toBe(true);
    expect(() => validatePluginMetadata({ value: `${prefix}😀x` })).toThrow(
      /256 KiB/,
    );
  });

  it("parses persisted objects and rejects non-object rows", () => {
    expect(parsePersistedPluginMetadata('{"ok":true}')).toEqual({ ok: true });
    expect(parsePersistedPluginMetadata("null")).toBeUndefined();
    expect(parsePersistedPluginMetadata("[1]")).toBeUndefined();
    expect(parsePersistedPluginMetadata("not-json")).toBeUndefined();
  });

  it("deep-freezes nested objects and arrays", () => {
    const metadata = deepFreezePluginMetadata({
      level1: { level2: { items: [{ level4: true }] } },
    });
    const level2 = (metadata.level1 as { level2: { items: object[] } }).level2;
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.level1)).toBe(true);
    expect(Object.isFrozen(level2)).toBe(true);
    expect(Object.isFrozen(level2.items)).toBe(true);
    expect(Object.isFrozen(level2.items[0])).toBe(true);
  });
});
