// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ProfileWithStatus, SystemSnapshot } from "./contract.js";

const app = await loadPluginApp(() => import("./app"));

const SNAPSHOT: SystemSnapshot = {
  cpuPercent: 37.5,
  cpuCores: 8,
  memoryTotalBytes: 16 * 1024 ** 3,
  memoryUsedBytes: 12 * 1024 ** 3,
  memoryUsedPercent: 75,
  uptimeSeconds: 5_400,
  collectedAt: new Date().toISOString(),
};

const PROFILE: ProfileWithStatus = {
  id: "pcp_tool123",
  name: "Tool",
  exePath: "C:\\Apps\\Tool\\tool.exe",
  args: ["--port", "8080"],
  cwd: "C:\\Apps\\Tool",
  processName: null,
  createdAt: 1,
  updatedAt: 1,
  status: { running: true, pids: [555] },
};

type RpcStubMap = Record<string, (input: unknown) => unknown>;

function defaultRpc(): RpcStubMap {
  return {
    overview: () => ({
      host: { id: "host_1", name: "Office PC", status: "connected" },
      snapshot: SNAPSHOT,
      error: null,
    }),
    processes: () => ({
      collectedAt: "2026-09-09T10:00:00.000Z",
      truncated: false,
      totalMatched: 3,
      hostError: null,
      processes: [
        { pid: 100, name: "Tool", cpuPercent: 40.5, memoryBytes: 104_857_600 },
        { pid: 200, name: "browser", cpuPercent: 5, memoryBytes: 209_715_200 },
      ],
    }),
    profiles: () => ({
      host: { id: "host_1", name: "Office PC", status: "connected" },
      profiles: [PROFILE],
      error: null,
    }),
  };
}

function renderPanel(rpc: RpcStubMap = defaultRpc()) {
  return renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "thread_1", params: null },
    {
      rpc,
      context: { projectId: "proj_1", threadId: "thread_1" },
    },
  );
}

beforeEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
});

describe("PC Control panel registration", () => {
  it("registers thread and new-thread panel actions", () => {
    expect(app.threadPanelActions).toHaveLength(1);
    expect(app.threadPanelActions[0]).toMatchObject({
      id: "pc-control",
      title: "PC Control",
      icon: "Laptop",
      layout: "flush",
    });
    expect(app.newThreadPanelActions).toHaveLength(1);
    expect(app.newThreadPanelActions[0]).toMatchObject({
      id: "pc-control",
    });
  });

  it("registers the always-on pill overlay", () => {
    expect(app.appOverlays).toHaveLength(1);
    expect(app.appOverlays[0]).toMatchObject({
      id: "pc-control-pill",
    });
  });
});

function renderPill(rpc: RpcStubMap = defaultRpc()) {
  return renderSlot(
    app.appOverlays[0]!,
    {},
    {
      rpc,
      context: { projectId: "proj_1", threadId: "thread_1" },
    },
  );
}

