// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import {
  keyedStoreContract,
  type KeyedStoreSubject,
} from "@bb/query-tags/testing";
import { afterEach, it, vi } from "vitest";
import { z } from "zod";
import {
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
} from "../../app.js";
import { defineRpcContract } from "../../rpc-contract.js";
import { renderSlot } from "../app.js";

afterEach(cleanup);

const contract = defineRpcContract({
  rows: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.number()),
    keyTags: (key) => [`row:${key}`],
  },
  save: {
    input: z.object({ key: z.string(), value: z.number() }),
    output: z.number(),
  },
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function pluginSubject(): KeyedStoreSubject {
  let rows: Record<string, number> = {};
  let held:
    | {
        rows: Readonly<Record<string, number>>;
        started: ReturnType<typeof deferred>;
        gate: ReturnType<typeof deferred>;
        done: ReturnType<typeof deferred>;
      }
    | undefined;
  const saves: ReturnType<typeof deferred>[] = [];
  let mutate!: (input: { key: string; value: number }) => Promise<number>;
  function Probe({ keys }: { keys: string[] }) {
    const query = experimental_useRpcKeyedQuery({
      contract,
      method: "rows",
      keys,
    });
    mutate = experimental_useRpcMutation({
      contract,
      method: "save",
      optimistic: (input, cache) =>
        cache.updateKey("rows", input.key, () => input.value),
    }).mutate;
    return (
      <>
        {keys.map((key) => (
          <output key={key} data-row={key}>
            {query.data?.[key]}
          </output>
        ))}
      </>
    );
  }
  let keys: string[] = [];
  let slot: ReturnType<typeof renderSlot> | undefined;
  const show = (next: string[]) => {
    keys = next;
    if (slot === undefined)
      slot = renderSlot<{ keys: string[] }, typeof contract>(
        { component: Probe },
        { keys },
        {
          experimental_rpcContract: contract,
          rpc: {
            rows: async ({ keys: requested }) => {
              const read = held;
              held = undefined;
              if (read !== undefined) {
                read.started.resolve();
                await read.gate.promise;
                read.done.resolve();
              }
              const source = read?.rows ?? rows;
              return Object.fromEntries(
                requested.map((key) => [key, source[key] ?? 0]),
              );
            },
            save: async ({ value }) => {
              const gate = deferred();
              saves.push(gate);
              await gate.promise;
              return value;
            },
          },
        },
      );
    else slot.rerender(<Probe keys={keys} />);
  };
  return {
    async load(loaded) {
      rows = { ...loaded };
      show(Object.keys(loaded));
      await vi.waitFor(() => {
        for (const [key, value] of Object.entries(loaded))
          if (this.visible(key) !== value) throw new Error(`loading ${key}`);
      });
    },
    visible(key) {
      const text = slot?.container.querySelector(
        `[data-row="${key}"]`,
      )?.textContent;
      return text ? Number(text) : undefined;
    },
    async read(next) {
      const read = {
        rows: next,
        started: deferred(),
        gate: deferred(),
        done: deferred(),
      };
      held = read;
      const added = Object.keys(next).filter((key) => !keys.includes(key));
      let refreshing: Promise<void> = Promise.resolve();
      await act(async () => {
        if (added.length > 0) show([...keys, ...added]);
        else
          refreshing = slot!.experimental_invalidateRpc(
            Object.keys(next).map((key) => `row:${key}`),
          );
      });
      await read.started.promise;
      return {
        async finish() {
          read.gate.resolve();
          await act(async () => {
            await read.done.promise;
            await refreshing;
          });
          await flush();
        },
      };
    },
    async write(key, value) {
      const count = saves.length;
      let mutation!: Promise<unknown>;
      await act(async () => {
        mutation = mutate({ key, value }).catch(() => undefined);
      });
      await vi.waitFor(() => {
        if (saves.length === count) throw new Error("save not started");
      });
      const gate = saves[count]!;
      const finish = async (settle: () => void) => {
        await act(async () => {
          settle();
          await mutation;
        });
        await flush();
      };
      return {
        accept: () => finish(() => gate.resolve()),
        reject: () => finish(() => gate.reject(new Error("rejected"))),
      };
    },
  };
}

it.each(keyedStoreContract)(
  "plugin keyed rows: $name",
  { timeout: 20_000 },
  async ({ run }) => {
    await run(pluginSubject());
  },
);
