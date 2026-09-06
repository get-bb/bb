// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import type {
  ExperimentalBrowserControllerLifecycle,
  ExperimentalBrowserControllerProps,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import { PluginBrowserControllers } from "./PluginBrowserControllers";
const controllerClient = vi.hoisted(() => ({
  handlers: new Set<
    Parameters<
      ExperimentalBrowserControllerProps["experimental_registerRequestHandler"]
    >[0]
  >(),
  disposedListeners: new Set<
    (reason: "tab-closed" | "client-disconnected") => void
  >(),
  registerBrowserCapture: vi.fn(),
  reconnectedListeners: new Set<() => void>(),
  registerRequestHandler: vi.fn(
    (
      _pluginId: string,
      _controllerId: string,
      _tabId: string,
      handler: Parameters<
        ExperimentalBrowserControllerProps["experimental_registerRequestHandler"]
      >[0],
    ) => {
      controllerClient.handlers.add(handler);
      return () => controllerClient.handlers.delete(handler);
    },
  ),
}));

vi.mock("@/lib/browser-control-client", () => ({
  browserControlClientIdentity: () => ({
    clientId: "client-1",
    windowId: "window-1",
  }),
  registerBrowserCapture: controllerClient.registerBrowserCapture,
  registerBrowserControllerRequestHandler:
    controllerClient.registerRequestHandler,
  subscribeBrowserControllerDisposed: (
    _tabId: string,
    _threadId: string,
    _environmentId: string | null,
    _pluginId: string,
    listener: (reason: "tab-closed" | "client-disconnected") => void,
  ) => {
    controllerClient.disposedListeners.add(listener);
    return () => controllerClient.disposedListeners.delete(listener);
  },
  subscribeBrowserControllerReconnected: (listener: () => void) => {
    controllerClient.reconnectedListeners.add(listener);
    return () => controllerClient.reconnectedListeners.delete(listener);
  },
}));

const lifecycleEvents: ExperimentalBrowserControllerLifecycle[] = [];
let lifecycleSignals: AbortSignal[] = [];

