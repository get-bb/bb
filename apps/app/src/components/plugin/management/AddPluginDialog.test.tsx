// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { pluginCatalogSearchQueryKey } from "@/hooks/queries/plugin-catalog-queries";
import {
  pluginListQueryKey,
  type PluginListResult,
} from "@/hooks/queries/plugin-settings-queries";
import { appToast } from "@/components/ui/app-toast.js";
import { AddPluginDialog } from "./AddPluginDialog";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const INSTALLED_PLUGIN_RESPONSE = {
  ok: true,
  plugin: {
    id: "linear",
    source: "npm:@bb-plugins/linear",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    provenance: "direct",
    isOrphanedBuiltin: false,
    sourceDisplay: "npm · @bb-plugins/linear · pinned",
    updateState: {},
    enabled: true,
    description: "Linear integration",
    name: "Linear",
    icon: null,
    iconUrl: null,
    status: "running",
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
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(
  installBody: unknown = INSTALLED_PLUGIN_RESPONSE,
  installStatus = 200,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (
        url === "/api/v1/plugins/install" ||
        url === "/api/v1/plugin-catalog/install"
      ) {
        return jsonResponse(installBody, installStatus);
      }
      return jsonResponse({ error: "not found" }, 404);
    }),
  );
  return requests;
}

function renderDialog(
  initial?: Parameters<typeof AddPluginDialog>[0]["initial"],
  onInstalled?: Parameters<typeof AddPluginDialog>[0]["onInstalled"],
) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <AddPluginDialog
      open
      onOpenChange={() => {}}
      initial={initial}
      onInstalled={onInstalled}
    />,
    { wrapper },
  );
}

describe("AddPluginDialog", () => {
  it("leads with and submits a pasted GitHub repository URL", async () => {
    const requests = stubFetch();
    renderDialog();
    const source = "https://github.com/acme/bb-plugin-usage";
    const input = screen.getByLabelText("Plugin source") as HTMLInputElement;

    expect(input.placeholder).toBe("https://github.com/owner/bb-plugin-name");
    expect(screen.getByText(/GitHub repository URL/)).toBeTruthy();
    fireEvent.change(input, { target: { value: source } });
    fireEvent.click(screen.getByRole("button", { name: /install plugin/i }));

    await vi.waitFor(() => {
      const post = requests.find(
        (request) => request.url === "/api/v1/plugins/install",
      );
      expect(JSON.parse(String(post?.init?.body))).toEqual({ source });
    });
  });

  it("installs a direct local path in one step behind the full-trust warning", async () => {
    const requests = stubFetch();
    renderDialog();

    // The commit button is disabled until a source is entered; the trust
    // warning is always visible.
    expect(screen.getByTestId("full-trust-warning")).toBeTruthy();
    const install = screen.getByRole("button", {
      name: /install plugin/i,
    }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "./plugins/linear" },
    });
    expect(install.disabled).toBe(false);
    fireEvent.click(install);

    await vi.waitFor(() => {
      const post = requests.find(
        (request) => request.url === "/api/v1/plugins/install",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        source: "./plugins/linear",
      });
    });
  });

  it("reports progress while an install is in flight", async () => {
    // A first install on a machine also downloads the build toolchain, so this
    // window can run ~17s. The server does that behind one blocking request, so
    // the client can only say that work is happening — not how far along it is.
    let release: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(INSTALLED_PLUGIN_RESPONSE));
        }),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "./plugins/linear" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install plugin/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /installing plugin/i }),
      ).toBeTruthy();
    });
    // The trust warning has served its purpose by now; the bar replaces it.
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByTestId("full-trust-warning")).toBeNull();

    release?.();
    await vi.waitFor(() => {
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
  });

  it("installs official catalog entries through the catalog endpoint", async () => {
    const requests = stubFetch();
    renderDialog({
      entryId: "linear",
      displayName: "Linear",
      icon: "Github",
    });

    expect(document.querySelector('[data-icon="Github"]')).not.toBeNull();
    expect(document.querySelector('[data-icon="Zap"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));

    await vi.waitFor(() => {
      const post = requests.find(
        (request) => request.url === "/api/v1/plugin-catalog/install",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        entryId: "linear",
      });
    });
  });

  it("returns the installed plugin so the caller can open canonical details", async () => {
    stubFetch();
    const onInstalled = vi.fn();
    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData<PluginListResult>(pluginListQueryKey(true), {
      plugins: [],
    });
    render(
      <AddPluginDialog
        open
        onOpenChange={() => {}}
        initial={{
          entryId: "linear",
          displayName: "Linear",
          icon: "Github",
        }}
        onInstalled={(plugin) => {
          onInstalled(plugin);
          expect(
            queryClient
              .getQueryData<PluginListResult>(pluginListQueryKey(true))
              ?.plugins.some((candidate) => candidate.id === plugin.id),
          ).toBe(true);
        }}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));

    await vi.waitFor(() => {
      expect(onInstalled).toHaveBeenCalledWith(
        INSTALLED_PLUGIN_RESPONSE.plugin,
      );
    });
  });

  it("surfaces the server's install error (e.g. incompatible source) as a toast", async () => {
    const errorToast = vi.spyOn(appToast, "error").mockReturnValue("toast");
    stubFetch(
      { ok: false, error: "requires bb >= 0.15 — you have 0.14.1" },
      422,
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear@2.0.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install plugin/i }));

    await vi.waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        "Installing the plugin failed",
        expect.objectContaining({
          description: "requires bb >= 0.15 — you have 0.14.1",
        }),
      );
    });
  });

  it("invalidates catalog-search queries after a successful install", async () => {
    stubFetch();
    const { wrapper, queryClient } = createQueryClientTestHarness();
    // A cached Browse search must refetch so the card flips to Installed ✓.
    queryClient.setQueryData(pluginCatalogSearchQueryKey(""), []);
    render(<AddPluginDialog open onOpenChange={() => {}} />, { wrapper });

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install plugin/i }));

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(pluginCatalogSearchQueryKey(""))
          ?.isInvalidated,
      ).toBe(true);
    });
  });
});
