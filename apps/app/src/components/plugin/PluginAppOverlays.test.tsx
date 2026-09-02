// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  useBbContext,
  useBbNavigate,
  useRpc,
  useSettings,
} from "@/lib/plugin-sdk-hooks";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginAppOverlays } from "./PluginAppOverlays";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function PortaledProbe() {
  const context = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc();
  const settings = useSettings();
  const [rpcResult, setRpcResult] = useState("idle");

  return (
    <div>
      <div data-testid="overlay-context">
        {context.projectId}/{context.threadId}
      </div>
      <div data-testid="overlay-settings">
        {settings.isLoading ? "loading" : settings.values?.mode}
      </div>
      <div data-testid="overlay-rpc">{rpcResult}</div>
      <button
        type="button"
        onClick={() => {
          void rpc.call("ping").then((result) => setRpcResult(String(result)));
        }}
      >
        Call RPC
      </button>
      <button type="button" onClick={() => navigate.toCompose()}>
        Go home
      </button>
    </div>
  );
}

function PortaledOverlay() {
  return createPortal(<PortaledProbe />, document.body);
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PluginAppOverlays", () => {
  it("keeps plugin, query, and router contexts through a React portal", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/settings")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, values: { mode: "floating" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: "pong" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    setPluginSlotRegistrations(
      "office",
      registrationSet({
        appOverlays: [{ id: "widget", component: PortaledOverlay }],
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/projects/proj_1/threads/thr_1"]}>
          <PluginAppOverlays />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("overlay-context").textContent).toBe(
      "proj_1/thr_1",
    );
    expect(await screen.findByText("floating")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Call RPC" }));
    expect(await screen.findByText("pong")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/office/rpc/ping",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Go home" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(screen.getByTestId("overlay-rpc").textContent).toBe("pong");
  });

  it("hides a crashing overlay without unmounting additive siblings", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("overlay crashed");
    }
    function Fine() {
      return <div>fine overlay</div>;
    }
    setPluginSlotRegistrations(
      "broken",
      registrationSet({
        appOverlays: [{ id: "broken", component: Crashes }],
      }),
    );
    setPluginSlotRegistrations(
      "fine",
      registrationSet({
        appOverlays: [{ id: "fine", component: Fine }],
      }),
    );

    render(
      <MemoryRouter>
        <PluginAppOverlays />
      </MemoryRouter>,
    );

    expect(screen.getByText("fine overlay")).toBeDefined();
    expect(screen.queryByText("plugin broken crashed")).toBeNull();
  });
});
