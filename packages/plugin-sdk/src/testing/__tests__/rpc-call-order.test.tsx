// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  createRpcQueryHooks,
  type RpcQueryHost,
} from "../../internal/rpc-query-host.js";
import { rpcResponseTags } from "../../internal/rpc-tags.js";
import {
  defineRpcContract,
  experimental_PluginRpcCallError,
  experimental_PluginRpcRefusal,
  type PluginRpcContract,
} from "../../rpc-contract.js";

afterEach(() => {
  cleanup();
});

const contract = defineRpcContract({
  read: {
    input: z.object({ id: z.string() }),
    output: z.unknown(),
    tags: (input) => [`row:${input.id}`],
  },
  echo: {
    input: z.null(),
    output: z.unknown(),
  },
});

async function legacyCallRpc(
  host: RpcQueryHost,
  pluginId: string,
  contract: PluginRpcContract,
  method: string,
  input: JsonValue,
) {
  let raw: unknown;
  try {
    raw = await host.call(pluginId, method, input);
  } catch (error) {
    throw experimental_PluginRpcCallError.from(error);
  }
  const result = jsonValueSchema.safeParse(raw);
  if (!result.success)
    throw new experimental_PluginRpcCallError({
      code: "invalid_response",
      message: `Invalid RPC response for ${method}`,
    });
  const methodContract = contract[method];
  if (methodContract === undefined)
    throw new experimental_PluginRpcCallError({
      code: "unknown_method",
      message: `rpc method "${method}" isn't in the contract`,
    });
  const parsedInput = await methodContract.input["~standard"].validate(input);
  if (parsedInput.issues !== undefined)
    throw new experimental_PluginRpcCallError({
      code: "invalid_input",
      message: `rpc input validation failed for ${method}`,
    });
  return {
    result: result.data,
    ...rpcResponseTags(methodContract, parsedInput.value, result.data),
  };
}

type Outcome =
  | { ok: true; value: string }
  | { ok: false; name: string; code: string | undefined; message: string };

function describeError(error: unknown): Outcome {
  if (error instanceof Error) {
    return {
      ok: false,
      name: error.constructor.name,
      code:
        error instanceof experimental_PluginRpcCallError
          ? error.code
          : undefined,
      message: error.message,
    };
  }
  return { ok: false, name: typeof error, code: undefined, message: "" };
}

function spyHost(reply: () => unknown) {
  const call = vi.fn(
    async (_pluginId: string, _method: string, _input: JsonValue) => reply(),
  );
  const queryClient = new QueryClient();
  const host: RpcQueryHost = {
    pluginId: "demo",
    queryClient,
    subscribe: () => () => {},
    call,
  };
  return { host, call, queryClient };
}

async function runLegacy(
  reply: () => unknown,
  method: string,
  input: unknown,
): Promise<{ outcome: Outcome; calls: unknown[][] }> {
  const { host, call, queryClient } = spyHost(reply);
  try {
    const response = await legacyCallRpc(
      host,
      "demo",
      contract,
      method,
      input as JsonValue,
    );
    return {
      outcome: { ok: true, value: JSON.stringify(response.result) },
      calls: call.mock.calls,
    };
  } catch (error) {
    return { outcome: describeError(error), calls: call.mock.calls };
  } finally {
    queryClient.clear();
  }
}

async function runNew(
  reply: () => unknown,
  method: string,
  input: unknown,
): Promise<{ outcome: Outcome; calls: unknown[][] }> {
  const { host, call, queryClient } = spyHost(reply);
  const hooks = createRpcQueryHooks(() => host);
  const probe = renderHook(() =>
    hooks.experimental_useRpcMutation({
      contract,
      method: method as "read",
    }),
  );
  const mutate = probe.result.current.mutate as (
    input: unknown,
  ) => Promise<unknown>;
  let outcome: Outcome = { ok: false, name: "", code: undefined, message: "" };
  await act(async () => {
    outcome = await mutate(input).then(
      (value): Outcome => ({ ok: true, value: JSON.stringify(value) }),
      describeError,
    );
  });
  probe.unmount();
  queryClient.clear();
  return { outcome, calls: call.mock.calls };
}

