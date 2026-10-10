// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { pluginInstallJobsQueryKey } from "@/hooks/queries/query-keys";
import { LocationProbe } from "@/test/location-probe";
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
  conflictingInstallSource: null,
  installedByDefault: false,
  installs: null,
  compatible: true,
  incompatibleReason: null,
};

function renderGuide() {
  const { wrapper, queryClient } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={["/plugins"]}>
      <OpenPluginGuideButton />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
  return {
    button: screen.getByRole("button", { name: "Plugin Guide" }),
    queryClient,
  };
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
        : Promise.resolve(Response.json({ plugins: [GUIDE] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { button } = renderGuide();
    fireEvent.click(button);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/plugins/plugin-api-docs/enable",
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    finishEnable(Response.json({ ok: true, plugin: enabled }));
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
  });

  it("opens an enabled Guide without enabling or reloading it", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        plugins: [{ ...GUIDE, enabled: true, status: "running" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide().button);
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
          return Response.json({ plugins: [GUIDE] });
        }
        attempts += 1;
        return attempts === 1
          ? Response.json({ error: "Service unavailable" }, { status: 503 })
          : Response.json({
              ok: true,
              plugin: { ...GUIDE, enabled: true, status: "running" },
            });
      }),
    );
    const { button } = renderGuide();
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
        ? Response.json({ results: [GUIDE_ENTRY], collections: [] })
        : Response.json({ plugins: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide().button);
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

  it("installs the official listing after confirmation and opens Guide once the install succeeds", async () => {
    const job = {
      id: "job-guide",
      target: {
        kind: "catalog",
        entryId: "plugin-api-docs",
        marketplace: "bb-official",
      },
      displayName: "Plugin Guide",
    };
    let finishInstall: (response: Response) => void = () => undefined;
    const finishedJobs = new Promise<Response>((resolve) => {
      finishInstall = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/plugin-catalog/install") {
        return Promise.resolve(
          Response.json(
            { ok: true, job: { ...job, state: "queued" } },
            { status: 202 },
          ),
        );
      }
      if (url === "/api/v1/plugins/install-jobs") return finishedJobs;
      return Promise.resolve(
        url.startsWith("/api/v1/plugin-catalog/search")
          ? Response.json({ results: [GUIDE_ENTRY], collections: [] })
          : Response.json({ plugins: [] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { button, queryClient } = renderGuide();
    fireEvent.click(button);
    fireEvent.click(
      await screen.findByRole("button", { name: "Install Plugin Guide" }),
    );
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const installCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/v1/plugin-catalog/install",
    );
    expect(installCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(installCall?.[1]?.body))).toEqual({
      entryId: "plugin-api-docs",
      marketplace: "bb-official",
    });
    expect(screen.getByTestId("location").textContent).toBe("/plugins");

    void queryClient.invalidateQueries({
      queryKey: pluginInstallJobsQueryKey(),
    });
    finishInstall(
      Response.json({
        jobs: [
          {
            ...job,
            state: "succeeded",
            plugin: { ...GUIDE, enabled: true, status: "running" },
          },
        ],
      }),
    );
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
  });
});
