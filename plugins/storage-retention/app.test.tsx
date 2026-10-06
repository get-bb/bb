// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster, toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import { policySchema, storageRpc } from "./src/contract.js";
import { makeSystemConfig } from "../../apps/app/src/test/fixtures/system-config.js";
import type { State } from "./src/contract.js";
import type { HostStorageListResponse } from "./src/storage-types.js";

const app = await loadPluginApp(() => import("./app"));
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.restoreAllMocks();
});

function fixture(subPath = "host_test") {
  let state: State = {
    policy: {
      archiveAfterDays: null,
      deleteAfterDays: null,
      deleteStorageOnArchive: false,
      deleteDevDataOnCheckoutRemoval: false,
    },
    lastRun: null,
  };
  const hosts: HostStorageListResponse["hosts"] = [
    {
      hostId: "host_test",
      scan: { state: "idle" },
      largeFileCleanup: { state: "idle" },
      archivedFileCleanup: { state: "idle" },
      maintenance: { state: "idle" },
      report: {
        hostId: "host_test",
        scannedAt: Date.now(),
        disk: null,
        activeThreadBytes: 0,
        archivedThreadBytes: 100,
        orphanBytes: 10,
        leftoverWorktreeBytes: 0,
        threadsWithStorageCount: 1,
        archivedThreadCount: 1,
        orphanCount: 1,
        hiddenThreads: {
          activeCount: 0,
          activeBytes: 0,
          archivedCount: 0,
          archivedBytes: 0,
        },
        archivedFiles: { threadCount: 1, bytes: 100 },
        archivedLargeFiles: { threadCount: 0, fileCount: 0, bytes: 0 },
        largestThreads: [],
        leftoverWorktrees: [],
        projectWorktrees: [],
        developerStorage: {
          path: "/fixture/dev",
          sizeBytes: 20,
          entries: [
            {
              name: "after",
              sizeBytes: 20,
              sourcePath: "/fixture/after",
              sourcePathState: "exists",
              running: true,
              threads: [],
            },
          ],
        },
      },
    },
  ];
  const reports = vi.fn(async () => ({ hosts }));
  const configure = vi.fn(async (policy: State["policy"]) => {
    state = { ...state, policy };
    return state;
  });
  const remove = vi.fn(
    async (_input: z.infer<typeof storageRpc.removeDevInstances.input>) => ({
    running: [] as string[],
    removedCount: 1,
    removedBytes: 20,
    skippedCount: 0,
    stoppedProcessCount: 1,
    }),
  );
  const start = vi.fn(async () => null);
  const Component = app.navPanels[0]!.component;
  const slot = renderSlot<{ subPath: string }>(
    {
      component: (props) => (
        <>
          <Component {...props} />
          <Toaster />
        </>
      ),
    },
    { subPath },
    {
      rpc: {
        state: () => state,
        configure: (input) => configure(policySchema.parse(input)),
        hosts: reports,
        removeDevInstances: (input) =>
          remove(storageRpc.removeDevInstances.input.parse(input)),
        startClearArchivedFiles: start,
        startCleanup: start,
      },
      sdk: {
        subscribe: () => () => {},
        hosts: {
          list: async () => [
            makeHostResponse({
              id: "host_test",
              name: "Test machine",
              status: "connected",
            }),
          ],
        },
        system: {
          config: async () => makeSystemConfig({ primaryHostId: "host_test" }),
        },
      },
    },
  );
  return { slot, configure, remove, start, hosts, reports };
}

it("stops a running development instance only after the user confirms stop and remove", async () => {
  const { slot, remove } = fixture();
  remove.mockResolvedValueOnce({
    running: ["after"],
    removedCount: 0,
    removedBytes: 0,
    skippedCount: 0,
    stoppedProcessCount: 0,
  });
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Remove instance: after" }),
  );
  const confirmation = await page.findByRole("region", {
    name: "Confirm cleanup",
  });
  expect(remove.mock.calls.map(([input]) => input)).toEqual([
    { hostId: "host_test", names: ["after"], stopRunning: false },
  ]);
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Stop and remove" }),
  );
  await waitFor(() =>
    expect(remove.mock.calls.map(([input]) => input)).toEqual([
      { hostId: "host_test", names: ["after"], stopRunning: false },
      { hostId: "host_test", names: ["after"], stopRunning: true },
    ]),
  );
});

it("shows cleanup failures as toasts, keeps other actions available, and permits retry", async () => {
  const { slot, start } = fixture();
  start.mockRejectedValueOnce(new Error("Machine disconnected"));
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Clear archived files" }),
  );
  expect(
    page
      .getByRole("button", { name: "Remove orphans" })
      .hasAttribute("disabled"),
  ).toBe(false);
  let confirmation = page.getByRole("region", { name: "Confirm cleanup" });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Clear archived files" }),
  );
  await waitFor(() =>
    expect(
      document.querySelector("[data-sonner-toast]")?.textContent,
    ).toContain("Machine disconnected"),
  );
  expect(page.queryByRole("alert")).toBeNull();
  confirmation = page.getByRole("region", { name: "Confirm cleanup" });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Clear archived files" }),
  );
  await waitFor(() =>
    expect(page.queryByRole("region", { name: "Confirm cleanup" })).toBeNull(),
  );
  expect(start).toHaveBeenCalledTimes(2);
});

