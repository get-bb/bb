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
import type { State } from "./src/contract.js";
import type { HostStorageListResponse } from "./src/storage-types.js";

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const app = await loadPluginApp(() => import("./app"));
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.restoreAllMocks();
  if (scrollIntoViewDescriptor)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      scrollIntoViewDescriptor,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function fixture(subPath = "host_test", metadataError: Error | null = null) {
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
  const readState = vi.fn(() => state);
  const metadata = vi.fn(async () => {
    if (metadataError) throw metadataError;
    return {
      machines: [
        makeHostResponse({
          id: "host_test",
          name: "Test machine",
          status: "connected",
        }),
      ],
      primaryHostId: "host_test",
    };
  });
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
      experimental_rpcContract: storageRpc,
      rpc: {
        state: readState,
        metadata,
        configure: (input) => configure(policySchema.parse(input)),
        hosts: reports,
        removeDevInstances: (input) =>
          remove(storageRpc.removeDevInstances.input.parse(input)),
        startClearArchivedFiles: start,
        startClearLargeFiles: start,
        startCleanup: start,
      },
    },
  );
  return {
    slot,
    configure,
    remove,
    start,
    hosts,
    reports,
    metadata,
    readState,
  };
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

it.each(["switch", "select"] as const)(
  "predicts a %s setting and rolls back a rejected write",
  async (kind) => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const { slot, configure } = fixture("");
    let reject!: (error: Error) => void;
    configure.mockImplementationOnce(
      () =>
        new Promise<State>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const control =
      kind === "switch"
        ? await slot.findByRole("switch", {
            name: "Delete thread storage on archive",
          })
        : await slot.findByRole("combobox", {
            name: "Archive inactive threads",
          });
    if (kind === "switch") fireEvent.click(control);
    else {
      fireEvent.click(control);
      fireEvent.click(
        await slot.findByRole("option", { name: "After 1 week" }),
      );
    }
    await waitFor(() =>
      expect(
        kind === "switch"
          ? control.getAttribute("aria-checked")
          : control.textContent,
      ).toBe(kind === "switch" ? "true" : "After 1 week"),
    );
    await waitFor(() => expect(control.hasAttribute("disabled")).toBe(true));
    await act(async () => reject(new Error("Save rejected")));
    await waitFor(() =>
      expect(
        kind === "switch"
          ? control.getAttribute("aria-checked")
          : control.textContent,
      ).toBe(kind === "switch" ? "false" : "Never"),
    );
  },
);

it("saves switches immediately and keeps the saved value on failure without a storage scan", async () => {
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
    await slot.experimental_invalidateRpc(["hosts"]);
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
    await slot.experimental_invalidateRpc(["hosts"]);
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

it("hands an all-machines large-file cleanup toast over to each machine's job until it completes", async () => {
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
  await waitFor(() =>
    expect(
      document.querySelector('[data-sonner-toast][data-type="info"]')
        ?.textContent,
    ).toContain("Started on all online machines"),
  );
  const loadingDescriptions = () =>
    [
      ...document.querySelectorAll(
        '[data-sonner-toast][data-type="loading"]:not([data-removed="true"]) [data-description]',
      ),
    ].map((node) => node.textContent);
  await waitFor(() => expect(loadingDescriptions()).toEqual([]));
  hosts[0]!.largeFileCleanup = { state: "running", startedAt: Date.now() };
  await act(async () => {
    await slot.experimental_invalidateRpc(["hosts"]);
  });
  await waitFor(() => expect(loadingDescriptions()).toEqual(["Test machine"]));
  hosts[0]!.largeFileCleanup = {
    state: "completed",
    clearedFiles: 2,
    clearedBytes: 2 * 1024 * 1024 * 1024,
  };
  await act(async () => {
    await slot.experimental_invalidateRpc(["hosts"]);
  });
  await waitFor(() =>
    expect(
      document.querySelector('[data-sonner-toast][data-type="success"]')
        ?.textContent,
    ).toContain("Large archived files deleted"),
  );
  expect(loadingDescriptions()).toEqual([]);
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
    await slot.experimental_invalidateRpc(["hosts"]);
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
    await slot.experimental_invalidateRpc(["hosts"]);
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
      await slot.experimental_invalidateRpc(["hosts"]);
    });
    await waitFor(() =>
      expect(
        document.querySelector("[data-sonner-toast] [data-title]")?.textContent,
      ).toBe(title),
    );
  },
);

it("shows host rename and disconnect updates even when reports have not changed", async () => {
  const { slot, metadata } = fixture("");
  await slot.findByText("Test machine");
  metadata.mockResolvedValue({
    machines: [
      makeHostResponse({
        id: "host_test",
        name: "Renamed machine",
        status: "disconnected",
      }),
    ],
    primaryHostId: "host_test",
  });
  await act(async () => slot.experimental_invalidateRpc(["hosts"]));
  await slot.findByText("Renamed machine");
  expect(slot.getByText("Offline")).toBeTruthy();
});

it.each(["metadata", "policy"] as const)(
  "keeps loaded controls on %s failure and recovers with Retry",
  async (kind) => {
    const { slot, metadata, readState } = fixture("");
    const control = await slot.findByRole("switch", {
      name: "Delete thread storage on archive",
    });
    if (kind === "metadata")
      metadata.mockRejectedValue(new Error("Read unavailable"));
    else
      readState.mockImplementation(() => {
        throw new Error("Read unavailable");
      });
    await act(async () =>
      slot.experimental_invalidateRpc([
        kind === "metadata" ? "hosts" : "state",
      ]),
    );
    expect(
      await slot.findByRole("alert", {}, { timeout: 10000 }),
    ).toHaveProperty(
      "textContent",
      expect.stringContaining("Read unavailable"),
    );
    expect(
      slot.getByRole("switch", { name: "Delete thread storage on archive" }),
    ).toBe(control);
    metadata.mockReset();
    metadata.mockResolvedValue({
      machines: [
        makeHostResponse({
          id: "host_test",
          name: "Test machine",
          status: "connected",
        }),
      ],
      primaryHostId: "host_test",
    });
    readState.mockReset();
    readState.mockReturnValue({
      policy: {
        archiveAfterDays: null,
        deleteAfterDays: null,
        deleteStorageOnArchive: false,
        deleteDevDataOnCheckoutRemoval: false,
      },
      lastRun: null,
    });
    fireEvent.click(slot.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    expect(
      slot.getByRole("switch", { name: "Delete thread storage on archive" }),
    ).toBe(control);
  },
  15000,
);

it("offers Retry when host metadata fails on first load", async () => {
  const { slot, metadata } = fixture("", new Error("Metadata unavailable"));
  await slot.findByText("Metadata unavailable", {}, { timeout: 10000 });
  expect(slot.queryByRole("switch")).toBeNull();
  metadata.mockResolvedValue({
    machines: [
      makeHostResponse({
        id: "host_test",
        name: "Recovered machine",
        status: "connected",
      }),
    ],
    primaryHostId: "host_test",
  });
  fireEvent.click(slot.getByRole("button", { name: "Try again" }));
  await slot.findByText("Recovered machine");
  expect(slot.queryByRole("alert")).toBeNull();
}, 15000);
