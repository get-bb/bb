// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopApi,
  BbDesktopInfo,
  BbDesktopInfoChangeHandler,
  SystemVersionResponse,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

const { toastFn, toastDismissFn } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  toastDismissFn: vi.fn(),
}));

vi.mock("sonner", () => {
  const toast = Object.assign(toastFn, { dismiss: toastDismissFn });
  return { toast };
});

interface CapturedToastInvocation {
  message: string;
  options: {
    id: string;
    description: string;
    action: { label: string; onClick: () => void };
    onDismiss?: () => void;
  };
}

interface DesktopApiStub {
  api: BbDesktopApi;
  emit(info: BbDesktopInfo): void;
  installUpdateCallCount(): number;
}

function readToastInvocation(callIndex: number): CapturedToastInvocation {
  const call = toastFn.mock.calls.at(callIndex);
  if (!call) {
    throw new Error(`No toast call at index ${callIndex}`);
  }
  const [message, options] = call as [
    string,
    CapturedToastInvocation["options"],
  ];
  return { message, options };
}

function stubFetchOnce(response: SystemVersionResponse): void {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify(response), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
}

async function loadHook() {
  const { useDesktopUpdateAvailableToast, useUpdateAvailableToast } =
    await import("./useUpdateAvailableToast");
  return { useDesktopUpdateAvailableToast, useUpdateAvailableToast };
}

function createDesktopApiStub(initialInfo: BbDesktopInfo): DesktopApiStub {
  let currentInfo = initialInfo;
  let installUpdateCalls = 0;
  const listeners = new Set<BbDesktopInfoChangeHandler>();
  const api: BbDesktopApi = {
    get lastCheckedAt() {
      return currentInfo.lastCheckedAt;
    },
    get latestVersion() {
      return currentInfo.latestVersion;
    },
    get pendingVersion() {
      return currentInfo.pendingVersion;
    },
    platform: "macos",
    get updateAvailable() {
      return currentInfo.updateAvailable;
    },
    get updateDownloaded() {
      return currentInfo.updateDownloaded;
    },
    get version() {
      return currentInfo.version;
    },
    async checkForUpdates() {
      return currentInfo;
    },
    async getInfo() {
      return currentInfo;
    },
    async installUpdate() {
      installUpdateCalls += 1;
    },
    onChange(listener: BbDesktopInfoChangeHandler) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    api,
    emit(info: BbDesktopInfo) {
      currentInfo = info;
      for (const listener of listeners) {
        listener(currentInfo);
      }
    },
    installUpdateCallCount() {
      return installUpdateCalls;
    },
  };
}

afterEach(() => {
  cleanup();
  toastFn.mockReset();
  toastDismissFn.mockReset();
  vi.unstubAllGlobals();
  delete window.bbDesktop;
  window.localStorage.clear();
  vi.resetModules();
});

