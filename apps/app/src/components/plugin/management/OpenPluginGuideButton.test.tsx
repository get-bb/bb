// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { OpenPluginGuideButton } from "./OpenPluginGuideButton";

const GUIDE: InstalledPlugin = {
  id: "plugin-api-docs",
  source: "builtin:plugin-api-docs",
  rootDir: "/plugins/plugin-api-docs",
  version: "1.0.0",
  provenance: "builtin",
  publisherLabel: "BB Official",
  isOrphanedBuiltin: false,
  sourceDisplay: "Included with BB",
  updateState: {},
  enabled: false,
  description: "Explore the plugin API",
  name: "Plugin Guide",
  screenshots: [],
  collections: [],
  icon: null,
  iconUrl: null,
  status: "disabled",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
  providerIds: [],
  icons: {},
};

const GUIDE_ENTRY: PluginCatalogSearchEntry = {
  entryId: GUIDE.id,
  pluginId: GUIDE.id,
  displayName: "Plugin Guide",
  description: "Explore the plugin API",
  source: GUIDE.source,
  marketplace: "bb-official",
  marketplaceDisplayName: "BB Official",
  publisherKey: "bb-official",
  publisherLabel: "BB Official",
  official: true,
  author: { name: "BB", github: "get-bb", url: "https://github.com/get-bb" },
  icon: null,
  iconUrl: null,
  iconTinted: false,
  screenshots: [],
  collections: [],
  repositoryUrl: null,
  installed: false,
  installs: null,
  compatible: true,
  incompatibleReason: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderGuide() {
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={["/plugins"]}>
      <OpenPluginGuideButton />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
  return screen.getByRole("button", { name: "Plugin Guide" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenPluginGuideButton", () => {
  it("enables a disabled Guide before navigating and prevents duplicate requests", async () => {
    const enabled = { ...GUIDE, enabled: true, status: "running" };
    let finishEnable: (response: Response) => void = () => undefined;
    const enableResponse = new Promise<Response>((resolve) => {
      finishEnable = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/enable")
        ? enableResponse
        : Promise.resolve(jsonResponse({ plugins: [GUIDE] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const button = renderGuide();
    fireEvent.click(button);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/plugins/plugin-api-docs/enable",
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    finishEnable(jsonResponse({ ok: true, plugin: enabled }));
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
  });

  it("opens an enabled Guide without enabling or reloading it", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        plugins: [{ ...GUIDE, enabled: true, status: "running" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide());
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays on Browse after an enable failure and allows retry", async () => {
    const toast = vi.spyOn(appToast, "error").mockReturnValue("toast");
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).endsWith("/enable")) {
          return jsonResponse({ plugins: [GUIDE] });
        }
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: "Service unavailable" }, 503)
          : jsonResponse({
              ok: true,
              plugin: { ...GUIDE, enabled: true, status: "running" },
            });
      }),
    );
    const button = renderGuide();
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Could not open Plugin Guide", {
        description: "Service unavailable",
      }),
    );
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    await vi.waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
    expect(attempts).toBe(2);
  });

  it("offers the existing install dialog when Guide is absent and cancels without a write", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/v1/plugin-catalog/search")
        ? jsonResponse({ results: [GUIDE_ENTRY], collections: [] })
        : jsonResponse({ plugins: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide());
    expect(
      await screen.findByRole("dialog", { name: "Install Plugin Guide?" }),
    ).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("installs the official listing after confirmation and opens Guide after success", async () => {
    let finishInstall: (response: Response) => void = () => undefined;
    const installResponse = new Promise<Response>((resolve) => {
      finishInstall = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/plugin-catalog/install") return installResponse;
      return Promise.resolve(
        url.startsWith("/api/v1/plugin-catalog/search")
          ? jsonResponse({ results: [GUIDE_ENTRY], collections: [] })
          : jsonResponse({ plugins: [] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide());
    const install = await screen.findByRole("button", {
      name: "Install Plugin Guide",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(install);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/plugin-catalog/install");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      entryId: "plugin-api-docs",
      marketplace: "bb-official",
    });
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    finishInstall(
      jsonResponse({
        ok: true,
        plugin: { ...GUIDE, enabled: true, status: "running" },
      }),
    );
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
