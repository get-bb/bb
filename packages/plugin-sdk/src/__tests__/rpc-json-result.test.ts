import { describe, expect, it } from "vitest";
import type { PluginRpcError } from "../rpc-contract.js";
import { normalizeRpcJsonResult } from "../internal/host-policy.js";

function fail(error: PluginRpcError): never {
  throw new Error(error.message);
}

describe("normalizeRpcJsonResult", () => {
  it("copies shared, non-cyclic values and sparse arrays", () => {
    const shared = { day: "2026-11-07", costUsd: 1.5 };
    const sparse: unknown[] = [];
    sparse[1] = "second";
    const value = { first: shared, second: [shared, null, true], sparse };

    const normalized = normalizeRpcJsonResult(value, fail);

    expect(normalized).toEqual(value);
    expect(normalized).not.toBe(value);
    expect(JSON.stringify(normalized)).toBe(JSON.stringify(value));
  });

  it.each([
    {
      name: "a non-finite number",
      value: { records: [{ costUsd: 1 }, { costUsd: Number.NaN }] },
      message:
        "rpc result at $result.records[1].costUsd contains a non-finite number",
    },
    {
      name: "a non-JSON value",
      value: { rows: [[1, undefined]] },
      message:
        "rpc result at $result.rows[0][1] is not a JSON value (undefined)",
    },
    {
      name: "a class instance",
      value: [{ at: new Date(0) }],
      message: "rpc result at $result[0].at must be a plain JSON object",
    },
    {
      name: "a symbol key",
      value: { meta: { [Symbol("hidden")]: 1 } },
      message: "rpc result at $result.meta contains a symbol key",
    },
  ])("names the path to $name", ({ value, message }) => {
    expect(() => normalizeRpcJsonResult(value, fail)).toThrow(message);
  });

  it("names the path where a cycle closes", () => {
    const node: { children: unknown[] } = { children: [] };
    node.children.push({ parent: node });

    expect(() => normalizeRpcJsonResult({ tree: node }, fail)).toThrow(
      "rpc result at $result.tree.children[0].parent is cyclic",
    );
  });
});
