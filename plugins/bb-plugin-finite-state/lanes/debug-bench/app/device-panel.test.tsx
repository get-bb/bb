// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { describe, expect, it, vi } from "vitest";
import type { FamilyStatus } from "../registry/families.js";

const scope = { projectId: "project-1", projectVersionId: null };
const availableFamily = {
  familyId: "probe-rs",
  kind: "probe" as const,
  label: "Debug probes",
  availability: "available" as const,
  reason: null,
  helper: {
    id: "probe-rs-tools",
    displayName: "probe-rs tools",
    source: "https://probe.rs",
    why: "Detect probes",
  },
  needsConfiguration: false,
  checkedAt: "2026-08-13T10:00:00.000Z",
};
const unavailableFamily = {
  familyId: "saleae-logic",
  kind: "logic" as const,
  label: "Logic analyzers",
  availability: "unavailable" as const,
  reason: "logic2-automation is unavailable",
  helper: {
    id: "logic2-automation",
    displayName: "logic2-automation",
    source: "https://pypi.org/project/logic2-automation/",
    why: "Detect Saleae analyzers",
  },
  needsConfiguration: true,
  checkedAt: "2026-08-13T10:00:00.000Z",
};
const device = {
  ...scope,
  deviceId: "probe-rs:abc",
  kind: "probe" as const,
  make: "Arm",
  model: "CMSIS-DAP",
  connection: "usb:1-2",
  transport: "local-usb" as const,
  claimedBy: null as string | null,
  claimedAt: null as string | null,
  claimScope: "machine" as const,
  lastSeen: "2026-08-13T10:00:00.000Z",
  stale: true,
};

async function firmwareBenchSlot() {
  const app = await loadPluginApp(() => import("../../../app.js"));
  const slot = app.navPanels.find((panel) => panel.id === "firmware-bench");
  if (!slot) throw new Error("firmware bench panel not registered");
  return slot;
}

async function firmwareBenchThreadSlot() {
  const app = await loadPluginApp(() => import("../../../app.js"));
  const slot = app.threadPanelActions.find(
    (panel) => panel.id === "firmware-bench-thread",
  );
  if (!slot) throw new Error("thread-scoped firmware bench panel not registered");
  return slot;
}

function registryResult(families: FamilyStatus[] = [availableFamily], deviceCount = 0) {
  return { families, deviceCount, truncated: false, scannedAt: "2026-08-13T10:00:00.000Z" };
}

function stringField(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) throw new Error(`missing ${key}`);
  const value = Reflect.get(input, key);
  if (typeof value !== "string") throw new Error(`missing ${key}`);
  return value;
}

