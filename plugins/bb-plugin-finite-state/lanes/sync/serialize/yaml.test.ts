import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical.js";
import { SerializeError, emitYaml, parseYaml } from "./yaml.js";

describe("YAML serialization", () => {
  it("emits deterministic block YAML in identity, content, relation order", () => {
    const payload = {
      target_id: "component-b",
      nested: { z: 2, a: 1 },
      slug: "flow-a",
      description: "Telemetry flow",
      list: [{ z: 4, a: 3 }],
    };

    const first = emitYaml(payload);
    const second = emitYaml({ ...payload });

    expect(first).toBe(second);
    expect(first).toBe([
      "slug: flow-a",
      "description: Telemetry flow",
      "list:",
      "  - a: 3",
      "    z: 4",
      "nested:",
      "  a: 1",
      "  z: 2",
      "target_id: component-b",
      "",
    ].join("\n"));
    expect(canonicalJson(parseYaml(first, "flow-a.yaml"))).toBe(canonicalJson(payload));
  });

  it("wraps malformed YAML with file and line in SerializeError", () => {
    let thrown: unknown;
    try {
      parseYaml("slug: flow-a\nrelations: [one,\n", "flows/flow-a.yaml");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SerializeError);
    expect(thrown).toMatchObject({ file: "flows/flow-a.yaml", line: 3 });
  });

  it("never emits anchors or aliases for repeated objects", () => {
    const repeated = { evidence: "same" };
    const yaml = emitYaml({ first: repeated, second: repeated });

    expect(yaml).not.toMatch(/[&*][A-Za-z0-9_-]+/u);
    expect(parseYaml(yaml, "repeated.yaml")).toEqual({
      first: { evidence: "same" },
      second: { evidence: "same" },
    });
  });

  it("wraps a non-mapping document instead of leaking a library error", () => {
    expect(() => parseYaml("- one\n- two\n", "list.yaml")).toThrowError(SerializeError);
  });
});
