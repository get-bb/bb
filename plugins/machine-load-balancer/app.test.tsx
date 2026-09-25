// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Machine,
  Overview,
  RunningThread,
  machineLoadBalancerRpcContract,
} from "./contract.js";

function thread(id: string, overrides: Partial<RunningThread> = {}): RunningThread {
  return {
    id,
    title: null,
    status: "active",
    providerId: "codex",
    providerName: "Codex",
    model: null,
    runningSince: Date.now() - 5 * 60_000,
    ...overrides,
  };
}

function machine(
  hostId: string,
  oneMinuteLoad: number,
  overrides: Partial<Machine> = {},
): Machine {
  return {
    hostId,
    name: hostId,
    isServer: false,
    availability: { kind: "available" },
    capacity: {
      kind: "known",
      capacity: { availableParallelism: 8, totalMemoryBytes: 64 * 1024 ** 3 },
    },
    load: {
      kind: "fresh",
      oneMinuteLoad,
      availableParallelism: 8,
      requestedAt: Date.now(),
    },
    providers: {
      kind: "reported",
      providers: [
        { providerId: "codex", displayName: "Codex", readiness: { kind: "ready" } },
        {
          providerId: "pi",
          displayName: "Pi",
          readiness: {
            kind: "not-ready",
            code: "provider-not-signed-in",
            label: "not signed in",
            reason: "Run pi login on this machine.",
          },
        },
      ],
    },
    runningThreads: [],
    ...overrides,
  };
}

function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    inspectedAt: Date.now(),
    machines: [
      machine("macbook-m2", 2, {
        runningThreads: [
          thread("thr_a", { title: "Build app", model: "gpt-5" }),
          thread("thr_b", { status: "starting" }),
        ],
      }),
      machine("server-host", 6, { isServer: true }),
      machine("omarchy", 10),
      machine("old", 0, {
        availability: {
          kind: "unavailable",
          code: "disconnected",
          reason: "Machine is disconnected.",
        },
        load: { kind: "unavailable", reason: "Machine is disconnected." },
        providers: { kind: "unavailable", reason: "Machine is disconnected." },
      }),
    ],
    nextPickHostId: "macbook-m2",
    pendingThreads: [thread("thr_pending", { title: "Queued", status: "starting" })],
    placement: { kind: "not-requested" },
    ...overrides,
  };
}

async function render(
  inspect: (input: unknown, options?: { signal?: AbortSignal }) => Promise<Overview>,
) {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot<object, typeof machineLoadBalancerRpcContract>(
    app.settingsSections[0]!,
    {},
    { rpc: { inspect } },
  );
  mounted.push(slot);
  return slot;
}

const mounted: { lifecycle: { unmount: () => void } }[] = [];

afterEach(() => {
  for (const slot of mounted.splice(0)) slot.lifecycle.unmount();
  vi.useRealTimers();
});

describe("Machines settings section", () => {
  it("describes what enabling the plugin does", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.settingsSections[0]?.description).toContain(
      "New threads without a chosen machine go to the least-loaded ready machine.",
    );
  });

  it("lists machines in ranked order with badges, capacity, load tone, and provider readiness", async () => {
    const slot = await render(async () => overview());
    const rows = await slot.findAllByRole("listitem", { name: /./u });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "macbook-m2",
      "server-host",
      "omarchy",
      "old",
    ]);
    const [first, server, busy, old] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    within(first).getByText("Next pick");
    expect(within(first).queryByText("server")).toBeNull();
    within(server).getByText("server");
    expect(within(server).queryByText("Next pick")).toBeNull();
    within(first).getByText("8 CPU · 64 GB");
    expect(
      [first, server, busy].map((row) =>
        within(row).getByRole("meter").getAttribute("data-tone"),
      ),
    ).toEqual(["low", "elevated", "high"]);
    within(first).getByText("0.25/CPU");
    within(first).getByLabelText("ready");
    within(first).getByText((_, element) => element?.textContent === "Pi ✗ not signed in");
    within(old).getByText("Machine is disconnected.");
    expect(within(old).queryByRole("meter")).toBeNull();
    expect(slot.getByText(/Observed \d+s ago/u).getAttribute("data-stale")).toBe("false");
    expect(slot.queryByText("Stale")).toBeNull();
    expect(slot.inspection.rpcCalls.map((call) => call.input)).toEqual([{ kind: "all" }]);
  });

  it("collapses running threads behind a count and links each thread without underlines", async () => {
    const slot = await render(async () => overview());
    const toggle = await slot.findByRole("button", { name: "2 running threads" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByRole("button", { name: "Build app" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const link = slot.getByRole("button", { name: "Build app" });
    expect(link.className).not.toContain("underline");
    const row = link.closest("li")!;
    within(row).getByText("Codex · gpt-5");
    within(row).getByText("active");
    within(row).getByText("5m");
    within(slot.getByRole("button", { name: "thr_b" }).closest("li")!).getByText("starting");
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thr_a" },
    ]);
    const pending = slot.getByRole("region", { name: "Pending placement" });
    within(pending).getByRole("button", { name: "Queued" });
  });

  it("marks observations older than the freshness window as stale", async () => {
    const slot = await render(async () =>
      overview({ inspectedAt: Date.now() - 45_000 }),
    );
    const observed = await slot.findByText("Observed 45s ago");
    expect(observed.getAttribute("data-stale")).toBe("true");
    slot.getByText("Stale");
  });

  it("keeps the last observation while refreshing and shows refresh errors", async () => {
    const pending: PromiseWithResolvers<Overview>[] = [];
    const slot = await render(() => {
      const next = Promise.withResolvers<Overview>();
      pending.push(next);
      return next.promise;
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    slot.getByText("Measuring machines…");
    await act(async () => pending[0]!.resolve(overview()));
    await slot.findByText("Next pick");
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(slot.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);
    await act(async () => pending[1]!.reject(new Error("host list failed")));
    await slot.findByText("host list failed");
    expect(slot.getAllByRole("listitem", { name: /./u })).toHaveLength(4);
  });

  it("re-inspects on an interval only while auto-refresh is on", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const slot = await render(async () => overview());
    await slot.findByText("Next pick");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(slot.inspection.rpcCalls).toHaveLength(1);
    fireEvent.click(slot.getByRole("switch", { name: "Auto-refresh" }));
    await act(async () => vi.advanceTimersByTime(15_000));
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(2));
    fireEvent.click(slot.getByRole("switch", { name: "Auto-refresh" }));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(slot.inspection.rpcCalls).toHaveLength(2);
  });

  it("aborts inspection when the section closes", async () => {
    let signal: AbortSignal | undefined;
    const slot = await render((_input, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    await waitFor(() => expect(signal).toBeDefined());
    slot.lifecycle.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
