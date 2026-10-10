// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { PluginInstallJob } from "@bb/server-contract";
import { pluginInstallJobsQueryKey } from "@/hooks/queries/query-keys";
import { AddPluginDialog } from "./AddPluginDialog";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function installPlanFor(url: string): unknown {
  const params = new URL(url, "https://bb.test").searchParams;
  const entryId = params.get("entryId") ?? "";
  const marketplace = params.get("marketplace") ?? "bb-community";
  const official =
    marketplace === "bb-community" || marketplace === "bb-official";
  return {
    kind: "marketplace",
    entryId,
    pluginId: entryId,
    displayName: entryId,
    marketplace,
    marketplaceDisplayName:
      marketplace === "bb-official"
        ? "BB Official"
        : marketplace === "bb-community"
          ? "BB Community"
          : "Acme Plugins",
    publisherLabel:
      marketplace === "bb-official"
        ? "BB Official"
        : marketplace === "bb-community"
          ? "BB Community"
          : "Acme Plugins",
    official,
    author: { name: "Acme", url: "https://github.com/acme" },
    source: "git:https://github.com/acme/plugins.git@semver:^1.0.0",
    resolvedSource: {
      kind: "git",
      url: "https://github.com/acme/plugins.git",
      range: "^1.0.0",
      resolvedTag: "v1.2.3",
      resolvedCommit: "a".repeat(40),
    },
    compatible: true,
    incompatibleReason: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const STARTED_JOB: PluginInstallJob = {
  id: "job-1",
  target: { kind: "catalog", entryId: "linear", marketplace: "bb-official" },
  displayName: "Linear",
  state: "queued",
};

const STARTED_JOB_RESPONSE = { ok: true, job: STARTED_JOB };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(
  installBody: unknown = STARTED_JOB_RESPONSE,
  installStatus = 202,
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
      if (url.startsWith("/api/v1/plugin-catalog/install-plan")) {
        return jsonResponse({ plan: installPlanFor(url) });
      }
      return jsonResponse({ error: "not found" }, 404);
    }),
  );
  return requests;
}

function renderDialog(
  initial?: Parameters<typeof AddPluginDialog>[0]["initial"],
) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <AddPluginDialog open onOpenChange={() => {}} initial={initial} />,
    { wrapper },
  );
}

