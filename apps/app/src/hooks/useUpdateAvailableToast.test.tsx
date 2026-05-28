// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopApi,
  BbDesktopInfo,
  BbDesktopInfoChangeHandler,
  SystemVersionResponse,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

interface CapturedToastButton {
  label: string;
  onClick: () => void;
}

interface CapturedToastProps {
  action?: CapturedToastButton;
  cancel?: CapturedToastButton;
  description?: ReactNode;
  title: ReactNode;
}

interface CapturedToastOptions {
  id: string;
  onDismiss?: () => void;
}

interface CapturedToastInvocation {
  options: CapturedToastOptions;
  props: CapturedToastProps;
}

interface SonnerToastToDismiss {
  id: string | number;
}

type CapturedOnDismiss = (toast: SonnerToastToDismiss) => void;

interface SonnerCustomOptions {
  id?: string | number;
  onDismiss?: CapturedOnDismiss;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

const sonnerToastState = vi.hoisted(() => {
  const activeToasts = new Map<string | number, SonnerCustomToast>();
  const invocations: SonnerCustomToast[] = [];
  const toCapturedOptions = (
    options: SonnerCustomOptions | undefined,
    fallbackId: string,
  ): CapturedToastOptions => ({
    id:
      typeof options?.id === "string" || typeof options?.id === "number"
        ? String(options.id)
        : fallbackId,
    ...(options?.onDismiss
      ? { onDismiss: () => options.onDismiss?.({ id: fallbackId }) }
      : {}),
  });
  return {
    activeToasts,
    dismiss: vi.fn((id?: string | number) => {
      if (id === undefined) {
        activeToasts.clear();
        return;
      }
      const toast = activeToasts.get(id);
      activeToasts.delete(id);
      toast?.options.onDismiss?.();
    }),
    invocations,
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const capturedOptions = toCapturedOptions(options, fallbackId);
        const toast = {
          options: capturedOptions,
          renderToast,
        };
        invocations.push(toast);
        activeToasts.set(capturedOptions.id, toast);
        return capturedOptions.id;
      },
    ),
  };
});

vi.mock("sonner", () => ({
  toast: {
    custom: sonnerToastState.custom,
    dismiss: sonnerToastState.dismiss,
  },
}));

function readToastInvocation(callIndex: number): CapturedToastInvocation {
  const invocation = sonnerToastState.invocations.at(callIndex);
  if (!invocation) {
    throw new Error(`No toast call at index ${callIndex}`);
  }
  const element = invocation.renderToast(invocation.options.id);
  if (!isValidElement<CapturedToastProps>(element)) {
    throw new Error("Expected app toast content element.");
  }
  return {
    options: invocation.options,
    props: element.props,
  };
}

function resetSonnerToastState(): void {
  sonnerToastState.activeToasts.clear();
  sonnerToastState.invocations.splice(0);
  sonnerToastState.custom.mockClear();
  sonnerToastState.dismiss.mockClear();
}

interface DesktopApiStub {
  api: BbDesktopApi;
  emit(info: BbDesktopInfo): void;
  installUpdateCallCount(): number;
}

function requireToastAction(
  invocation: CapturedToastInvocation,
): CapturedToastButton {
  const action = invocation.props.action;
  if (!action) {
    throw new Error("Expected toast action.");
  }
  return action;
}

function requireToastCancel(
  invocation: CapturedToastInvocation,
): CapturedToastButton {
  const cancel = invocation.props.cancel;
  if (!cancel) {
    throw new Error("Expected toast cancel action.");
  }
  return cancel;
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
    setTheme() {
      // no-op
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
  resetSonnerToastState();
  vi.unstubAllGlobals();
  delete window.bbDesktop;
  window.localStorage.clear();
  vi.resetModules();
});

describe("useUpdateAvailableToast", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.bbDesktop;
    resetSonnerToastState();
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

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalledTimes(1);
    });
    const invocation = readToastInvocation(0);
    expect(invocation.props.title).toBe("bb-app update available");
    expect(invocation.props.description).toBe(
      "0.0.6 is available. Restart bb-app to update.",
    );
    expect(invocation.options.id).toBe("bb-update-available:0.0.6");
    expect(requireToastCancel(invocation).label).toBe("Dismiss");
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
    expect(sonnerToastState.custom).not.toHaveBeenCalled();
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
    expect(sonnerToastState.custom).not.toHaveBeenCalled();
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
    expect(sonnerToastState.custom).not.toHaveBeenCalled();
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
    expect(sonnerToastState.custom).not.toHaveBeenCalled();
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

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalledTimes(1);
    });
    const invocation = readToastInvocation(0);
    requireToastCancel(invocation).onClick();
    expect(window.localStorage.getItem("bb:update-toast:dismissed:0.0.6")).toBe(
      "true",
    );
    expect(sonnerToastState.dismiss).toHaveBeenCalledWith(
      "bb-update-available:0.0.6",
    );
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

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalledTimes(1);
    });
    const invocation = readToastInvocation(0);
    expect(invocation.props.title).toBe("bb-app update available");
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

      await waitFor(() =>
        expect(sonnerToastState.custom).toHaveBeenCalledTimes(1),
      );
      const invocation = readToastInvocation(0);
      // Dismiss must not throw even though setItem will throw.
      expect(() => requireToastCancel(invocation).onClick()).not.toThrow();
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
    resetSonnerToastState();
    delete window.bbDesktop;
  });

  it("does not show a desktop toast before the update has downloaded", async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sonnerToastState.custom).not.toHaveBeenCalled();
  });

  it("shows a relaunch CTA when a desktop update has downloaded", async () => {
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

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalledTimes(1);
    });
    const invocation = readToastInvocation(0);
    expect(invocation.props.title).toBe("Desktop update ready");
    expect(invocation.props.description).toBe(
      "bb desktop 0.0.2 is ready to install.",
    );
    expect(invocation.options.id).toBe("bb-desktop-update-ready:0.0.2");
    expect(invocation.props.cancel).toBeUndefined();
    expect(requireToastAction(invocation).label).toBe("Relaunch");

    requireToastAction(invocation).onClick();

    expect(desktopStub.installUpdateCallCount()).toBe(1);
    expect(sonnerToastState.dismiss).toHaveBeenCalledWith(
      "bb-desktop-update-ready:0.0.2",
    );
  });

  it("shows the desktop toast after a downloaded update arrives through the preload subscription", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sonnerToastState.custom).not.toHaveBeenCalled();

    desktopStub.emit({
      lastCheckedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "0.0.3",
      pendingVersion: "0.0.3",
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: true,
      version: "0.0.1",
    });

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalledTimes(1);
    });
    const invocation = readToastInvocation(0);
    expect(invocation.props.title).toBe("Desktop update ready");
    expect(invocation.options.id).toBe("bb-desktop-update-ready:0.0.3");
  });

  it("does not show the desktop toast when the preload global is absent", async () => {
    const { useDesktopUpdateAvailableToast } = await loadHook();
    renderHook(() => useDesktopUpdateAvailableToast());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sonnerToastState.custom).not.toHaveBeenCalled();
  });
});
