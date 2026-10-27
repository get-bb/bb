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
      maintenanceJobs: [],
      externalWorktreeRemovals: [],
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
        externalWorktrees: [],
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
              current: false,
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
  const entryJobs = new Map<
    string,
    import("./src/storage-types.js").EntryCleanupStatus
  >();
  const start = vi.fn(async () => null);
  const removeWorktree = vi.fn(async () => ({ state: "started" as const }));
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
        startEntryCleanup: (raw) => {
          const input = storageRpc.startEntryCleanup.input.parse(raw);
          const id = JSON.stringify(input);
          if (input.kind !== "development")
            throw new Error("Unexpected cleanup");
          entryJobs.set(id, { state: "running" });
          void remove({
            hostId: input.hostId,
            names: input.names,
            stopRunning: input.stopRunning,
          }).then(
            (result) =>
              entryJobs.set(id, {
                state: "completed",
                result: { kind: "development", ...result },
              }),
            (error: Error) =>
              entryJobs.set(id, { state: "failed", message: error.message }),
          );
          return { id };
        },
        entryCleanup: (raw) =>
          entryJobs.get(storageRpc.entryCleanup.input.parse(raw).id),
        scanHost: start,
        startClearArchivedFiles: start,
        startClearLargeFiles: start,
        startCleanup: start,
        startRemoveExternalWorktree: removeWorktree,
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
  return { slot, configure, remove, start, removeWorktree, hosts, reports };
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

