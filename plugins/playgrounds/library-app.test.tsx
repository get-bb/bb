// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, expect, it } from "vitest";
import { stepper } from "./examples.js";
import { writeIntent } from "./library-app.js";

const runId = "e85d6718-895b-48e5-8bc4-2a9bd3477895";
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

it("opens the app panel once the destination thread mounts, and keeps a manual action when the host declines", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const header = app.threadHeaderActions.find((a) => a.id === "open-app")!;
  const rpc = {
    get: ({ id }: { id: string }) => ({
      id,
      threadId: "thr_b",
      kind: "html" as const,
      widget: stepper,
    }),
  };
  writeIntent({ threadId: "thr_b", runId, title: "Synth v1" });
  const other = renderSlot(
    header,
    { threadId: "thr_a", projectId: "p", isCompactViewport: false },
    { rpc },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(other.inspection.navigateCalls).toEqual([]);
  other.lifecycle.unmount();

  let accept = false;
  const view = renderSlot(
    header,
    { threadId: "thr_b", projectId: "p", isCompactViewport: false },
    { rpc, openThreadPanel: () => accept },
  );
  const button = await view.findByRole("button", { name: "Open app" });
  expect(view.inspection.navigateCalls).toEqual([
    {
      method: "openThreadPanel",
      options: { actionId: "app", params: { runId }, title: "Synth v1" },
    },
  ]);
  expect(sessionStorage.length).toBe(0);
  accept = true;
  fireEvent.click(button);
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Open app" })).toBeNull(),
  );
  expect(view.inspection.navigateCalls).toHaveLength(2);
});

it("saves a card as an app from the host wrapper, outside the sandboxed frame", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const saves: unknown[] = [];
  const view = renderSlot(
    app.messageDirectives[0]!,
    {
      attributes: { id: runId },
      source: "",
      message: {
        id: "msg_1",
        threadId: "thr_a",
        turnId: null,
        projectId: null,
      },
      openWorkspaceFile: null,
    },
    {
      rpc: {
        get: () => ({
          id: runId,
          threadId: "thr_a",
          kind: "html" as const,
          widget: stepper,
        }),
        getState: () => ({ state: null, version: 0 }),
        presence: () => ({ ok: true as const }),
        appsSave: (input: unknown) => {
          saves.push(input);
          return {
            appId: "6b0f5f8e-0d43-4c55-a6b8-3c1a9f6f7f10",
            versionId: "x",
            versionLabel: "1",
            requestId: "r",
          };
        },
      },
    },
  );
  fireEvent.click(await view.findByRole("button", { name: "Save as app" }));
  fireEvent.change(view.getByLabelText("App name"), {
    target: { value: "Repotting" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await view.findByText(/Saved to My apps/);
  expect(saves).toEqual([
    { answerId: runId, threadId: "thr_a", name: "Repotting", description: "" },
  ]);
  fireEvent.click(view.getByRole("button", { name: "View in Apps" }));
  expect(view.inspection.navigateCalls.at(-1)).toEqual({
    method: "toPluginPanel",
    path: "apps",
    options: { subPath: "app/6b0f5f8e-0d43-4c55-a6b8-3c1a9f6f7f10" },
  });
});
