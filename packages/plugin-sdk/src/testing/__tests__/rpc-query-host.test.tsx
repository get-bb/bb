// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { memo, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  useRpc,
  experimental_useRpcKeyedQuery,
  experimental_useRpcQuery,
  experimental_useRpcMutation,
} from "../../app.js";
import {
  defineRpcContract,
  experimental_PluginRpcRefusal,
  experimental_PluginRpcCallError,
} from "../../rpc-contract.js";
import { renderSlot } from "../app.js";

afterEach(cleanup);

it("updates selected load state without rendering unchanged rows again", async () => {
  const rendered = vi.fn();
  const Rows = memo(({ values }: { values: Record<string, number> }) => {
    rendered();
    return (
      <p>
        {Object.entries(values)
          .map(([key, value]) => `${key}:${value}`)
          .join(",")}
      </p>
    );
  });
  const select = (rows: Record<string, number>) => ({
    values: Object.fromEntries(
      Object.entries(rows).filter(([, value]) => value > 0),
    ),
    loaded: Object.keys(rows).length,
  });
  function Probe({ keys }: { keys: string[] }) {
    const query = experimental_useRpcKeyedQuery({
      contract,
      method: "rows",
      keys,
      select,
    });
    return (
      <>
        <Rows values={query.data?.values ?? {}} />
        <output>{query.data?.loaded ?? 0} loaded</output>
      </>
    );
  }
  const contract = defineRpcContract({
    rows: {
      input: z.object({ keys: z.array(z.string()) }),
      output: z.record(z.string(), z.number()),
      keyTags: (key) => [key],
    },
  });
  let release!: (rows: Record<string, number>) => void;
  const next = new Promise<Record<string, number>>((resolve) => {
    release = resolve;
  });
  const slot = renderSlot<{ keys: string[] }, typeof contract>(
    { component: Probe },
    { keys: ["a"] },
    {
      experimental_rpcContract: contract,
      rpc: { rows: ({ keys }) => (keys.includes("b") ? next : { a: 1 }) },
    },
  );
  await slot.findByText("a:1");
  const count = rendered.mock.calls.length;
  slot.rerender(<Probe keys={["a", "b"]} />);
  expect(rendered).toHaveBeenCalledTimes(count);
  await act(async () => {
    release({ b: 0 });
  });
  await slot.findByText("2 loaded");
  expect(rendered).toHaveBeenCalledTimes(count);
});

