import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  rpcInvalidationTags,
  rpcResponseTags,
  type ContractTagDeclarations,
} from "./rpc-tags.js";

const schemaBuilds = vi.hoisted(() => ({ array: 0, string: 0 }));

vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zod")>();
  const counted = {
    ...actual.z,
    array: ((...args: Parameters<typeof actual.z.array>) => {
      schemaBuilds.array += 1;
      return actual.z.array(...args);
    }) as typeof actual.z.array,
    string: ((...args: Parameters<typeof actual.z.string>) => {
      schemaBuilds.string += 1;
      return actual.z.string(...args);
    }) as typeof actual.z.string,
  };
  return { ...actual, z: counted };
});

function legacyRpcResponseTags<Input, Output>(
  declarations: ContractTagDeclarations<Input, Output>,
  input: Input,
  output: Output,
) {
  const tags = z
    .array(z.string().min(1))
    .parse(declarations.tags?.(input, output) ?? []);
  const keyTags: Record<string, string[]> = {};
  if (
    declarations.keyTags &&
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output)
  ) {
    for (const [key, value] of Object.entries(output)) {
      keyTags[key] = z
        .array(z.string().min(1))
        .parse(declarations.keyTags(key, value));
    }
  }
  const invalidated = z
    .array(z.string().min(1))
    .parse(declarations.invalidates?.(input, output) ?? []);
  return { tags, keyTags, invalidated };
}

type Outcome =
  | { ok: true; value: string }
  | { ok: false; name: string; message: string; issues: string };

function outcomeOf(run: () => unknown): Outcome {
  try {
    return { ok: true, value: JSON.stringify(run()) };
  } catch (error) {
    return {
      ok: false,
      name: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      issues: error instanceof z.ZodError ? JSON.stringify(error.issues) : "",
    };
  }
}

function recordingDeclarations(
  steps: string[],
  replies: {
    tags?: unknown;
    keyTags?: (key: string) => unknown;
    invalidates?: unknown;
  },
): ContractTagDeclarations<unknown, unknown> {
  return {
    tags: () => {
      steps.push("tags");
      return replies.tags as string[];
    },
    keyTags: (key) => {
      steps.push(`keyTags:${key}`);
      return replies.keyTags?.(key) as string[];
    },
    invalidates: () => {
      steps.push("invalidates");
      return replies.invalidates as string[];
    },
  };
}

const outputs: unknown[] = [
  null,
  "text",
  3,
  [],
  [{ a: 1 }],
  {},
  { a: 1 },
  { a: 1, b: { nested: true }, c: [1, 2], d: null },
  Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i])),
];

const replyCases: Array<[string, Parameters<typeof recordingDeclarations>[1]]> =
  [
    ["no tags at all", {}],
    ["empty lists", { tags: [], keyTags: () => [], invalidates: [] }],
    [
      "valid lists",
      {
        tags: ["a", "b:1"],
        keyTags: (key) => [`row:${key}`, "shared"],
        invalidates: ["x"],
      },
    ],
    ["an empty tag", { tags: ["a", ""] }],
    ["a non-string tag", { tags: ["a", 4] }],
    ["tags that are not a list", { tags: "a" }],
    ["tags that are null", { tags: null }],
    ["a bad key tag", { tags: ["ok"], keyTags: () => [""] }],
    [
      "a bad key tag on the second key only",
      { keyTags: (key) => (key === "b" ? [1] : ["ok"]) },
    ],
    ["key tags that are not a list", { keyTags: () => "row" }],
    ["key tags that are undefined", { keyTags: () => undefined }],
    ["a bad invalidation", { tags: ["ok"], invalidates: [null] }],
    ["invalidations that are not a list", { invalidates: { 0: "a" } }],
    ["a sparse list", { tags: [, "a"] }],
  ];

describe("rpcResponseTags against the legacy per-call schemas", () => {
  it.each(replyCases)(
    "gives the same tags, errors and callback order for %s",
    (_label, replies) => {
      for (const output of outputs) {
        const legacySteps: string[] = [];
        const newSteps: string[] = [];
        const legacy = outcomeOf(() =>
          legacyRpcResponseTags(
            recordingDeclarations(legacySteps, replies),
            { id: 1 },
            output,
          ),
        );
        const current = outcomeOf(() =>
          rpcResponseTags(
            recordingDeclarations(newSteps, replies),
            { id: 1 },
            output,
          ),
        );
        expect(current).toEqual(legacy);
        expect(newSteps).toEqual(legacySteps);
      }
    },
  );

  it("gives the same result when the declarations are partly or fully absent", () => {
    for (const output of outputs) {
      for (const declarations of [
        {},
        { tags: () => ["t"] },
        { keyTags: (key: string) => [key] },
        { invalidates: () => ["i"] },
      ] satisfies Array<ContractTagDeclarations<unknown, unknown>>) {
        expect(
          outcomeOf(() => rpcResponseTags(declarations, null, output)),
        ).toEqual(
          outcomeOf(() => legacyRpcResponseTags(declarations, null, output)),
        );
      }
    }
  });

  it("does not hand out a list another call can change", () => {
    const declarations: ContractTagDeclarations<unknown, unknown> = {
      tags: () => ["a"],
      keyTags: () => ["k"],
      invalidates: () => ["i"],
    };
    const first = rpcResponseTags(declarations, null, { row: 1 });
    first.tags.push("mutated");
    first.keyTags.row?.push("mutated");
    first.invalidated.push("mutated");
    expect(rpcResponseTags(declarations, null, { row: 1 })).toEqual({
      tags: ["a"],
      keyTags: { row: ["k"] },
      invalidated: ["i"],
    });
  });

  it("builds no schema for any call or key, where the legacy version built one each time", () => {
    const keys = 200;
    const output = Object.fromEntries(
      Array.from({ length: keys }, (_, i) => [`k${i}`, i]),
    );
    const declarations: ContractTagDeclarations<unknown, unknown> = {
      tags: () => ["t"],
      keyTags: (key) => [`row:${key}`],
      invalidates: () => ["i"],
    };

    schemaBuilds.array = 0;
    schemaBuilds.string = 0;
    legacyRpcResponseTags(declarations, null, output);
    expect(schemaBuilds.array).toBe(keys + 2);
    expect(schemaBuilds.string).toBe(keys + 2);

    schemaBuilds.array = 0;
    schemaBuilds.string = 0;
    rpcResponseTags(declarations, null, output);
    rpcResponseTags(declarations, null, output);
    rpcResponseTags({}, null, null);
    expect(schemaBuilds.array).toBe(0);
    expect(schemaBuilds.string).toBe(0);
  });
});

describe("rpcInvalidationTags", () => {
  it("still needs at least one non-empty tag", () => {
    expect(rpcInvalidationTags.parse(["a"])).toEqual(["a"]);
    expect(rpcInvalidationTags.safeParse([]).success).toBe(false);
    expect(rpcInvalidationTags.safeParse([""]).success).toBe(false);
    expect(rpcInvalidationTags.safeParse("a").success).toBe(false);
    expect(
      rpcResponseTags({ invalidates: () => [] }, null, null).invalidated,
    ).toEqual([]);
  });
});
