// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { projectTasksChangedTags, taskChangedTags } from "./shared/tags";

const app = await loadPluginApp(() => import("./app"));
const registeredBadge = app.navPanels[0]?.experimental_useBadge;
if (registeredBadge === undefined) {
  throw new Error("Tasks must register a badge");
}
const useBadge = registeredBadge;

function Badge() {
  const badge = useBadge();
  return badge === null ? null : (
    <span>
      {badge.count ?? "dot"}|{badge.label}
    </span>
  );
}

afterEach(cleanup);

const taskEdited = taskChangedTags({
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
});

describe("Tasks nav panel badge", () => {
  it("reports the durable open count and refreshes it on task changes", async () => {
    let openTaskCount = 12;

    const slot = renderSlot(
      { component: Badge },
      {},
      {
        rpc: {
          sidebarOpenTaskCount: () => ({ openTaskCount }),
        },
      },
    );

    expect(await slot.findByText("12|12 open tasks")).toBeDefined();
    openTaskCount = 13;
    await slot.behavior.experimental_invalidateRpc(taskEdited);

    await waitFor(() =>
      expect(slot.getByText("13|13 open tasks")).toBeDefined(),
    );
    openTaskCount = 7;
    await slot.behavior.experimental_invalidateRpc(
      projectTasksChangedTags("01HZZZZZZZZZZZZZZZZZZZZZP1"),
    );
    await waitFor(() => expect(slot.getByText("7|7 open tasks")).toBeDefined());
    expect(
      slot.inspection.rpcCalls.filter(
        ({ method }) => method === "sidebarOpenTaskCount",
      ),
    ).toHaveLength(3);
  });

  it("reports no badge when there are no open tasks", async () => {
    let openTaskCount = 0;

    const slot = renderSlot(
      { component: Badge },
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
    expect(slot.container.textContent).toBe("");

    openTaskCount = 1;
    await slot.behavior.experimental_invalidateRpc(taskEdited);
    expect(await slot.findByText("1|1 open task")).toBeDefined();

    openTaskCount = 0;
    await slot.behavior.experimental_invalidateRpc(taskEdited);
    await waitFor(() => expect(slot.container.textContent).toBe(""));
  });
});