it.each(["success", "write-failure", "read-failure", "refusal"] as const)(
  "shares plain and keyed optimistic updates through the public hook (%s)",
  { timeout: 20_000 },
  async (outcome) => {
    const contract = defineRpcContract({
      detail: {
        input: z.object({ id: z.string() }),
        output: z.number(),
        tags: () => ["row:a"],
      },
      rows: {
        input: z.object({ keys: z.array(z.string()) }),
        output: z.record(z.string(), z.number()),
        keyTags: (key) => [`row:${key}`],
      },
      save: {
        input: z.number(),
        output: z.number(),
        invalidates: () => ["row:a"],
      },
    });
    let release!: () => void;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    let server = 1;
    let offline = false;
    let holdReads = false;
    let releaseReads!: () => void;
    const reads = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const seen: number[] = [];
    function Reader({ name }: { name: string }) {
      const detail = experimental_useRpcQuery({
        contract,
        method: "detail",
        input: { id: "a" },
      });
      const rows = experimental_useRpcKeyedQuery({
        contract,
        method: "rows",
        keys: ["a"],
      });
      if (name === "one" && detail.data !== undefined) seen.push(detail.data);
      return (
        <>
          <output>
            {name}:{detail.data}/{rows.data?.a}
          </output>
          {name === "one" && detail.error && <p>{detail.error.message}</p>}
        </>
      );
    }
    function Probe() {
      const [acknowledged, setAcknowledged] = useState(false);
      const mutation = experimental_useRpcMutation({
        contract,
        method: "save",
        optimistic: (value, cache) => {
          cache.update("detail", { id: "a" }, () => value);
          cache.updateKey("rows", "a", () => value);
        },
      });
      return (
        <>
          <Reader name="one" />
          <Reader name="two" />
          <button
            onClick={() => {
              void mutation
                .mutate(2)
                .then(() => setAcknowledged(true))
                .catch((error: unknown) => {
                  expect(error).toBeInstanceOf(experimental_PluginRpcCallError);
                });
            }}
          >
            Save
          </button>
          <output>
            {acknowledged ? "acknowledged" : "waiting"}:
            {mutation.isPending ? "pending" : "idle"}:
            {mutation.pendingInputs.length}
          </output>
          {mutation.error && (
            <p data-code={mutation.error.code}>{mutation.error.message}</p>
          )}
        </>
      );
    }
    const slot = renderSlot<Record<string, never>, typeof contract>(
      { component: Probe },
      {},
      {
        experimental_rpcContract: contract,
        rpc: {
          detail: async () => {
            if (holdReads) await reads;
            if (offline) throw new Error("read offline");
            return server;
          },
          rows: async ({ keys }) => {
            if (holdReads) await reads;
            if (offline) throw new Error("read offline");
            return Object.fromEntries(keys.map((key) => [key, server]));
          },
          save: async () => {
            await write;
            if (outcome === "write-failure") throw new Error("write offline");
            if (outcome === "refusal")
              throw new experimental_PluginRpcRefusal({
                code: "conflict",
                message: "Changed elsewhere",
              });
            server = 3;
            holdReads = outcome === "success";
            offline = outcome === "read-failure";
            return server;
          },
        },
      },
    );
    await slot.findByText("one:1/1");
    seen.length = 0;
    fireEvent.click(slot.getByText("Save"));
    expect(slot.getByText("one:2/2")).toBeTruthy();
    expect(slot.getByText("two:2/2")).toBeTruthy();
    await slot.experimental_invalidateRpc(["row:a"]);
    expect(slot.getByText("one:2/2")).toBeTruthy();
    await act(async () => {
      release();
    });
    if (outcome === "success") {
      await slot.findByText("acknowledged:idle:0");
      expect(slot.getByText("one:2/2")).toBeTruthy();
      expect(slot.getByText("two:2/2")).toBeTruthy();
      await act(async () => {
        releaseReads();
      });
      await slot.findByText("one:3/3");
      expect(seen.every((value) => value === 2 || value === 3)).toBe(true);
      expect(slot.getByText("two:3/3")).toBeTruthy();
    } else if (outcome === "write-failure" || outcome === "refusal") {
      await slot.findByText(
        outcome === "refusal" ? "Changed elsewhere" : "write offline",
      );
      if (outcome === "refusal")
        expect(
          slot.getByText("Changed elsewhere").getAttribute("data-code"),
        ).toBe("conflict");
      expect(slot.getByText("one:1/1")).toBeTruthy();
      expect(slot.getByText("two:1/1")).toBeTruthy();
    } else {
      await slot.findByText("read offline", {}, { timeout: 10_000 });
      expect(slot.getByText("one:2/2")).toBeTruthy();
      expect(slot.getByText("two:2/2")).toBeTruthy();
      offline = false;
      await slot.experimental_invalidateRpc(["row:a"]);
      await slot.findByText("one:3/3");
      expect(slot.queryByText("read offline")).toBeNull();
    }
  },
);

it(
  "exposes refusal codes and issues through plain, keyed and imperative reads",
  { timeout: 20_000 },
  async () => {
    const contract = defineRpcContract({
      detail: { input: z.null(), output: z.number() },
      rows: {
        input: z.object({ keys: z.array(z.string()) }),
        output: z.record(z.string(), z.number()),
      },
    });
    function Probe() {
      const plain = experimental_useRpcQuery({
        contract,
        method: "detail",
        input: null,
      });
      const keyed = experimental_useRpcKeyedQuery({
        contract,
        method: "rows",
        keys: ["a"],
      });
      const rpc = useRpc();
      const [error, setError] =
        useState<experimental_PluginRpcCallError | null>(null);
      return (
        <>
          {[plain.error, keyed.error, error].map(
            (failure, index) =>
              failure && (
                <output key={index}>
                  {index}:{failure.code}:{failure.message}:
                  {failure.issues?.[0]?.message}:
                  {failure.issues?.[0]?.path?.join(".")}
                </output>
              ),
          )}
          <button
            onClick={() => {
              void rpc.call("detail").catch((failure: unknown) => {
                expect(failure).toBeInstanceOf(experimental_PluginRpcCallError);
                if (failure instanceof experimental_PluginRpcCallError)
                  setError(failure);
              });
            }}
          >
            Read
          </button>
        </>
      );
    }
    const refuse = () => {
      throw new experimental_PluginRpcRefusal({
        code: "not_found",
        message: "Gone",
        issues: [{ path: ["id"], message: "Missing" }],
      });
    };
    const slot = renderSlot(
      { component: Probe },
      {},
      { rpc: { detail: refuse, rows: refuse } },
    );
    fireEvent.click(slot.getByText("Read"));
    for (const index of [0, 1, 2]) {
      await slot.findByText(
        `${index}:not_found:Gone:Missing:id`,
        {},
        { timeout: 10_000 },
      );
    }
  },
);
