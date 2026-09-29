// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  experimental_useRpcInfiniteQuery,
  experimental_useRpcQuery,
} from "../app.js";
import { defineRpcContract } from "../rpc-contract.js";
import { renderSlot } from "../testing/app.js";

const contract = defineRpcContract({
  read: {
    input: z.object({ id: z.string() }),
    output: z.object({ value: z.string() }),
  },
  list: {
    input: z.object({ cursor: z.string().nullable() }),
    output: z.object({
      rows: z.array(z.string()),
      nextCursor: z.string().nullable(),
    }),
  },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Read({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const query = experimental_useRpcQuery<typeof contract, "read">({
    method: "read",
    input: { id },
    enabled,
    staleTime: Infinity,
    realtime: [{ channel: "changed", affects: (payload) => payload === id }],
  });
  return (
    <>
      <span>{query.data?.value ?? "loading"}</span>
      <button onClick={() => void query.refetch()}>refresh</button>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("plugin RPC queries", () => {
  it("shares reads, filters and coalesces signals, and reconciles after reconnect", async () => {
    let value = "first";
    const read = vi.fn(() => ({ value }));
    const view = renderSlot(
      {
        component: () => (
          <>
            <Read id="a" />
            <Read id="a" />
          </>
        ),
      },
      {},
      {
        rpc: { read },
      },
    );
    await waitFor(() => expect(view.getAllByText("first")).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(1);
    await view.emitRealtime("changed", "other");
    value = "second";
    await view.emitRealtime("changed", "a");
    await view.emitRealtime("changed", "a");
    await view.emitRealtime("changed", "a");
    await waitFor(() => expect(view.getAllByText("second")).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(2);
    await view.setRealtimeConnectionState("reconnecting");
    value = "third";
    await view.setRealtimeConnectionState("connected");
    await waitFor(() => expect(view.getAllByText("third")).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not lose an invalidation received during an outstanding read", async () => {
    const first = deferred<{ value: string }>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ value: "current" });
    const view = renderSlot(
      { component: Read },
      { id: "a" },
      { rpc: { read: (input) => read(contract.read.input.parse(input)) } },
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await view.emitRealtime("changed", "a");
    await new Promise((resolve) => setTimeout(resolve, 80));
    first.resolve({ value: "old" });
    await waitFor(() => expect(view.getByText("current")).toBeTruthy());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps disabled reads idle and prevents late results replacing a different input", async () => {
    const old = deferred<{ value: string }>();
    const read = vi.fn(({ id }: { id: string }) =>
      id === "old" ? old.promise : { value: id },
    );
    const view = renderSlot(
      { component: Read },
      { id: "old", enabled: false },
      { rpc: { read: (input) => read(contract.read.input.parse(input)) } },
    );
    fireEvent.click(view.getByRole("button", { name: "refresh" }));
    await view.emitRealtime("changed", "old");
    expect(read).not.toHaveBeenCalled();
    view.rerender(<Read id="old" />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    view.rerender(<Read id="new" />);
    await waitFor(() => expect(view.getByText("new")).toBeTruthy());
    old.resolve({ value: "obsolete" });
    await old.promise;
    expect(view.queryByText("obsolete")).toBeNull();
  });

  it("loads pages on demand and rebuilds fresh cursors after a signal", async () => {
    let revision = "a";
    const list = vi.fn(({ cursor }: { cursor: string | null }) => ({
      rows: [cursor === null ? `${revision}-first` : `${revision}-second`],
      nextCursor: cursor === null ? `${revision}-cursor` : null,
    }));
    function Pages() {
      const query = experimental_useRpcInfiniteQuery({
        contract,
        method: "list",
        input: { cursor: null },
        initialPageParam: null,
        getPageInput: (_input, cursor: string | null) => ({ cursor }),
        getNextPageParam: (page) => page.nextCursor,
        realtime: [{ channel: "changed" }],
      });
      return (
        <>
          <span>
            {query.data?.pages.flatMap((page) => page.rows).join(",")}
          </span>
          <button
            disabled={!query.hasNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            More
          </button>
        </>
      );
    }
    const view = renderSlot(
      { component: Pages },
      {},
      { rpc: { list: (input) => list(contract.list.input.parse(input)) } },
    );
    await waitFor(() => expect(view.getByText("a-first")).toBeTruthy());
    expect(list).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByText("More"));
    await waitFor(() =>
      expect(view.getByText("a-first,a-second")).toBeTruthy(),
    );
    expect(list).toHaveBeenLastCalledWith({ cursor: "a-cursor" });
    revision = "b";
    await view.emitRealtime("changed", null);
    await waitFor(() =>
      expect(view.getByText("b-first,b-second")).toBeTruthy(),
    );
    expect(list.mock.calls.slice(2)).toEqual([
      [{ cursor: null }],
      [{ cursor: "b-cursor" }],
    ]);
  });

  it("retains loaded rows when the next page fails and allows retry", async () => {
    let failing = true;
    function Pages() {
      const query = experimental_useRpcInfiniteQuery({
        contract,
        method: "list",
        input: { cursor: null },
        initialPageParam: null,
        getPageInput: (_input, cursor: string | null) => ({ cursor }),
        getNextPageParam: (page) => page.nextCursor,
      });
      return (
        <>
          <span>
            {query.data?.pages.flatMap((page) => page.rows).join(",")}
          </span>
          {query.isFetchNextPageError ? <span>Retry available</span> : null}
          <button onClick={() => void query.fetchNextPage()}>More</button>
        </>
      );
    }
    const view = renderSlot(
      { component: Pages },
      {},
      {
        rpc: {
          list: (input) => {
            const { cursor } = contract.list.input.parse(input);
            if (cursor !== null && failing) throw new Error("Unavailable");
            return {
              rows: [cursor === null ? "first" : "second"],
              nextCursor: cursor === null ? "next" : null,
            };
          },
        },
      },
    );
    await view.findByText("first");
    fireEvent.click(view.getByText("More"));
    await view.findByText("Retry available");
    expect(view.getByText("first")).toBeTruthy();
    failing = false;
    fireEvent.click(view.getByText("More"));
    await view.findByText("first,second");
  });

  it("keeps server-transformed output intact", async () => {
    const transformed = defineRpcContract({
      read: {
        input: z.null(),
        output: z.string().transform((value) => `parsed:${value}`),
      },
    });
    function ReadTransformed() {
      const query = experimental_useRpcQuery({
        contract: transformed,
        method: "read",
        input: null,
      });
      return <span>{query.data}</span>;
    }
    const view = renderSlot(
      { component: ReadTransformed },
      {},
      { rpc: { read: () => "parsed:server" } },
    );
    await view.findByText("parsed:server");
    expect(view.queryByText("parsed:parsed:server")).toBeNull();
  });
});
