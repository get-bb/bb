// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { marketplaceSearchQueryKey } from "@/hooks/queries/plugin-marketplace-queries";
import { appToast } from "@/components/ui/app-toast.js";
import { AddPluginDialog } from "./AddPluginDialog";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(
  installBody: unknown = { ok: true },
  installStatus = 200,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "/api/v1/plugins/install") {
        return jsonResponse(installBody, installStatus);
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
  it("installs a typed source in one step behind the full-trust warning", async () => {
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
      target: { value: "npm:@bb-plugins/linear" },
    });
    expect(install.disabled).toBe(false);
    fireEvent.click(install);

    await vi.waitFor(() => {
      const post = requests.find(
        (request) => request.url === "/api/v1/plugins/install",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        source: "npm:@bb-plugins/linear",
      });
    });
  });

  it("installs marketplace entries with the marketplace body form", async () => {
    const requests = stubFetch();
    renderDialog({
      marketplaceId: "mkt_1",
      marketplaceName: "bb-official",
      entryId: "linear",
      displayName: "Linear",
      icon: "Github",
    });

    expect(document.querySelector('[data-icon="Github"]')).not.toBeNull();
    expect(document.querySelector('[data-icon="Zap"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));

    await vi.waitFor(() => {
      const post = requests.find(
        (request) => request.url === "/api/v1/plugins/install",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        marketplace: { marketplaceId: "mkt_1", entryId: "linear" },
      });
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

  it("invalidates marketplace-search queries after a successful install", async () => {
    stubFetch();
    const { wrapper, queryClient } = createQueryClientTestHarness();
    // A cached Browse search must refetch so the card flips to Installed ✓.
    queryClient.setQueryData(marketplaceSearchQueryKey(""), []);
    render(<AddPluginDialog open onOpenChange={() => {}} />, { wrapper });

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install plugin/i }));

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(marketplaceSearchQueryKey(""))?.isInvalidated,
      ).toBe(true);
    });
  });
});