describe("firmware device panel", () => {
  it("renders and submits the server-issued destructive confirmation interaction", async () => {
    const app = await loadPluginApp(() => import("../../../app.js"));
    const interaction = app.pendingInteractions.find(
      (registration) => registration.id === "finite-state-destructive-confirmation",
    );
    if (!interaction) throw new Error("destructive confirmation renderer not registered");
    const submit = vi.fn(async () => undefined);
    const slot = renderSlot(interaction, {
      interaction: {
        id: "interaction-1",
        threadId: "thread-1",
        title: "Install fixture helper",
        payload: {
          operation: "benchDevHelperInstall",
          deviceId: "helper:fixture",
          detail: "Install the reviewed helper.",
          command: "python3 -m pip install fixture",
        },
        createdAt: 0,
        expiresAt: 60_000,
      },
      submit,
      cancel: async () => undefined,
    });

    expect(slot.getByText("Install the reviewed helper.")).toBeTruthy();
    expect(slot.getByText("python3 -m pip install fixture")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Confirm operation" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ confirmed: true }));
    slot.lifecycle.unmount();
  });

  it("selects a project when plugin navigation has no project context", async () => {
    const panel = await firmwareBenchSlot();
    let resolveScan: ((value: ReturnType<typeof registryResult>) => void) | undefined;
    const slot = renderSlot(panel, { subPath: "" }, {
      context: { projectId: null, threadId: null },
      sidebarThreads: {
        status: "ready",
        projects: [{ id: "project-1", name: "Firmware Project", isPersonal: false }],
      },
      rpc: {
        benchDevRegistryRescan: () => new Promise((resolve) => { resolveScan = resolve; }),
        benchDevDevicesList: () => ({ items: [], total: 0, cursor: null }),
      },
    });
    expect(slot.getByText("Choose a project")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toHaveLength(0);
    fireEvent.change(slot.getByLabelText("Project"), { target: { value: "project-1" } });
    expect(slot.getByRole("status", { name: "Scanning hardware registry" })).toBeTruthy();
    resolveScan?.(registryResult());
    expect(await slot.findByText("No instruments detected")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "benchDevRegistryRescan", input: scope }),
    ]));
    slot.lifecycle.unmount();
  });

  it("renders explicit loading, error, and empty states", async () => {
    const panel = await firmwareBenchSlot();
    let resolveScan: ((value: ReturnType<typeof registryResult>) => void) | undefined;
    const loading = renderSlot(panel, { subPath: "" }, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevRegistryRescan: () => new Promise((resolve) => { resolveScan = resolve; }),
        benchDevDevicesList: () => ({ items: [], total: 0, cursor: null }),
      },
    });
    expect(loading.getByRole("status", { name: "Scanning hardware registry" })).toBeTruthy();
    resolveScan?.(registryResult());
    expect(await loading.findByText("No instruments detected")).toBeTruthy();
    loading.lifecycle.unmount();

    const error = renderSlot(panel, { subPath: "" }, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevRegistryRescan: () => { throw new Error("registry offline"); },
      },
    });
    expect(await error.findByText("registry offline")).toBeTruthy();
    expect(error.getByRole("button", { name: "Retry registry read" })).toBeTruthy();
    error.lifecycle.unmount();
  });

  it("groups devices, renders stale/setup states, confirms installs, and claims/releases", async () => {
    const panel = await firmwareBenchThreadSlot();
    const mutableDevice = { ...device };
    const install = vi.fn(() => ({
      proposalToken: "proposal-1",
      familyId: "saleae-logic",
      helperId: "logic2-automation",
      state: "installed" as const,
      confirmedBy: "request-input-response:thread-1:fixture",
      message: "installed",
      completedAt: "2026-08-13T10:01:00.000Z",
    }));
    const slot = renderSlot(panel, { threadId: "thread-1", params: null }, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevRegistryRescan: () => registryResult([availableFamily, unavailableFamily], 1),
        benchDevRegistryStatus: () => registryResult([availableFamily, unavailableFamily], 1),
        benchDevDevicesList: () => ({ items: [{ ...mutableDevice }], total: 1, cursor: null }),
        benchDevDeviceClaim: (input) => {
          mutableDevice.claimedBy = stringField(input, "holder");
          mutableDevice.claimedAt = "2026-08-13T10:01:00.000Z";
          return { ...scope, device: { ...mutableDevice }, outcome: "claimed" as const };
        },
        benchDevDeviceRelease: () => {
          mutableDevice.claimedBy = null;
          mutableDevice.claimedAt = null;
          return { ...scope, device: { ...mutableDevice }, outcome: "released" as const };
        },
        benchDevHelperProposal: () => ({
          proposalToken: "proposal-1",
          familyId: "saleae-logic",
          helperId: "logic2-automation",
          helperName: "logic2-automation",
          source: "https://pypi.org/project/logic2-automation/",
          why: "Detect Saleae analyzers",
          command: "python3 -m pip install logic2-automation",
          proposedAt: "2026-08-13T10:00:00.000Z",
        }),
        benchDevHelperInstall: install,
      },
    });
    expect(await slot.findByText("Debug probes")).toBeTruthy();
    expect(slot.container.querySelector('[data-layout="compact"]')).toBeTruthy();
    expect(slot.getAllByText("Stale").length).toBeGreaterThan(0);
    expect(slot.getByText("Logic analyzers unavailable")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Claim" }).hasAttribute("disabled")).toBe(true);
    expect(await slot.findByText("No serial port available")).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "Review helper install" }));
    expect(await slot.findByText("Explicit confirmation required")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Confirm and install" }).className).toContain("w-full");
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Confirm and install" }));
    await waitFor(() => expect(install).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread-1",
    })));
    slot.lifecycle.unmount();
  });

  it("keeps helper installation off the nav-only route and points to the thread action", async () => {
    const panel = await firmwareBenchSlot();
    const slot = renderSlot(panel, { subPath: "" }, {
      context: { projectId: "project-1", threadId: null },
      rpc: {
        benchDevRegistryRescan: () => registryResult([unavailableFamily]),
        benchDevDevicesList: () => ({ items: [], total: 0, cursor: null }),
      },
    });

    expect(await slot.findByText(/Open Firmware Bench from this thread's Actions menu/))
      .toBeTruthy();
    expect(slot.queryByRole("button", { name: "Review helper install" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Confirm and install" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("flows claim and holder-checked release for a visible device", async () => {
    const panel = await firmwareBenchSlot();
    const mutableDevice = { ...device, stale: false };
    const slot = renderSlot(panel, { subPath: "" }, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevRegistryRescan: () => registryResult([availableFamily], 1),
        benchDevRegistryStatus: () => registryResult([availableFamily], 1),
        benchDevDevicesList: () => ({ items: [{ ...mutableDevice }], total: 1, cursor: null }),
        benchDevDeviceClaim: (input) => {
          mutableDevice.claimedBy = stringField(input, "holder");
          mutableDevice.claimedAt = "2026-08-13T10:01:00.000Z";
          return { ...scope, device: { ...mutableDevice }, outcome: "claimed" as const };
        },
        benchDevDeviceRelease: () => {
          mutableDevice.claimedBy = null;
          mutableDevice.claimedAt = null;
          return { ...scope, device: { ...mutableDevice }, outcome: "released" as const };
        },
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: "Claim" }));
    expect(await slot.findByText("Claimed here")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Release" }));
    expect(await slot.findByText("Free")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