describe("PC Control pill overlay", () => {
  it("shows only CPU and RAM with a fresh dot", async () => {
    const slot = renderPill();
    const pill = await slot.findByTestId("pc-pill");
    expect(pill.textContent).toContain("38%");
    expect(pill.textContent).toContain("75%");
    expect(pill.textContent).toContain("CPU");
    expect(pill.textContent).toContain("RAM");
    expect(pill.textContent).not.toContain("1h 30m");
    expect(pill.textContent).not.toContain("C:\\");
    expect(pill.textContent).not.toContain("↓");
    expect(slot.queryByTestId("pc-pill-network")).toBeNull();
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("fresh");
    slot.unmount();
  });

  it("marks the pill stale without hiding the last values", async () => {
    const slot = renderPill({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "connected" },
        snapshot: {
          ...SNAPSHOT,
          collectedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      }),
    });
    const pill = await slot.findByTestId("pc-pill");
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("stale");
    expect(pill.textContent).toContain("38%");
    slot.unmount();
  });

  it("shows dashes without inventing values when metrics fail", async () => {
    const slot = renderPill({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "disconnected" },
        snapshot: null,
        error: "daemon unreachable",
      }),
    });
    const pill = await slot.findByTestId("pc-pill");
    expect(pill.textContent).toContain("—");
    expect(pill.textContent).not.toContain("0%");
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("error");
    slot.unmount();
  });

  it("renders the narrow-screen edge bar with cpu and ram segments", async () => {
    const slot = renderPill();
    await slot.findByTestId("pc-pill");
    const edge = slot.getByTestId("pc-pill-edge");
    expect(edge.className).toContain("lg:hidden");
    expect(edge.className).toContain("left-3");
    expect(edge.className).not.toContain("inset-x");
    expect(slot.getByTestId("pc-pill").className).toContain("lg:flex");
    expect(slot.getByTestId("pc-pill-edge-freshness").dataset.state).toBe(
      "fresh",
    );
    const cpuFill = slot.getByTestId("pc-pill-edge-cpu");
    const cpuTrack = cpuFill.parentElement;
    expect(cpuTrack?.className).toContain("w-[20vw]");
    expect(cpuTrack?.className).toContain("h-[3px]");
    expect(cpuFill.className).toContain("bg-emerald-500");
    expect(cpuFill.style.width).toBe("37.5%");
    const ramFill = slot.getByTestId("pc-pill-edge-ram");
    expect(ramFill.className).toContain("bg-emerald-500");
    expect(ramFill.style.width).toBe("75%");
    expect(edge.getAttribute("aria-label")).toContain("CPU 38%");
    expect(edge.getAttribute("aria-label")).toContain("RAM 75%");
    slot.unmount();
  });

  it("shifts edge fills to warning and critical colors at thresholds", async () => {
    const warning = renderPill({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "connected" },
        snapshot: { ...SNAPSHOT, cpuPercent: 87, memoryUsedPercent: 40 },
        error: null,
      }),
    });
    await warning.findByTestId("pc-pill-edge-cpu");
    expect(warning.getByTestId("pc-pill-edge-cpu").className).toContain(
      "bg-warning",
    );
    expect(warning.getByTestId("pc-pill-edge-ram").className).toContain(
      "bg-emerald-500",
    );
    warning.unmount();

    const critical = renderPill({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "connected" },
        snapshot: { ...SNAPSHOT, memoryUsedPercent: 96 },
        error: null,
      }),
    });
    await critical.findByTestId("pc-pill-edge-ram");
    expect(critical.getByTestId("pc-pill-edge-ram").className).toContain(
      "bg-destructive",
    );
    critical.unmount();
  });

  it("opens the thread panel when the edge bar is clicked", async () => {
    const slot = renderPill();
    await slot.findByTestId("pc-pill-edge");
    fireEvent.click(slot.getByTestId("pc-pill-edge"));
    expect(
      slot.navigateCalls.some(
        (call) =>
          call.method === "openThreadPanel" &&
          call.options.actionId === "pc-control",
      ),
    ).toBe(true);
    slot.unmount();
  });

  it("dims the edge bar on stale readings", async () => {
    const slot = renderPill({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "connected" },
        snapshot: {
          ...SNAPSHOT,
          collectedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      }),
    });
    await slot.findByTestId("pc-pill-edge");
    expect(slot.getByTestId("pc-pill-edge").className).toContain("opacity-60");
    expect(slot.getByTestId("pc-pill-edge-freshness").dataset.state).toBe(
      "stale",
    );
    slot.unmount();
  });

  it("opens the thread panel with the plugin tab on click", async () => {
    const slot = renderPill();
    await slot.findByTestId("pc-pill");
    fireEvent.click(slot.getByTestId("pc-pill"));
    expect(
      slot.navigateCalls.some(
        (call) =>
          call.method === "openThreadPanel" &&
          call.options.actionId === "pc-control",
      ),
    ).toBe(true);
    slot.unmount();
  });
});

