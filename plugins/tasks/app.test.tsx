// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

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
          sidebarSummary: () => ({ openTaskCount, projects: [] }),
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
        ({ method }) => method === "sidebarSummary",
      ),
    ).toHaveLength(3);
  });
});
