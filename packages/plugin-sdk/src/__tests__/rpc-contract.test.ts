import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { PluginRpcClient } from "../app-contract.js";
import { defineRpcContract, type PluginRpcHandlers } from "../rpc-contract.js";

const contract = defineRpcContract({
  lookup: {
    input: z.object({
      id: z.string(),
      includeClosed: z.boolean().default(false),
    }),
    output: z.object({ title: z.string(), closed: z.boolean() }),
  },
  ping: {
    input: z.null(),
    output: z.object({ ok: z.literal(true) }),
  },
});

const handlers: PluginRpcHandlers<typeof contract> = {
  lookup(input) {
    expectTypeOf(input).toEqualTypeOf<{
      id: string;
      includeClosed: boolean;
    }>();
    return { title: input.id, closed: input.includeClosed };
  },
  ping() {
    return { ok: true };
  },
};

function assertFrontendInference(client: PluginRpcClient<typeof contract>) {
  expectTypeOf(client.call("lookup", { id: "issue-1" })).toEqualTypeOf<
    Promise<{ title: string; closed: boolean }>
  >();
  expectTypeOf(client.call("ping")).toEqualTypeOf<Promise<{ ok: true }>>();

  // @ts-expect-error unknown methods are rejected from the shared contract.
  void client.call("missing", null);
  // @ts-expect-error lookup requires its exact object input.
  void client.call("lookup", { issueId: "issue-1" });
  // @ts-expect-error lookup is not a no-input method.
  void client.call("lookup");
}

describe("schema-driven rpc contract", () => {
  it("is an identity helper that preserves handler inference", () => {
    expect(Object.keys(contract)).toEqual(["lookup", "ping"]);
    expect(handlers.lookup({ id: "x", includeClosed: true })).toEqual({
      title: "x",
      closed: true,
    });
    expectTypeOf(assertFrontendInference).toBeFunction();
  });
});
