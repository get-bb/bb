import { describe, expect, it } from "vitest";

import { CanonicalizeError, canonicalJson, contentHash } from "./canonical.js";

describe("canonicalJson", () => {
  it("sorts keys recursively while preserving arrays, null, and unknown fields", () => {
    expect(canonicalJson({
      z: 1,
      a: { z: null, omitted: undefined, a: 2 },
      list: [{ z: 3, a: 4 }, 2, 1],
      future_field: true,
    })).toBe('{"a":{"a":2,"z":null},"future_field":true,"list":[{"a":4,"z":3},2,1],"z":1}');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s with CanonicalizeError",
    (value) => {
      expect(() => canonicalJson({ nested: [value] })).toThrow(CanonicalizeError);
      try {
        canonicalJson({ nested: [value] });
      } catch (error) {
        expect(error).toMatchObject({ path: '$["nested"][0]' });
      }
    },
  );

  it("produces a stable SHA-256 hash for semantically identical key orders", () => {
    const first = contentHash({ z: [3, 2, 1], a: { b: true, a: null } });
    const second = contentHash({ a: { a: null, b: true }, z: [3, 2, 1] });

    expect(first).toBe(second);
    expect(first).toBe("e72fe59c8a89cf7de8dcafc794176faec7d762a2a326c49fb0c9bc5232f81e04");
  });
});
