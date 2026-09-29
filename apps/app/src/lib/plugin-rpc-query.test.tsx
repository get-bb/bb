// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { experimental_useRpcQuery } from "./plugin-sdk-hooks";

const contract = {
  read: { input: z.null(), output: z.object({ value: z.string() }) },
};

function Read() {
  const query = experimental_useRpcQuery({
    contract,
    method: "read",
    input: null,
  });
  return <span>{query.data?.value ?? "loading"}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("isolates identical methods and inputs owned by different plugins", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json({
        ok: true,
        result: { value: url.includes("/alpha/") ? "Alpha data" : "Beta data" },
      }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PluginSlotMount pluginId="alpha" slotKind="test" slotId="alpha">
        <Read />
      </PluginSlotMount>
      <PluginSlotMount pluginId="beta" slotKind="test" slotId="beta">
        <Read />
      </PluginSlotMount>
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(view.getByText("Alpha data")).toBeTruthy();
    expect(view.getByText("Beta data")).toBeTruthy();
  });
});

it("aborts the browser RPC request when its final observer unmounts", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      if (init.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PluginSlotMount pluginId="alpha" slotKind="test" slotId="alpha">
        <Read />
      </PluginSlotMount>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(signals).toHaveLength(1));
  expect(signals[0]?.aborted).toBe(false);
  view.unmount();
  expect(signals[0]?.aborted).toBe(true);
});

it("aborts expired reads and recovers without accepting their late response", async () => {
  let finishFirst!: (response: Response) => void;
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      if (init.signal) signals.push(init.signal);
      return signals.length === 1
        ? new Promise<Response>((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(
            Response.json({ ok: true, result: { value: "Recovered" } }),
          );
    }),
  );
  function ExpiringRead() {
    const query = experimental_useRpcQuery({
      contract,
      method: "read",
      input: null,
      timeoutMs: 30,
    });
    return (
      <>
        <span>{query.error?.message ?? query.data?.value ?? "loading"}</span>
        <button onClick={() => void query.refetch()}>Retry</button>
      </>
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PluginSlotMount pluginId="alpha" slotKind="test" slotId="alpha">
        <ExpiringRead />
      </PluginSlotMount>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.getByText(/timed out/)).toBeTruthy());
  expect(signals[0]?.aborted).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(view.getByText("Recovered")).toBeTruthy());
  finishFirst(Response.json({ ok: true, result: { value: "Expired" } }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(view.getByText("Recovered")).toBeTruthy();
  expect(view.queryByText("Expired")).toBeNull();
});