describe("AddPluginDialog", () => {
  it.each([503, 403])(
    "offers source Retry only for a recoverable HTTP %s failure",
    async (status) => {
      let attempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.startsWith("/api/v1/plugin-catalog/install-plan")) {
            attempts += 1;
            return attempts === 1
              ? jsonResponse({ error: "Source unavailable" }, status)
              : jsonResponse({ plan: installPlanFor(url) });
          }
          return jsonResponse({ error: "Not found" }, 404);
        }),
      );
      renderDialog({
        entryId: "notes",
        pluginId: "notes",
        marketplace: "acme-plugins",
        publisherLabel: "Acme Plugins",
        displayName: "Acme Notes",
        icon: null,
        iconUrl: null,
        iconTinted: false,
        source: "git:https://github.com/acme/plugins.git",
      });
      await screen.findByRole("alert");
      const install = screen.getByRole("button", {
        name: "Install Acme Notes",
      }) as HTMLButtonElement;
      expect(install.disabled).toBe(true);
      if (status === 503) {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await vi.waitFor(() => expect(install.disabled).toBe(false));
        expect(attempts).toBe(2);
      } else {
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
        expect(screen.getByRole("alert").textContent).toContain(
          "Check repository permissions",
        );
      }
    },
  );

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
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        source,
      });
    });
  });

  it("installs a direct local path in one step behind the full-trust warning", async () => {
    const requests = stubFetch();
    renderDialog();

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

  it("closes once the server accepts the install and records its job", async () => {
    stubFetch();
    const onOpenChange = vi.fn();
    const onInstallStarted = vi.fn();
    const { wrapper, queryClient } = createQueryClientTestHarness();
    render(
      <AddPluginDialog
        open
        onOpenChange={onOpenChange}
        onInstallStarted={onInstallStarted}
      />,
      { wrapper },
    );

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "./plugins/linear" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install plugin/i }));

    await vi.waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onInstallStarted).toHaveBeenCalledWith(STARTED_JOB);
    expect(
      queryClient.getQueryData<PluginInstallJob[]>(pluginInstallJobsQueryKey()),
    ).toEqual([STARTED_JOB]);
  });

  it("describes each catalog source kind truthfully", () => {
    stubFetch();
    const { unmount } = renderDialog({
      entryId: "linear",
      pluginId: "linear",
      marketplace: "bb-official",
      publisherLabel: "BB Official",
      displayName: "Linear",
      icon: "Github",
      iconUrl: null,
      iconTinted: false,
      source: "builtin:linear",
    });
    expect(
      screen.getByText("Install this plugin, bundled with BB."),
    ).not.toBeNull();
    unmount();

    const git = renderDialog({
      entryId: "thread-hover-cards",
      pluginId: "thread-hover-cards",
      marketplace: "bb-community",
      publisherLabel: "BB Community",
      displayName: "Thread Hover Cards",
      icon: "Github",
      iconUrl: null,
      iconTinted: false,
      source: "git:https://github.com/brsbl/bb-plugins@b173b67",
    });
    expect(
      screen.getByText(
        "Install this BB Community plugin from its listed source repository.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/bundled with BB/)).toBeNull();
    git.unmount();

    renderDialog({
      entryId: "widgets",
      pluginId: "widgets",
      marketplace: "bb-community",
      publisherLabel: "BB Community",
      displayName: "Widgets",
      icon: "Zap",
      iconUrl: null,
      iconTinted: false,
      source: "npm:bb-plugin-widgets@^1.0.0",
    });
    expect(
      screen.getByText(
        "Install this BB Community plugin from its listed npm package.",
      ),
    ).not.toBeNull();
  });

  it("shows the exact source, including a pinned npm registry", () => {
    stubFetch();
    renderDialog({
      entryId: "widgets",
      pluginId: "widgets",
      displayName: "Widgets",
      icon: "Zap",
      iconUrl: null,
      iconTinted: false,
      marketplace: "bb-community",
      publisherLabel: "BB Community",
      source: "npm:bb-plugin-widgets@^1.0.0 (registry https://npm.acme.test)",
    });

    expect(
      screen.getByText(
        "npm:bb-plugin-widgets@^1.0.0 (registry https://npm.acme.test)",
      ),
    ).not.toBeNull();
  });

  it("installs official catalog entries through the catalog endpoint", async () => {
    const requests = stubFetch();
    renderDialog({
      entryId: "linear",
      pluginId: "linear",
      marketplace: "bb-official",
      publisherLabel: "BB Official",
      displayName: "Linear",
      icon: "Github",
      iconUrl: null,
      iconTinted: false,
      source: "builtin:linear",
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
        marketplace: "bb-official",
      });
    });
  });

  it("shows the cached marketplace icon in the confirmation", () => {
    stubFetch();
    const iconUrl =
      "/api/v1/plugin-catalog/icons/bb-community/widgets?h=icon-hash";
    renderDialog({
      entryId: "widgets",
      pluginId: "widgets",
      marketplace: "bb-community",
      publisherLabel: "BB Community",
      displayName: "Widgets",
      icon: null,
      iconUrl,
      iconTinted: false,
      source: "npm:bb-plugin-widgets@1.0.0",
    });

    expect(document.querySelector(`img[src="${iconUrl}"]`)).not.toBeNull();
  });

  it("keeps the dialog open with the reason when the server refuses to start", async () => {
    stubFetch({ error: 'unknown plugin catalog entry "linear"' }, 422);
    const onOpenChange = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <AddPluginDialog
        open
        onOpenChange={onOpenChange}
        initial={{
          entryId: "linear",
          pluginId: "linear",
          marketplace: "bb-official",
          publisherLabel: "BB Official",
          displayName: "Linear",
          icon: null,
          iconUrl: null,
          iconTinted: false,
          source: "builtin:linear",
        }}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        'unknown plugin catalog entry "linear"',
      );
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows a third-party listing's resolved source before confirming", async () => {
    const requests = stubFetch();
    renderDialog({
      entryId: "notes",
      pluginId: "notes",
      marketplace: "acme-plugins",
      publisherLabel: "Acme Plugins",
      displayName: "Acme Notes",
      icon: "Zap",
      iconUrl: null,
      iconTinted: false,
      source: "git:https://github.com/acme/plugins.git@semver:^1.0.0",
    });

    await vi.waitFor(() => {
      expect(screen.getByText("v1.2.3")).toBeTruthy();
    });
    expect(screen.getByText("a".repeat(40))).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "https://github.com/acme/plugins.git" })
        .getAttribute("href"),
    ).toBe("https://github.com/acme/plugins.git");
    expect(screen.getByText("^1.0.0")).toBeTruthy();
    expect(screen.getByText(/third-party marketplace/)).toBeTruthy();
    expect(screen.getByText("Acme Plugins")).toBeTruthy();
    expect(
      requests.some((request) =>
        request.url.startsWith("/api/v1/plugin-catalog/install-plan"),
      ),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: /install acme notes/i }),
    );
    await vi.waitFor(() => {
      const post = requests.find(
        (request) => request.url === "/api/v1/plugin-catalog/install",
      );
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        entryId: "notes",
        marketplace: "acme-plugins",
        confirmedSource: {
          kind: "git",
          url: "https://github.com/acme/plugins.git",
          range: "^1.0.0",
          resolvedTag: "v1.2.3",
          resolvedCommit: "a".repeat(40),
        },
      });
    });
  });

  it("does not resolve a plan for an official catalog entry", async () => {
    const requests = stubFetch();
    renderDialog({
      entryId: "linear",
      pluginId: "linear",
      marketplace: "bb-official",
      publisherLabel: "BB Official",
      displayName: "Linear",
      icon: "Github",
      iconUrl: null,
      iconTinted: false,
      source: "builtin:linear",
    });

    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));
    await vi.waitFor(() => {
      expect(
        requests.some(
          (request) => request.url === "/api/v1/plugin-catalog/install",
        ),
      ).toBe(true);
    });
    expect(
      requests.some((request) =>
        request.url.startsWith("/api/v1/plugin-catalog/install-plan"),
      ),
    ).toBe(false);
  });
});
