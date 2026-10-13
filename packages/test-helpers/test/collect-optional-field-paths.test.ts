import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectOptionalFieldPaths } from "../src/collect-optional-field-paths.js";

describe("collectOptionalFieldPaths", () => {
  it("reports an optional field inside an array element", () => {
    const rows = z.array(z.object({ id: z.string(), note: z.string().optional() }));

    expect(collectOptionalFieldPaths({ rows })).toEqual(["rows.note"]);
  });

  it("reports an optional field behind a lazy schema", () => {
    const node: z.ZodType<{ label?: string }> = z.lazy(() =>
      z.object({ label: z.string().optional() }),
    );

    expect(collectOptionalFieldPaths({ node })).toEqual(["node.label"]);
  });

  it("stops at a cycle instead of recursing forever", () => {
    interface Branch {
      note?: string;
      children: Branch[];
    }
    const branch: z.ZodType<Branch> = z.lazy(() =>
      z.object({
        note: z.string().optional(),
        children: z.array(branch),
      }),
    );

    expect(collectOptionalFieldPaths({ branch })).toEqual(["branch.note"]);
  });

  it("reports an optional field in an array nested under a union arm", () => {
    const response = z.object({
      items: z.array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("a"), tint: z.string().optional() }),
          z.object({ kind: z.literal("b"), badge: z.string().optional() }),
        ]),
      ),
    });

    expect(collectOptionalFieldPaths({ response })).toEqual([
      "response.items.badge",
      "response.items.tint",
    ]);
  });
});