describe("RPC calls check the method and input before reaching the host", () => {
  it("calls the host once and returns the same result for a valid call", async () => {
    const reply = () => ({ n: 1, rows: [{ id: "a" }] });
    const legacy = await runLegacy(reply, "read", { id: "a" });
    const current = await runNew(reply, "read", { id: "a" });
    expect(current.outcome).toEqual(legacy.outcome);
    expect(current.outcome).toEqual({
      ok: true,
      value: JSON.stringify({ n: 1, rows: [{ id: "a" }] }),
    });
    expect(current.calls).toEqual([["demo", "read", { id: "a" }]]);
    expect(legacy.calls).toEqual(current.calls);
  });

  it("refuses an unknown method without calling the host, where the legacy order called it first", async () => {
    const reply = () => ({ ok: true });
    const legacy = await runLegacy(reply, "missing", { id: "a" });
    const current = await runNew(reply, "missing", { id: "a" });
    expect(legacy.calls).toHaveLength(1);
    expect(current.calls).toHaveLength(0);
    expect(current.outcome).toEqual(legacy.outcome);
    expect(current.outcome).toMatchObject({
      ok: false,
      code: "unknown_method",
      message: `rpc method "missing" isn't in the contract`,
    });
  });

  it("refuses invalid input without calling the host, where the legacy order called it first", async () => {
    const reply = () => ({ ok: true });
    const legacy = await runLegacy(reply, "read", { id: 7 });
    const current = await runNew(reply, "read", { id: 7 });
    expect(legacy.calls).toHaveLength(1);
    expect(current.calls).toHaveLength(0);
    expect(current.outcome).toEqual(legacy.outcome);
    expect(current.outcome).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "rpc input validation failed for read",
    });
  });

  it("reports the caller's mistake, not the host's reply, when both are wrong", async () => {
    const badReply = () => Number.NaN;
    const unknownLegacy = await runLegacy(badReply, "missing", null);
    const unknownNew = await runNew(badReply, "missing", null);
    expect(unknownLegacy.outcome).toMatchObject({ code: "invalid_response" });
    expect(unknownNew.outcome).toMatchObject({ code: "unknown_method" });

    const inputLegacy = await runLegacy(badReply, "read", { id: 1 });
    const inputNew = await runNew(badReply, "read", { id: 1 });
    expect(inputLegacy.outcome).toMatchObject({ code: "invalid_response" });
    expect(inputNew.outcome).toMatchObject({ code: "invalid_input" });
  });

  it("does not reach the host when it would have failed anyway", async () => {
    const failing = () => {
      throw new Error("host is down");
    };
    const legacy = await runLegacy(failing, "read", { id: 1 });
    const current = await runNew(failing, "read", { id: 1 });
    expect(legacy.calls).toHaveLength(1);
    expect(current.calls).toHaveLength(0);
    expect(legacy.outcome).toMatchObject({ ok: false });
    expect(current.outcome).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "treats the inherited name %s as an unknown method without calling the host",
    async (name) => {
      const reply = () => ({ ok: true });
      const legacy = await runLegacy(reply, name, null);
      const current = await runNew(reply, name, null);
      expect(legacy.calls).toHaveLength(1);
      expect(legacy.outcome).toMatchObject({ ok: false, name: "TypeError" });
      expect(current.calls).toHaveLength(0);
      expect(current.outcome).toMatchObject({
        ok: false,
        code: "unknown_method",
        message: `rpc method "${name}" isn't in the contract`,
      });
    },
  );

  it("passes a host refusal through the same way", async () => {
    const refusing = () => {
      throw new experimental_PluginRpcRefusal({
        code: "conflict",
        message: "Changed elsewhere",
      });
    };
    const legacy = await runLegacy(refusing, "read", { id: "a" });
    const current = await runNew(refusing, "read", { id: "a" });
    expect(current.outcome).toEqual(legacy.outcome);
    expect(current.outcome).toMatchObject({ ok: false, code: "conflict" });
    expect(current.calls).toHaveLength(1);
  });

  it.each([
    ["NaN", () => Number.NaN],
    ["undefined", () => undefined],
    ["a Date", () => new Date(0)],
    ["a bigint", () => 1n],
    ["a nested NaN", () => ({ rows: [1, { bad: Number.POSITIVE_INFINITY }] })],
    ["a Map", () => new Map()],
  ])(
    "rejects %s from the host as an invalid response, as before",
    async (_label, reply) => {
      const legacy = await runLegacy(reply, "read", { id: "a" });
      const current = await runNew(reply, "read", { id: "a" });
      expect(current.outcome).toEqual(legacy.outcome);
      expect(current.outcome).toMatchObject({
        ok: false,
        code: "invalid_response",
        message: "Invalid RPC response for read",
      });
      expect(current.calls).toHaveLength(1);
    },
  );

  it("returns identical results for seeded random JSON replies", async () => {
    let seed = 0x1badf00d;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const generate = (depth: number): unknown => {
      const roll = random();
      if (depth === 0 || roll < 0.3) {
        const leaves: unknown[] = [
          "text",
          "",
          Math.floor(random() * 100),
          random(),
          true,
          false,
          null,
          random() < 0.5 ? Number.NaN : 1,
        ];
        return leaves[Math.floor(random() * leaves.length)];
      }
      if (roll < 0.6) {
        return Array.from({ length: Math.floor(random() * 4) }, () =>
          generate(depth - 1),
        );
      }
      return Object.fromEntries(
        Array.from({ length: Math.floor(random() * 4) }, (_, index) => [
          `k${index}`,
          generate(depth - 1),
        ]),
      );
    };
    let accepted = 0;
    let rejected = 0;
    for (let index = 0; index < 60; index++) {
      const start = seed;
      const first = generate(3);
      seed = start;
      const second = generate(3);
      const legacy = await runLegacy(() => first, "echo", null);
      const current = await runNew(() => second, "echo", null);
      expect(current.outcome).toEqual(legacy.outcome);
      if (current.outcome.ok) accepted += 1;
      else rejected += 1;
    }
    expect(accepted).toBeGreaterThan(10);
    expect(rejected).toBeGreaterThan(5);
  });
});
