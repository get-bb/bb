// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../../../app.js"));
const chip = app.threadHeaderActions.find((entry) => entry.id === "firmware-status")!;

const cache = {
  state: "fresh",
  asOf: "2026-08-13T00:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 0,
};

const labels = {
  not_materialized: "Not materialized",
  hashing: "Hashing",
  unpacking: "Unpacking",
  validating: "Validating",
  ingesting: "Ingesting",
  ready: "Ready",
  ready_with_gaps: "Ready with gaps",
  metadata_only: "Metadata only",
  stale: "Stale",
  error: "Error",
} as const;

function mounts() {
  return {
    items: [{
      projectId: "project-1",
      projectVersionId: "pv-1",
      kind: "firmware_mount",
      key: "pv-1",
      label: "Firmware pv-1",
      fields: { state: "ready" },
    }],
    total: 1,
    next: null,
    cache,
  };
}

function detail(state: keyof typeof labels) {
  return {
    projectId: "project-1",
    projectVersionId: "pv-1",
    kind: "firmware_mount",
    key: "pv-1",
    label: "Firmware pv-1",
    fields: {
      pvId: "pv-1",
      state,
      source: state === "not_materialized" ? null : "standalone_unpack",
      files: 12,
      materializedFiles: state === "ready" ? 12 : 8,
      errors: state === "ready_with_gaps" || state === "error" ? 2 : 0,
      inputSha256: "a".repeat(64),
      artifactHash: "b".repeat(64),
    },
    cache,
  };
}

function options(getDetail: () => ReturnType<typeof detail> | Promise<ReturnType<typeof detail>>) {
  return {
    realtimeConnectionState: "connected" as const,
    rpc: {
      firmwareMountsList: mounts,
      firmwareMountGet: getDetail,
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

describe("firmware status chip", () => {
  it.each(Object.entries(labels))("renders %s without calling a partial state complete", async (state, label) => {
    const slot = renderSlot(
      chip,
      { threadId: "thread-1", projectId: "project-1", isCompactViewport: false },
      options(() => detail(state as keyof typeof labels)),
    );
    await slot.findByText(label);
    if (state !== "ready") {
      expect(slot.queryByText(/^Ready$/u)).toBeNull();
    }
  });

  it("refetches authoritative status for matching hints and reconnect, ignoring the wrong pv", async () => {
    let calls = 0;
    const slot = renderSlot(
      chip,
      { threadId: "thread-1", projectId: "project-1", isCompactViewport: false },
      options(() => { calls += 1; return detail("ready"); }),
    );
    await slot.findByText("Ready");
    expect(calls).toBe(1);

    await slot.behavior.emitRealtime("firmware:progress", { pvId: "pv-other", state: "error" });
    expect(calls).toBe(1);
    await slot.behavior.emitRealtime("firmware:progress", { pvId: "pv-1", state: "unpacking" });
    await waitFor(() => expect(calls).toBe(2));

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(calls).toBe(3));
  });

  it("refetches the first materialization when progress arrives before status exists", async () => {
    let mountCalls = 0;
    const slot = renderSlot(
      chip,
      { threadId: "thread-1", projectId: "project-1", isCompactViewport: false },
      {
        realtimeConnectionState: "connected" as const,
        rpc: {
          firmwareMountsList: () => {
            mountCalls += 1;
            return mountCalls === 1 ? { ...mounts(), items: [], total: 0 } : mounts();
          },
          firmwareMountGet: () => detail("unpacking"),
        },
      },
    );
    await slot.findByText("Firmware");

    await slot.behavior.emitRealtime("firmware:progress", { pvId: "pv-1", state: "unpacking" });

    await slot.findByText("Unpacking");
    expect(mountCalls).toBe(2);
  });

  it("shows the workspace-relative rootfs location for ready mounts", async () => {
    const slot = renderSlot(
      chip,
      { threadId: "thread-1", projectId: "project-1", isCompactViewport: false },
      options(() => detail("ready_with_gaps")),
    );
    await slot.findByText("Ready with gaps");
    fireEvent.click(slot.getByRole("button", { name: "Firmware status" }));
    expect(await slot.findByText(".fs-firmware/pv-1/rootfs")).toBeTruthy();
  });

  it("retains stale status when a hint refetch fails and offers retry", async () => {
    let calls = 0;
    const slot = renderSlot(
      chip,
      { threadId: "thread-1", projectId: "project-1", isCompactViewport: false },
      options(() => {
        calls += 1;
        if (calls > 1) throw new Error("status service unavailable");
        return detail("metadata_only");
      }),
    );
    await slot.findByText("Metadata only");
    fireEvent.click(slot.getByRole("button", { name: "Firmware status" }));
    await slot.behavior.emitRealtime("firmware:changed", { pvId: "pv-1" });
    await waitFor(() => expect(slot.getByText(/status service unavailable/u)).toBeTruthy());
    expect(slot.getAllByText("Metadata only")).toHaveLength(2);
    expect(await slot.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