it("shows background progress on the action and toasts only completion", async () => {
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
  const button = within(slot.container).getByRole("button", {
    name: "Clear archived files",
  });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
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

it("keeps all-machines cleanup busy until the machine jobs complete", async () => {
  const { slot, hosts, start } = fixture("");
  hosts[0]!.report!.archivedLargeFiles = {
    threadCount: 1,
    fileCount: 2,
    bytes: 2 * 1024 * 1024 * 1024,
  };
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Delete large files" }),
  );
  fireEvent.click(
    within(page.getByRole("region", { name: "Confirm cleanup" })).getByRole(
      "button",
      { name: "Delete large files" },
    ),
  );
  await waitFor(() => expect(start).toHaveBeenCalled());
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  hosts[0]!.largeFileCleanup = { state: "running", startedAt: Date.now() };
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  expect(
    page
      .getByRole("button", { name: "Delete large files" })
      .getAttribute("aria-busy"),
  ).toBe("true");
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  hosts[0]!.largeFileCleanup = {
    state: "completed",
    clearedFiles: 2,
    clearedBytes: 2 * 1024 * 1024 * 1024,
  };
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await waitFor(() =>
    expect(
      document.querySelector('[data-sonner-toast][data-type="success"]')
        ?.textContent,
    ).toContain("Large archived files deleted"),
  );
  expect(
    page
      .getByRole("button", { name: "Delete large files" })
      .getAttribute("aria-busy"),
  ).toBe("false");
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

it("starts orphan cleanup in the background without locking the page and toasts completion", async () => {
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
  hosts[0]!.maintenanceJobs = [{ state: "running", kind: "orphans" }];
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  expect(
    page
      .getByRole("button", { name: "Remove orphans" })
      .getAttribute("aria-busy"),
  ).toBe("true");
  expect(
    page
      .getByRole("button", { name: "Remove orphans" })
      .hasAttribute("disabled"),
  ).toBe(true);
  hosts[0]!.maintenanceJobs = [
    {
      state: "completed",
      kind: "orphans",
      message: "Removed 1 orphaned storage folder",
    },
  ];
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
  expect(
    page
      .getByRole("button", { name: "Remove orphans" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("spins the development trash button immediately and only toasts completion", async () => {
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
  const button = page.getByRole("button", { name: "Remove instance: after" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(
    button.querySelector('[data-icon="Spinner"].animate-spin'),
  ).not.toBeNull();
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  fireEvent.click(button);
  expect(remove).toHaveBeenCalledTimes(1);
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
    expect(
      document.querySelector("[data-sonner-toast] [data-title]")?.textContent,
    ).toBe("Development data deleted"),
  );
  expect(
    document.querySelector("[data-sonner-toast] [data-description]")
      ?.textContent,
  ).toBe("/fixture/dev/after · 20 B freed");
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
    hosts[0]!.maintenanceJobs = [
      {
        state: "completed",
        kind,
        message: "Test machine",
      },
    ];
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

it("keeps worktree removal spinning through queued and running states, then toasts completion", async () => {
  const { slot, hosts, removeWorktree } = fixture();
  const worktreePath = "/fixture/worktrees/heavy";
  hosts[0]!.report!.externalWorktrees = [
    {
      projectId: "proj_test",
      repositoryPath: "/fixture/repo",
      path: worktreePath,
      branch: "heavy",
      locked: false,
      changedFileCount: 0,
      unsavedCommitCount: 0,
      lastActivityAt: null,
      sizeBytes: 4096,
      threads: [],
    },
  ];
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Remove worktree: heavy" }),
  );
  await waitFor(() => expect(removeWorktree).toHaveBeenCalledTimes(1));
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  hosts[0]!.externalWorktreeRemovals = [
    { path: worktreePath, state: "queued" },
  ];
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  const button = page.getByRole("button", { name: "Remove worktree: heavy" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  hosts[0]!.externalWorktreeRemovals = [
    { path: worktreePath, state: "running" },
  ];
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  hosts[0]!.report!.externalWorktrees = [];
  hosts[0]!.externalWorktreeRemovals = [
    { path: worktreePath, state: "completed", removedBytes: 4096 },
  ];
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await waitFor(() =>
    expect(
      document.querySelector("[data-sonner-toast] [data-title]")?.textContent,
    ).toBe("Worktree removed"),
  );
  expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  expect(
    document.querySelector("[data-sonner-toast] [data-description]")
      ?.textContent,
  ).toBe(`${worktreePath} · 4 KB freed`);
});

it("shows scan progress immediately and waits for the updated report before toasting", async () => {
  const { slot, hosts, start } = fixture();
  let finish = () => {};
  start.mockImplementationOnce(
    () =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  const page = within(slot.container);
  fireEvent.click(await page.findByRole("button", { name: "Rescan machine" }));
  const button = page.getByRole("button", { name: "Scanning…" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.querySelector(".animate-spin")).not.toBeNull();
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  hosts[0]!.scan = { state: "scanning", startedAt: Date.now() };
  await act(async () => finish());
  expect(
    page.getByRole("button", { name: "Scanning…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  hosts[0]!.scan = { state: "idle" };
  hosts[0]!.report!.scannedAt += 1000;
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await waitFor(() =>
    expect(
      document.querySelector("[data-sonner-toast] [data-title]")?.textContent,
    ).toBe("Storage scan completed"),
  );
  expect(
    page
      .getByRole("button", { name: "Rescan machine" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("aggregates nearby instance deletions and starts a fresh toast after the window expires", async () => {
  const { slot, hosts, remove } = fixture();
  const storage = hosts[0]!.report!.developerStorage!;
  const template = storage.entries[0]!;
  storage.entries = ["first", "second", "later"].map((name) => ({
    ...template,
    name,
    sourcePath: `/fixture/${name}`,
    running: false,
  }));
  remove.mockResolvedValue({
    running: [],
    removedCount: 1,
    removedBytes: 100,
    skippedCount: 0,
    stoppedProcessCount: 0,
  });
  const page = within(slot.container);
  fireEvent.click(
    await page.findByRole("button", { name: "Remove instance: first" }),
  );
  await waitFor(() =>
    expect(
      document.querySelector('[data-sonner-toast][data-type="success"]')
        ?.textContent,
    ).toContain("Development data deleted"),
  );
  const firstToast = document.querySelector(
    '[data-sonner-toast][data-type="success"]',
  );
  fireEvent.click(
    page.getByRole("button", { name: "Remove instance: second" }),
  );
  await waitFor(() =>
    expect(firstToast?.textContent).toContain("2 instances deleted"),
  );
  expect(firstToast?.textContent).toContain("200 B freed");
  expect(
    document.querySelectorAll('[data-sonner-toast][data-type="success"]'),
  ).toHaveLength(1);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
  fireEvent.click(page.getByRole("button", { name: "Remove instance: later" }));
  await waitFor(() =>
    expect(
      document.querySelectorAll('[data-sonner-toast][data-type="success"]'),
    ).toHaveLength(2),
  );
  const titles = [
    ...document.querySelectorAll(
      '[data-sonner-toast][data-type="success"] [data-title]',
    ),
  ].map((node) => node.textContent);
  expect(titles).toEqual(
    expect.arrayContaining(["2 instances deleted", "Development data deleted"]),
  );
});

it("aggregates background completions across cleanup types while keeping failures separate", async () => {
  const { slot, hosts } = fixture();
  await within(slot.container).findByRole("button", {
    name: "Clear archived files",
  });
  hosts[0]!.archivedFileCleanup = {
    state: "completed",
    clearedThreads: 1,
    clearedBytes: 100,
  };
  hosts[0]!.largeFileCleanup = {
    state: "completed",
    clearedFiles: 2,
    clearedBytes: 200,
  };
  hosts[0]!.externalWorktreeRemovals = [
    { path: "/fixture/worktree", state: "completed", removedBytes: 300 },
  ];
  hosts[0]!.maintenanceJobs = [
    { kind: "orphans", state: "failed", message: "Machine disconnected" },
  ];
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  await waitFor(() =>
    expect(
      document.querySelector('[data-sonner-toast][data-type="success"]')
        ?.textContent,
    ).toContain("3 storage actions completed"),
  );
  expect(
    document.querySelector('[data-sonner-toast][data-type="success"]')
      ?.textContent,
  ).toContain("600 B freed");
  expect(
    document.querySelectorAll('[data-sonner-toast][data-type="success"]'),
  ).toHaveLength(1);
  expect(
    document.querySelector('[data-sonner-toast][data-type="error"]')
      ?.textContent,
  ).toContain("Machine disconnected");
  await act(async () => {
    await slot.emitRealtime("changed", null);
  });
  expect(
    document.querySelector('[data-sonner-toast][data-type="success"]')
      ?.textContent,
  ).toContain("3 storage actions completed");
});