describe("useUpdateAvailableToast", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.bbDesktop;
    toastFn.mockReset();
    toastDismissFn.mockReset();
  });

  it("shows the toast when an update is available and not yet dismissed", async () => {
    stubFetchOnce({
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    expect(invocation.message).toBe("Update available: bb-app 0.0.6");
    expect(invocation.options.description).toContain("npx bb-app@latest");
    expect(invocation.options.id).toBe("bb-update-available:0.0.6");
    expect(invocation.options.action.label).toBe("Dismiss");
  });

  it("does not show the toast inside the bb desktop app", async () => {
    const desktopStub = createDesktopApiStub({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });
    window.bbDesktop = desktopStub.api;
    stubFetchOnce({
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("never shows the toast in development mode", async () => {
    stubFetchOnce({
      currentVersion: "0.0.0-dev",
      latestVersion: null,
      source: "npm",
      updateAvailable: false,
      isDevelopment: true,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("does not show the toast when updateAvailable is false", async () => {
    stubFetchOnce({
      currentVersion: "0.0.6",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: false,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("respects an existing dismissal for the same latest version", async () => {
    window.localStorage.setItem("bb:update-toast:dismissed:0.0.6", "true");
    stubFetchOnce({
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("persists the dismissal in localStorage when the user clicks Dismiss", async () => {
    stubFetchOnce({
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    invocation.options.action.onClick();
    expect(window.localStorage.getItem("bb:update-toast:dismissed:0.0.6")).toBe(
      "true",
    );
    expect(toastDismissFn).toHaveBeenCalledWith("bb-update-available:0.0.6");
  });

  it("shows the toast again when npm reports a newer version after a prior dismissal", async () => {
    window.localStorage.setItem("bb:update-toast:dismissed:0.0.6", "true");
    stubFetchOnce({
      currentVersion: "0.0.5",
      latestVersion: "0.0.7",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });
    const { useUpdateAvailableToast } = await loadHook();
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useUpdateAvailableToast(), { wrapper });

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    expect(invocation.message).toBe("Update available: bb-app 0.0.7");
  });

  it("fails open when localStorage throws on read and write", async () => {
    const originalGetItem = window.localStorage.getItem.bind(
      window.localStorage,
    );
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    const getItemSpy = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("private mode: getItem disabled");
      });
    const setItemSpy = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("private mode: setItem disabled");
      });

    try {
      stubFetchOnce({
        currentVersion: "0.0.5",
        latestVersion: "0.0.6",
        source: "npm",
        updateAvailable: true,
        isDevelopment: false,
        upgradeCommand: "npx bb-app@latest",
      });
      const { useUpdateAvailableToast } = await loadHook();
      const { wrapper } = createQueryClientTestHarness();
      renderHook(() => useUpdateAvailableToast(), { wrapper });

      await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
      const invocation = readToastInvocation(0);
      // Dismiss must not throw even though setItem will throw.
      expect(() => invocation.options.action.onClick()).not.toThrow();
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
      window.localStorage.getItem = originalGetItem;
      window.localStorage.setItem = originalSetItem;
    }
  });
});

describe("useDesktopUpdateAvailableToast", () => {
  beforeEach(() => {
    window.localStorage.clear();
    toastFn.mockReset();
    toastDismissFn.mockReset();
    delete window.bbDesktop;
  });

  it("shows the desktop toast when an update is available and not yet dismissed", async () => {
    const desktopInfo: BbDesktopInfo = {
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    };
    const desktopStub = createDesktopApiStub(desktopInfo);
    window.bbDesktop = desktopStub.api;

    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    expect(invocation.message).toBe("Desktop update available");
    expect(invocation.options.description).toBe(
      "bb desktop 0.0.2 is available",
    );
    expect(invocation.options.id).toBe("bb-desktop-update-available:0.0.2");
    expect(invocation.options.action.label).toBe("Dismiss");
  });

  it("shows a restart CTA when a desktop update has downloaded", async () => {
    const desktopStub = createDesktopApiStub({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.2",
      pendingVersion: "0.0.2",
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: true,
      version: "0.0.1",
    });
    window.bbDesktop = desktopStub.api;

    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    expect(invocation.message).toBe("Desktop update ready");
    expect(invocation.options.description).toBe(
      "bb desktop 0.0.2 is ready to install",
    );
    expect(invocation.options.id).toBe("bb-desktop-update-ready:0.0.2");
    expect(invocation.options.action.label).toBe("Restart");

    invocation.options.action.onClick();

    expect(desktopStub.installUpdateCallCount()).toBe(1);
    expect(toastDismissFn).toHaveBeenCalledWith(
      "bb-desktop-update-ready:0.0.2",
    );
  });

  it("respects an existing desktop dismissal for the same latest version", async () => {
    window.localStorage.setItem(
      "bb:desktop-update-toast:dismissed:0.0.2",
      "true",
    );
    const desktopStub = createDesktopApiStub({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });
    window.bbDesktop = desktopStub.api;

    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("shows the desktop toast for a newer version after a prior dismissal", async () => {
    window.localStorage.setItem(
      "bb:desktop-update-toast:dismissed:0.0.2",
      "true",
    );
    const desktopStub = createDesktopApiStub({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.3",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });
    window.bbDesktop = desktopStub.api;

    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    expect(invocation.options.id).toBe("bb-desktop-update-available:0.0.3");
    expect(invocation.message).toBe("Desktop update available");
  });

  it("persists the desktop dismissal when the user clicks Dismiss", async () => {
    const desktopStub = createDesktopApiStub({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });
    window.bbDesktop = desktopStub.api;

    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    invocation.options.action.onClick();
    expect(
      window.localStorage.getItem("bb:desktop-update-toast:dismissed:0.0.2"),
    ).toBe("true");
    expect(toastDismissFn).toHaveBeenCalledWith(
      "bb-desktop-update-available:0.0.2",
    );
  });

  it("shows the desktop toast when an update arrives through the preload subscription", async () => {
    const desktopStub = createDesktopApiStub({
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.1",
    });
    window.bbDesktop = desktopStub.api;

    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());
    await new Promise((resolve) => setTimeout(resolve, 0));

    desktopStub.emit({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.3",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    const invocation = readToastInvocation(0);
    expect(invocation.message).toBe("Desktop update available");
    expect(invocation.options.id).toBe("bb-desktop-update-available:0.0.3");
  });

  it("does not show the desktop toast when the preload global is absent", async () => {
    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastFn).not.toHaveBeenCalled();
  });
});
