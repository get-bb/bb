import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { PluginRpcClient, PluginSdkApp } from "../app-contract.js";
import {
  defineRpcContract,
  type ExperimentalPluginRpcHandlersWithContext,
  type PluginRpcHandlers,
} from "../rpc-contract.js";

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

const contextHandlers: ExperimentalPluginRpcHandlersWithContext<
  typeof contract
> = {
  ...handlers,
  ping(_input, context) {
    expectTypeOf(context.experimental_caller).toEqualTypeOf<
      | { readonly kind: "plugin"; readonly pluginId: string }
      | { readonly kind: "client" }
    >();
    return { ok: true };
  },
};

function assertFrontendInference(
  client: PluginRpcClient<typeof contract>,
  app: PluginSdkApp,
) {
  expectTypeOf(client.call("lookup", { id: "issue-1" })).toEqualTypeOf<
    Promise<{ title: string; closed: boolean }>
  >();
  expectTypeOf(client.call("ping")).toEqualTypeOf<Promise<{ ok: true }>>();

  const declared = defineRpcContract({
    rows: {
      input: z.object({ keys: z.array(z.string()) }),
      output: z.record(z.string(), z.object({ title: z.string() })),
      keyTags: (key) => [`row:${key}`],
    },
    plain: { input: z.null(), output: z.number() },
    extra: {
      input: z.object({ keys: z.array(z.string()), required: z.boolean() }),
      output: z.record(z.string(), z.number()),
    },
  });
  const keyed = defineRpcContract({ ...declared });
  const plain = app.experimental_useRpcQuery({
    contract: keyed,
    method: "plain",
    input: null,
  });
  expectTypeOf(plain.data).toEqualTypeOf<number | undefined>();
  app.experimental_useRpcQuery({
    contract: keyed,
    method: "plain",
    // @ts-expect-error query input must match the chosen method.
    input: 42,
  });
  const mutation = app.experimental_useRpcMutation({
    contract: keyed,
    method: "plain",
    optimistic: (input) => {
      expectTypeOf(input).toEqualTypeOf<null>();
    },
  });
  expectTypeOf(mutation.mutate(null)).toEqualTypeOf<Promise<number>>();
  const selected = app.experimental_useRpcKeyedQuery({
    contract: keyed,
    method: "rows",
    keys: ["a"],
    select: (rows) => rows.a?.title.length ?? 0,
  });
  expectTypeOf(selected.data).toEqualTypeOf<number | undefined>();
  const rows = app.experimental_useRpcKeyedQuery({
    contract: keyed,
    method: "rows",
    keys: ["a"],
  });
  expectTypeOf(rows.data).toEqualTypeOf<
    Record<string, { title: string }> | undefined
  >();
  app.experimental_useRpcKeyedQuery({
    contract: keyed,
    // @ts-expect-error plain methods cannot be called through the keyed hook.
    method: "plain",
    keys: [],
  });
  app.experimental_useRpcKeyedQuery({
    contract: keyed,
    // @ts-expect-error unknown methods cannot be called through the keyed hook.
    method: "missing",
    keys: [],
  });
  app.experimental_useRpcKeyedQuery({
    contract: keyed,
    // @ts-expect-error the keyed hook cannot supply extra required input fields.
    method: "extra",
    keys: [],
  });
  defineRpcContract({
    bad: {
      input: z.null(),
      output: z.record(z.string(), z.number()),
      // @ts-expect-error keyed declarations require a keys array.
      keyTags: () => [],
    },
  });
  defineRpcContract({
    bad: {
      input: z.object({ keys: z.array(z.string()) }),
      output: z.number(),
      // @ts-expect-error keyed declarations require a record output.
      keyTags: () => [],
    },
  });
  defineRpcContract({
    bad: {
      input: z.object({ keys: z.array(z.string()) }),
      output: z.object({ value: z.number() }),
      // @ts-expect-error fixed object outputs cannot represent arbitrary requested keys.
      keyTags: () => [],
    },
  });
  defineRpcContract({
    retired: {
      input: z.null(),
      output: z.null(),
      // @ts-expect-error invalidates is retired from the public contract type.
      invalidates: () => ["item"],
    },
  });

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
    expect(
      contextHandlers.ping(null, {
        experimental_caller: { kind: "plugin", pluginId: "other" },
        experimental_signal: new AbortController().signal,
      }),
    ).toEqual({ ok: true });
  });
});
