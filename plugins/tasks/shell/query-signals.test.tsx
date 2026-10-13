// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useTasksQuery, type TaskSignal } from "./data.js";
import { TasksRefreshProvider } from "./refresh.js";

const TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";
const OTHER_TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT2";
const SIGNAL_SETTLE_MS = 120;

interface ProbeProps {
  fetcher: () => Promise<string>;
  relevantTaskIds?: readonly string[];
  applySignals?: (signals: readonly TaskSignal[]) => Promise<string>;
}

function Probe({ fetcher, relevantTaskIds, applySignals }: ProbeProps) {
  const query = useTasksQuery(() => fetcher(), ["tasks:changed"], [], {
    ...(relevantTaskIds === undefined ? {} : { relevantTaskIds }),
    ...(applySignals === undefined
      ? {}
      : {
          applySignals: (_rpc, _current, signals) => applySignals(signals),
        }),
  });
  return <output>{query.data ?? "loading"}</output>;
}

function ProbeSlot(props: ProbeProps) {
  return (
    <TasksRefreshProvider>
      <Probe {...props} />
    </TasksRefreshProvider>
  );
}

function settleSignals(): Promise<void> {
  return act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, SIGNAL_SETTLE_MS));
  });
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  setVisibility("visible");
});

describe("tasks query signal handling", () => {
  it("ignores signals about tasks the query does not depend on", async () => {
    let fetches = 0;
    const slot = renderSlot(
      { component: ProbeSlot },
      {
        fetcher: async () => `fetch ${++fetches}`,
        relevantTaskIds: [TASK_ID],
      },
    );
    await slot.findByText("fetch 1");

    for (let index = 0; index < 3; index += 1) {
      await slot.emitRealtime("tasks:changed", { taskId: OTHER_TASK_ID });
    }
    await settleSignals();
    expect(fetches).toBe(1);

    await slot.emitRealtime("tasks:changed", { taskId: TASK_ID });
    await slot.findByText("fetch 2");
    await slot.emitRealtime("tasks:changed", { projectId: "project-wide" });
    await slot.findByText("fetch 3");
  });

  it("queues one follow-up instead of stacking refetches on a fetch that is still running", async () => {
    let fetches = 0;
    const releases: Array<() => void> = [];
    const slot = renderSlot(
      { component: ProbeSlot },
      {
        fetcher: () => {
          const label = `fetch ${++fetches}`;
          return new Promise<string>((resolve) => {
            releases.push(() => resolve(label));
          });
        },
      },
    );
    await waitFor(() => expect(fetches).toBe(1));

    for (let index = 0; index < 3; index += 1) {
      await slot.emitRealtime("tasks:changed", { taskId: TASK_ID });
      await settleSignals();
    }
    expect(fetches).toBe(1);

    await act(async () => releases[0]?.());
    await waitFor(() => expect(fetches).toBe(2));
    await act(async () => releases[1]?.());
    await slot.findByText("fetch 2");
    await settleSignals();
    expect(fetches).toBe(2);
  });

  it("patches after a running fetch instead of refetching everything", async () => {
    let fetches = 0;
    let release: (() => void) | undefined;
    const patched: string[][] = [];
    const slot = renderSlot(
      { component: ProbeSlot },
      {
        fetcher: () => {
          fetches += 1;
          return new Promise<string>((resolve) => {
            release = () => resolve("fetched");
          });
        },
        applySignals: async (signals) => {
          patched.push(signals.map((signal) => signal.taskId ?? "none"));
          return "patched";
        },
      },
    );
    await waitFor(() => expect(fetches).toBe(1));

    await slot.emitRealtime("tasks:changed", { taskId: TASK_ID });
    await settleSignals();
    expect(fetches).toBe(1);
    expect(patched).toEqual([]);

    await act(async () => release?.());
    await slot.findByText("patched");
    expect(fetches).toBe(1);
    expect(patched).toEqual([[TASK_ID]]);
  });

  it("holds signals while the page is hidden and handles them once when it is visible again", async () => {
    let fetches = 0;
    const slot = renderSlot(
      { component: ProbeSlot },
      { fetcher: async () => `fetch ${++fetches}` },
    );
    await slot.findByText("fetch 1");

    act(() => setVisibility("hidden"));
    for (let index = 0; index < 4; index += 1) {
      await slot.emitRealtime("tasks:changed", { taskId: TASK_ID });
      await settleSignals();
    }
    expect(fetches).toBe(1);

    act(() => setVisibility("visible"));
    await slot.findByText("fetch 2");
    await settleSignals();
    expect(fetches).toBe(2);
  });
});