describe("PC Control overview tab", () => {
  it("renders rings, uptime, and the host", async () => {
    const slot = renderPanel();
    expect(await slot.findByTestId("pc-ring-cpu")).toBeTruthy();
    expect(slot.getByTestId("pc-ring-memory")).toBeTruthy();
    expect(slot.getByTestId("pc-ring-memory").textContent).toContain("75%");
    expect(slot.getByTestId("pc-host-label").textContent).toContain(
      "Office PC",
    );
    expect(slot.getByText("1h 30m")).toBeTruthy();
    expect(slot.queryByTestId("pc-network")).toBeNull();
    expect(slot.queryByTestId("pc-swap")).toBeNull();
    expect(slot.queryByTestId("pc-system")).toBeNull();
    expect(slot.queryByTestId("pc-disk-C")).toBeNull();
    slot.unmount();
  });

  it("marks fresh readings and dims stale ones with a marker", async () => {
    const fresh = renderPanel();
    await fresh.findByTestId("pc-overview-freshness");
    expect(fresh.getByTestId("pc-overview-freshness").dataset.state).toBe(
      "fresh",
    );
    fresh.unmount();

    const stale = renderPanel({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "connected" },
        snapshot: {
          ...SNAPSHOT,
          collectedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      }),
    });
    await stale.findByTestId("pc-overview-freshness");
    expect(stale.getByTestId("pc-overview-freshness").dataset.state).toBe(
      "stale",
    );
    expect(stale.getByTestId("pc-overview-freshness").textContent).toMatch(
      /обновлено/u,
    );
    stale.unmount();
  });

  it("shows an error state when the host snapshot fails", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      overview: () => ({
        host: { id: "host_1", name: "Office PC", status: "disconnected" },
        snapshot: null,
        error: "daemon unreachable",
      }),
    });
    expect(await slot.findByTestId("pc-overview-error")).toBeTruthy();
    expect(slot.getByText("daemon unreachable")).toBeTruthy();
    slot.unmount();
  });

  it("auto-refreshes the snapshot", async () => {
    const overviewMock = vi.fn(() => ({
      host: { id: "host_1", name: "Office PC", status: "connected" },
      snapshot: SNAPSHOT,
      error: null,
    }));
    const slot = renderPanel({
      ...defaultRpc(),
      overview: overviewMock,
    });
    await slot.findByTestId("pc-ring-cpu");
    await waitFor(
      () => {
        expect(overviewMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 4_000 },
    );
    slot.unmount();
  });
});

describe("PC Control processes tab", () => {
  it("renders process rows and refreshes manually", async () => {
    const processesMock = vi.fn(defaultRpc().processes);
    const slot = renderPanel({
      ...defaultRpc(),
      processes: processesMock,
    });
    fireEvent.click(slot.getByTestId("pc-tab-processes"));
    expect(await slot.findByText("browser")).toBeTruthy();
    expect(slot.getByText("100")).toBeTruthy();
    expect(slot.getByText("40.5%")).toBeTruthy();
    const before = processesMock.mock.calls.length;
    fireEvent.click(slot.getByTestId("pc-processes-refresh"));
    await waitFor(() => {
      expect(processesMock.mock.calls.length).toBeGreaterThan(before);
    });
    fireEvent.change(slot.getByTestId("pc-processes-search"), {
      target: { value: "tool" },
    });
    await waitFor(() => {
      expect(slot.queryByText("browser")).toBeNull();
    });
    expect(slot.getByText("Tool")).toBeTruthy();
    slot.unmount();
  });

  it("shows a host error without losing the manual refresh", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      processes: () => ({
        collectedAt: "2026-09-09T10:00:00.000Z",
        truncated: false,
        totalMatched: 0,
        hostError: "powershell missing",
        processes: [],
      }),
    });
    fireEvent.click(slot.getByTestId("pc-tab-processes"));
    expect(await slot.findByTestId("pc-processes-error")).toBeTruthy();
    expect(slot.getByText("powershell missing")).toBeTruthy();
    slot.unmount();
  });
});