it("saves switches immediately and rolls failed saves back without a storage scan", async () => {
  const { slot, configure } = fixture("");
  const page = within(slot.container);
  const toggle = await page.findByRole("switch", {
    name: "Delete thread storage on archive",
  });
  configure.mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(
      document.querySelector("[data-sonner-toast]")?.textContent,
    ).toContain("Save failed"),
  );
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  expect(
    slot.rpcCalls.filter((call) => call.method === "configure"),
  ).toHaveLength(2);
  expect(
    slot.rpcCalls.some(
      (call) => call.method === "scanHost" || call.method === "preview",
    ),
  ).toBe(false);
});

it("toasts background completion once and keeps completed messages out of the page", async () => {
  const { slot, hosts } = fixture();
  await within(slot.container).findByRole("button", {
    name: "Clear archived files",
  });
  hosts[0]!.archivedFileCleanup = {
    state: "running",
    clearedThreads: 0,
    clearedBytes: 0,
  };
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await within(slot.container).findByText(
    /Removing archived files in the background/,
  );
  hosts[0]!.archivedFileCleanup = {
    state: "completed",
    clearedThreads: 1,
    clearedBytes: 100,
  };
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await waitFor(() =>
    expect(
      document.querySelector("[data-sonner-toast]")?.textContent,
    ).toContain("Archived thread files deleted"),
  );
  expect(
    within(slot.container)
      .queryAllByRole("status")
      .some((node) =>
        node.textContent?.includes("Archived thread files deleted"),
      ),
  ).toBe(false);
});

it("does not keep cleanup controls locked while the follow-up report is slow", async () => {
  const { slot, reports, hosts } = fixture();
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Clear archived files" }),
  );
  let finish = () => {};
  reports.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ hosts });
      }),
  );
  try {
    fireEvent.click(
      within(page.getByRole("region", { name: "Confirm cleanup" })).getByRole(
        "button",
        { name: "Clear archived files" },
      ),
    );
    await waitFor(() =>
      expect(
        page.queryByRole("region", { name: "Confirm cleanup" }),
      ).toBeNull(),
    );
    expect(
      page
        .getByRole("button", { name: "Remove orphans" })
        .hasAttribute("disabled"),
    ).toBe(false);
  } finally {
    await act(async () => finish());
  }
});

it("starts orphan cleanup in the background, shows progress, and toasts completion", async () => {
  const { slot, hosts, start } = fixture();
  const page = within(slot.container);
  fireEvent.click(await page.findByRole("button", { name: "Remove orphans" }));
  fireEvent.click(
    within(page.getByRole("region", { name: "Confirm cleanup" })).getByRole(
      "button",
      { name: "Remove orphans" },
    ),
  );
  await waitFor(() => expect(start).toHaveBeenCalled());
  expect(
    slot.rpcCalls.find((call) => call.method === "startCleanup")?.input,
  ).toEqual({ hostId: "host_test", kind: "orphans" });
  hosts[0]!.maintenance = { state: "running", kind: "orphans" };
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await page.findByText("Removing orphaned storage…");
  expect(
    page
      .getByRole("button", { name: "Remove orphans" })
      .hasAttribute("disabled"),
  ).toBe(true);
  hosts[0]!.maintenance = {
    state: "completed",
    kind: "orphans",
    message: "Removed 1 orphaned storage folder",
  };
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await waitFor(() =>
    expect(
      [...document.querySelectorAll("[data-sonner-toast]")].some((node) =>
        node.textContent?.includes("Removed 1 orphaned"),
      ),
    ).toBe(true),
  );
  expect(page.queryByText("Removing orphaned storage…")).toBeNull();
  expect(
    page
      .getByRole("button", { name: "Remove orphans" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("shows the development path below a short pending title and updates the same toast on completion", async () => {
  const { slot, remove } = fixture();
  const completion: {
    resolve: (value: Awaited<ReturnType<typeof remove>>) => void;
  } = { resolve: () => {} };
  remove.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completion.resolve = resolve;
      }),
  );
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Remove instance: after" }),
  );
  await waitFor(() =>
    expect(
      document.querySelector(
        '[data-sonner-toast][data-type="loading"] [data-title]',
      )?.textContent,
    ).toBe("Deleting development data"),
  );
  const pending = document.querySelector(
    '[data-sonner-toast][data-type="loading"]',
  );
  expect(pending?.querySelector("[data-description]")?.textContent).toBe(
    "/fixture/dev/after",
  );
  await act(async () =>
    completion.resolve({
      running: [],
      removedCount: 1,
      removedBytes: 20,
      skippedCount: 0,
      stoppedProcessCount: 0,
    }),
  );
  await waitFor(() =>
    expect(pending?.querySelector("[data-title]")?.textContent).toBe(
      "Development data deleted",
    ),
  );
  expect(pending?.querySelector("[data-description]")?.textContent).toBe(
    "/fixture/dev/after · 20 B freed",
  );
  expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
});

it.each([
  ["orphans", "Orphaned files deleted"],
  ["development", "Development data deleted"],
  ["worktrees", "Checkout cleanup retried"],
] as const)(
  "keeps the %s completion title specific when the running update is missed",
  async (kind, title) => {
    const { slot, hosts } = fixture();
    await within(slot.container).findByRole("button", {
      name: "Remove orphans",
    });
    hosts[0]!.maintenance = {
      state: "completed",
      kind,
      message: "Test machine",
    };
    await act(async () => {
      await slot.emitRealtime("changed", null);
    });
    await waitFor(() =>
      expect(
        document.querySelector("[data-sonner-toast] [data-title]")?.textContent,
      ).toBe(title),
    );
  },
);