function TestBrowserController({
  experimental_lifecycleSignal,
  experimental_onLifecycle,
  experimental_registerRequestHandler,
}: ExperimentalBrowserControllerProps) {
  const [draft, setDraft] = useState("");
  useEffect(
    () =>
      experimental_onLifecycle((event) => {
        lifecycleEvents.push(event);
      }),
    [experimental_onLifecycle],
  );
  useEffect(() => {
    lifecycleSignals.push(experimental_lifecycleSignal);
    return experimental_registerRequestHandler(async () => null);
  }, [experimental_lifecycleSignal, experimental_registerRequestHandler]);
  return (
    <input
      aria-label="Controller draft"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

function renderControllers(navigationEpoch: number, url: string) {
  return render(
    <PluginBrowserControllers
      desktopBrowser={createNoopDesktopBrowserApi()}
      environmentId="environment-1"
      threadId="thread-1"
      projectId="project-1"
      tabId="tab-1"
      navigationEpoch={navigationEpoch}
      url={url}
      isVisible
      overlayRoot={null}
      onOverlayLeaseChange={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  controllerClient.disposedListeners.clear();
  controllerClient.reconnectedListeners.clear();
  controllerClient.registerRequestHandler.mockClear();
  controllerClient.registerBrowserCapture.mockClear();
  controllerClient.handlers.clear();
  lifecycleEvents.length = 0;
  lifecycleSignals = [];
  vi.restoreAllMocks();
});

describe("PluginBrowserControllers", () => {
  it("releases overlays and cancels work despite throwing lifecycle listeners", () => {
    const scopes: ExperimentalBrowserControllerProps[] = [];
    const leases = new Set<symbol>();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onOverlayLeaseChange = (owner: symbol, open: boolean) => {
      if (open) leases.add(owner);
      else leases.delete(owner);
    };
    function FaultyController(props: ExperimentalBrowserControllerProps) {
      scopes.push(props);
      useEffect(() => props.experimental_onLifecycle(() => {
        throw new Error("Plugin lifecycle failed");
      }), [props.experimental_onLifecycle]);
      return <button onClick={() => props.experimental_setOverlayOpen(true)}>Open overlay</button>;
    }
    setPluginSlotRegistrations("plugin-1", makePluginRegistrationSet({
      browserControllers: [{ id: "controller-1", component: FaultyController }],
    }));
    const surface = (navigationEpoch: number) => (
      <PluginBrowserControllers
        desktopBrowser={createNoopDesktopBrowserApi()}
        environmentId="environment-1"
        threadId="thread-1"
        projectId="project-1"
        tabId="tab-1"
        navigationEpoch={navigationEpoch}
        url="https://example.com/"
        isVisible
        overlayRoot={null}
        onOverlayLeaseChange={onOverlayLeaseChange}
      />
    );
    const view = render(surface(1));
    const previous = scopes.at(-1);
    if (previous === undefined) throw new Error("Missing initial controller");
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(leases.size).toBe(1);
    view.rerender(surface(2));
    expect(leases.size).toBe(0);
    expect(previous.experimental_lifecycleSignal.aborted).toBe(true);
    expect(() => previous.experimental_setOverlayOpen(true)).toThrow();
    const current = scopes.at(-1);
    if (current === undefined) throw new Error("Missing current controller");
    expect(current.target?.navigationEpoch).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(leases.size).toBe(1);
    act(() => {
      for (const listener of controllerClient.disposedListeners) listener("client-disconnected");
    });
    expect(leases.size).toBe(0);
    expect(current.experimental_lifecycleSignal.aborted).toBe(true);
    expect(() => current.experimental_setOverlayOpen(true)).toThrow();
    expect(leases.size).toBe(0);
  });
  it("binds generated image resources to the active controller target", async () => {
    function ImageController(props: ExperimentalBrowserControllerProps) {
      useEffect(() => {
        void props.experimental_createImageResource({
          blob: new Blob(["image"], { type: "image/png" }),
          pixelSize: { width: 2, height: 3 },
        });
      }, [props.experimental_createImageResource]);
      return null;
    }
    setPluginSlotRegistrations(
      "plugin-1",
      makePluginRegistrationSet({
        browserControllers: [{ id: "controller-1", component: ImageController }],
      }),
    );
    renderControllers(1, "https://example.com/one");

    await vi.waitFor(() =>
      expect(controllerClient.registerBrowserCapture).toHaveBeenCalledWith(
        expect.any(Blob),
        {
          target: {
            clientId: "client-1",
            windowId: "window-1",
            tabId: "tab-1",
            navigationEpoch: 1,
          },
          pixelSize: { width: 2, height: 3 },
          signal: expect.any(AbortSignal),
        },
      ),
    );
  });

  it("preserves controller drafts and emits one navigation for a new page revision", () => {
    setPluginSlotRegistrations(
      "plugin-1",
      makePluginRegistrationSet({
        browserControllers: [
          { id: "controller-1", component: TestBrowserController },
        ],
      }),
    );
    const view = renderControllers(1, "https://example.com/one");

    fireEvent.change(screen.getByLabelText("Controller draft"), {
      target: { value: "keep this draft" },
    });
    view.rerender(
      <PluginBrowserControllers
        desktopBrowser={createNoopDesktopBrowserApi()}
        environmentId="environment-1"
        threadId="thread-1"
        projectId="project-1"
        tabId="tab-1"
        navigationEpoch={2}
        url="https://example.com/two"
        isVisible
        overlayRoot={null}
        onOverlayLeaseChange={() => {}}
      />,
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("Controller draft").value,
    ).toBe("keep this draft");
    expect(lifecycleEvents).toEqual([
      {
        kind: "navigation",
        previousTarget: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 1,
        },
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 2,
        },
        url: "https://example.com/two",
      },
    ]);
  });

  it("does not revive a terminally disposed controller on reconnect", () => {
    setPluginSlotRegistrations(
      "plugin-1",
      makePluginRegistrationSet({
        browserControllers: [
          { id: "controller-1", component: TestBrowserController },
        ],
      }),
    );
    renderControllers(1, "https://example.com/one");
    const initialSignal = lifecycleSignals.at(-1);
    if (initialSignal === undefined)
      throw new Error("Expected lifecycle signal");

    act(() => {
      for (const listener of controllerClient.disposedListeners) {
        listener("tab-closed");
      }
      for (const listener of controllerClient.reconnectedListeners) listener();
    });

    expect(initialSignal.aborted).toBe(true);
    expect(lifecycleSignals).toHaveLength(1);
    expect(lifecycleEvents).toEqual([
      {
        kind: "disposed",
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 1,
        },
        reason: "tab-closed",
      },
    ]);
  });

  it("rebinds a fresh lifecycle and handler after reconnect", async () => {
    setPluginSlotRegistrations(
      "plugin-1",
      makePluginRegistrationSet({
        browserControllers: [
          { id: "controller-1", component: TestBrowserController },
        ],
      }),
    );
    renderControllers(1, "https://example.com/one");
    const initialSignal = lifecycleSignals.at(-1);
    if (initialSignal === undefined)
      throw new Error("Expected lifecycle signal");
    const oldHandler = [...controllerClient.handlers][0]!;
    const request = {
      target: {
        clientId: "client-1",
        windowId: "window-1",
        tabId: "tab-1",
        navigationEpoch: 1,
      },
      input: null,
      signal: new AbortController().signal,
    };

    act(() => {
      for (const listener of controllerClient.disposedListeners) {
        listener("client-disconnected");
      }
      for (const listener of controllerClient.reconnectedListeners) listener();
    });

    expect(initialSignal.aborted).toBe(true);
    expect(lifecycleSignals).toHaveLength(2);
    expect(lifecycleSignals.at(-1)).not.toBe(initialSignal);
    await expect(oldHandler(request)).rejects.toMatchObject({
      name: "AbortError",
    });
    const currentHandler = [...controllerClient.handlers][0]!;
    await expect(currentHandler(request)).resolves.toBeNull();
  });
});