describe("PC Control freshness without new RPC data", () => {
  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function hangingAfterFirstOverview() {
    let calls = 0;
    return {
      calls: () => calls,
      overview: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            host: { id: "host_1", name: "Office PC", status: "connected" },
            snapshot: {
              ...SNAPSHOT,
              collectedAt: new Date().toISOString(),
            },
            error: null,
          });
        }
        return new Promise<never>(() => {});
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pill turns stale on a local tick while the RPC hangs", async () => {
    vi.useFakeTimers();
    const hanging = hangingAfterFirstOverview();
    const slot = renderPill({
      ...defaultRpc(),
      overview: hanging.overview as unknown as () => unknown,
    });
    await flushMicrotasks();
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("fresh");
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("stale");
    expect(slot.getByTestId("pc-pill").textContent).toContain("38%");
    expect(slot.getByTestId("pc-pill-cpu").className).toContain("opacity-60");
    expect(hanging.calls()).toBeGreaterThanOrEqual(2);
    slot.unmount();
  });

  it("pill dims last values when a refresh errors", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const slot = renderPill({
      ...defaultRpc(),
      overview: () => {
        calls += 1;
        if (calls === 1) {
          return {
            host: { id: "host_1", name: "Office PC", status: "connected" },
            snapshot: SNAPSHOT,
            error: null,
          };
        }
        return {
          host: { id: "host_1", name: "Office PC", status: "connected" },
          snapshot: null,
          error: "daemon unreachable",
        };
      },
    });
    await flushMicrotasks();
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("fresh");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(slot.getByTestId("pc-pill-freshness").dataset.state).toBe("error");
    expect(slot.getByTestId("pc-pill").textContent).toContain("38%");
    expect(slot.getByTestId("pc-pill-cpu").className).toContain("opacity-60");
    slot.unmount();
  });

  it("panel overview turns stale on a local tick while the RPC hangs", async () => {
    vi.useFakeTimers();
    const hanging = hangingAfterFirstOverview();
    const slot = renderPanel({
      ...defaultRpc(),
      overview: hanging.overview as unknown as () => unknown,
    });
    await flushMicrotasks();
    expect(slot.getByTestId("pc-overview-freshness").dataset.state).toBe(
      "fresh",
    );
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(slot.getByTestId("pc-overview-freshness").dataset.state).toBe(
      "stale",
    );
    expect(slot.getByTestId("pc-overview-values").className).toContain(
      "opacity-60",
    );
    expect(slot.getByTestId("pc-ring-cpu").textContent).toContain("38%");
    slot.unmount();
  });

  it("panel dims last values and keeps the banner on refresh error", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const slot = renderPanel({
      ...defaultRpc(),
      overview: () => {
        calls += 1;
        if (calls === 1) {
          return {
            host: { id: "host_1", name: "Office PC", status: "connected" },
            snapshot: SNAPSHOT,
            error: null,
          };
        }
        return {
          host: { id: "host_1", name: "Office PC", status: "connected" },
          snapshot: null,
          error: "daemon unreachable",
        };
      },
    });
    await flushMicrotasks();
    expect(slot.getByTestId("pc-overview-freshness").dataset.state).toBe(
      "fresh",
    );
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(slot.getByTestId("pc-overview-error").textContent).toContain(
      "daemon unreachable",
    );
    expect(slot.getByTestId("pc-overview-freshness").dataset.state).toBe(
      "error",
    );
    expect(slot.getByTestId("pc-overview-values").className).toContain(
      "opacity-60",
    );
    expect(slot.getByTestId("pc-ring-memory").textContent).toContain("75%");
    slot.unmount();
  });
});

