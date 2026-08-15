// @vitest-environment jsdom

import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("Tasks nav panel sidebar accessory", () => {
  it("renders the durable open count and refreshes it on task changes", async () => {
    let openTaskCount = 12;
    const Accessory = app.navPanels[0]?.experimental_sidebarAccessory;
    expect(Accessory).toBeTypeOf("function");

    const slot = renderSlot(
      { component: Accessory! },
      {},
      {
        rpc: {
          sidebarOpenTaskCount: () => ({ openTaskCount }),
        },
      },
    );

    expect(await slot.findByText("12")).toBeDefined();
    openTaskCount = 13;
    await slot.behavior.emitRealtime("tasks:changed", {
      taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });

    await waitFor(() => expect(slot.getByText("13")).toBeDefined());
    openTaskCount = 7;
    await slot.behavior.emitRealtime("projects:changed", {
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });
    await waitFor(() => expect(slot.getByText("7")).toBeDefined());
    expect(
      slot.inspection.rpcCalls.filter(
        ({ method }) => method === "sidebarOpenTaskCount",
      ),
    ).toHaveLength(3);
  });

  it("hides the count when there are no open tasks", async () => {
    let openTaskCount = 0;
    const Accessory = app.navPanels[0]?.experimental_sidebarAccessory;

    const slot = renderSlot(
      { component: Accessory! },
      {},
      {
        rpc: {
          sidebarOpenTaskCount: () => ({ openTaskCount }),
        },
      },
    );

    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          ({ method }) => method === "sidebarOpenTaskCount",
        ),
      ).toHaveLength(1),
    );
    expect(slot.queryByText("0")).toBeNull();

    openTaskCount = 1;
    await slot.behavior.emitRealtime("tasks:changed", {
      taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });
    expect(await slot.findByText("1")).toBeDefined();

    openTaskCount = 0;
    await slot.behavior.emitRealtime("tasks:changed", {
      taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });
    await waitFor(() => expect(slot.queryByText("1")).toBeNull());
    expect(slot.queryByText("0")).toBeNull();
  });

  it("coalesces a burst of task changes into one trailing count refresh", async () => {
    let calls = 0;
    let resolveFirstRequest:
      | ((result: { openTaskCount: number }) => void)
      | undefined;
    const firstRequest = new Promise<{ openTaskCount: number }>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const Accessory = app.navPanels[0]?.experimental_sidebarAccessory;

    const slot = renderSlot(
      { component: Accessory! },
      {},
      {
        rpc: {
          sidebarOpenTaskCount: () => {
            calls += 1;
            return calls === 1 ? firstRequest : { openTaskCount: 13 };
          },
        },
      },
    );

    await waitFor(() => expect(calls).toBe(1));
    await slot.behavior.emitRealtime("tasks:changed", {
      taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });
    await slot.behavior.emitRealtime("tasks:changed", {
      taskId: "01HZZZZZZZZZZZZZZZZZZZZZT2",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });
    await slot.behavior.emitRealtime("projects:changed", {
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    });
    expect(calls).toBe(1);

    await act(async () => {
      resolveFirstRequest?.({ openTaskCount: 12 });
      await firstRequest;
    });

    await waitFor(() => expect(calls).toBe(2));
    expect(await slot.findByText("13")).toBeDefined();
  });
});