describe("PC Control programs tab", () => {
  it("renders profiles with running status and pid", async () => {
    const slot = renderPanel();
    fireEvent.click(slot.getByTestId("pc-tab-apps"));
    expect(await slot.findByText("Tool")).toBeTruthy();
    expect(
      slot.getByTestId("pc-profile-status-pcp_tool123").textContent,
    ).toContain("555");
    expect(slot.getByText(/--port 8080/u)).toBeTruthy();
    slot.unmount();
  });

  it("requires confirmation before stopping a profile", async () => {
    const stopProfile = vi.fn(() => ({ stoppedCount: 1 }));
    const slot = renderPanel({
      ...defaultRpc(),
      stopProfile,
    });
    fireEvent.click(slot.getByTestId("pc-tab-apps"));
    await slot.findByText("Tool");
    fireEvent.click(slot.getByTestId("pc-profile-stop-pcp_tool123"));
    expect(await screen.findByTestId("pc-confirm-dialog")).toBeTruthy();
    expect(stopProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("pc-confirm-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("pc-confirm-dialog")).toBeNull();
    });
    expect(stopProfile).not.toHaveBeenCalled();
    fireEvent.click(slot.getByTestId("pc-profile-stop-pcp_tool123"));
    await screen.findByTestId("pc-confirm-dialog");
    fireEvent.click(screen.getByTestId("pc-confirm-accept"));
    await waitFor(() => {
      expect(stopProfile).toHaveBeenCalledWith({ id: "pcp_tool123" });
    });
    slot.unmount();
  });

  it("creates a profile through the editor", async () => {
    const saveProfile = vi.fn(() => ({ profile: PROFILE }));
    const slot = renderPanel({
      ...defaultRpc(),
      saveProfile,
    });
    fireEvent.click(slot.getByTestId("pc-tab-apps"));
    await slot.findByText("Tool");
    fireEvent.click(slot.getByTestId("pc-profile-add"));
    const editor = await slot.findByTestId("pc-profile-editor");
    expect(editor).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Name"), {
      target: { value: "Editor app" },
    });
    fireEvent.change(slot.getByLabelText(/Executable/u), {
      target: { value: "C:\\Apps\\Editor\\editor.exe" },
    });
    fireEvent.change(slot.getByLabelText(/Arguments/u), {
      target: { value: '["--verbose"]' },
    });
    fireEvent.click(slot.getByTestId("pc-profile-save"));
    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith({
        name: "Editor app",
        exePath: "C:\\Apps\\Editor\\editor.exe",
        args: ["--verbose"],
      });
    });
    slot.unmount();
  });

  it("rejects malformed arguments text", async () => {
    const saveProfile = vi.fn();
    const slot = renderPanel({
      ...defaultRpc(),
      saveProfile,
    });
    fireEvent.click(slot.getByTestId("pc-tab-apps"));
    await slot.findByText("Tool");
    fireEvent.click(slot.getByTestId("pc-profile-add"));
    fireEvent.change(slot.getByLabelText("Name"), {
      target: { value: "Broken" },
    });
    fireEvent.change(slot.getByLabelText(/Executable/u), {
      target: { value: "C:\\Apps\\Broken\\broken.exe" },
    });
    fireEvent.change(slot.getByLabelText(/Arguments/u), {
      target: { value: "not json" },
    });
    fireEvent.click(slot.getByTestId("pc-profile-save"));
    expect(await slot.findByTestId("pc-profile-form-error")).toBeTruthy();
    expect(saveProfile).not.toHaveBeenCalled();
    slot.unmount();
  });

  it("starts and restarts from the profile row", async () => {
    const startProfile = vi.fn(() => ({ pid: 42 }));
    const restartProfile = vi.fn(() => ({ pid: 43 }));
    const slot = renderPanel({
      ...defaultRpc(),
      startProfile,
      restartProfile,
    });
    fireEvent.click(slot.getByTestId("pc-tab-apps"));
    await slot.findByText("Tool");
    expect(slot.getByTestId("pc-profile-start-pcp_tool123")).toBeTruthy();
    fireEvent.click(slot.getByTestId("pc-profile-restart-pcp_tool123"));
    expect(await screen.findByTestId("pc-confirm-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pc-confirm-accept"));
    await waitFor(() => {
      expect(restartProfile).toHaveBeenCalledWith({ id: "pcp_tool123" });
    });
    slot.unmount();
  });
});
