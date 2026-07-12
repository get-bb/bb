// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { marketplaceSearchQueryKey } from "@/hooks/queries/plugin-marketplace-queries";
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

const COMPATIBLE_PREVIEW = {
  plugin: {
    id: "linear",
    displayName: "Linear",
    description: "Browse and manage Linear issues",
  },
  resolved: { display: "1.6.2 · sha512-9f2c…e1", version: "1.6.2" },
  compatibility: { outcome: "compatible", devMode: false, problems: [] },
  updatePolicy: "compatible",
  updatePolicyDisplay: "tracks compatible releases in ^1.4.0",
  skipped: [],
  warnings: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(
  previewBody: unknown,
  previewStatus = 200,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "/api/v1/plugins/install/preview") {
        return jsonResponse(previewBody, previewStatus);
      }
      if (url === "/api/v1/plugins/install") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "not found" }, 404);
    }),
  );
  return requests;
}

function renderDialog(initial?: Parameters<typeof AddPluginDialog>[0]["initial"]) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <AddPluginDialog open onOpenChange={() => {}} initial={initial} />,
    { wrapper },
  );
}

describe("AddPluginDialog", () => {
  it("previews a typed source, shows the compatible verdict with details collapsed, and installs after the trust step", async () => {
    const requests = stubFetch(COMPATIBLE_PREVIEW);
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear" },
    });

    // Debounced server-side preview renders the verdict banner.
    const verdict = await screen.findByTestId(
      "install-preview-verdict",
      undefined,
      { timeout: 3000 },
    );
    expect(verdict.textContent).toContain("✓ compatible");
    // The server's human policy phrasing renders verbatim in the preview.
    expect(verdict.textContent).toContain(
      "tracks compatible releases in ^1.4.0",
    );
    const preview = requests.find(
      (request) => request.url === "/api/v1/plugins/install/preview",
    );
    expect(JSON.parse(String(preview?.init?.body))).toEqual({
      source: "npm:@bb-plugins/linear",
    });

    // All checks passed → the evidence stays collapsed.
    expect(
      screen
        .getByRole("button", { name: /details — version/i })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 2: the full-trust warning is always visible; Install commits.
    expect(screen.getByTestId("full-trust-warning")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));

    await vi.waitFor(() => {
      const install = requests.find(
        (request) => request.url === "/api/v1/plugins/install",
      );
      expect(install).toBeDefined();
      expect(JSON.parse(String(install?.init?.body))).toEqual({
        source: "npm:@bb-plugins/linear",
      });
    });
  });

  it("pre-expands details and disables Continue for an incompatible source", async () => {
    stubFetch({
      ...COMPATIBLE_PREVIEW,
      compatibility: {
        outcome: "incompatible",
        devMode: false,
        problems: ["requires bb >= 0.15 — you have 0.14.1"],
      },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear@2.0.0" },
    });

    await screen.findByTestId("install-preview-verdict", undefined, {
      timeout: 3000,
    });
    // The details ARE the story: pre-expanded, with the failing check shown.
    expect(
      screen
        .getByRole("button", { name: /details — version/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByText("requires bb >= 0.15 — you have 0.14.1"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps Continue disabled when devMode is set but the outcome is incompatible (dev mode annotates, never overrides)", async () => {
    stubFetch({
      ...COMPATIBLE_PREVIEW,
      compatibility: {
        outcome: "incompatible",
        devMode: true,
        problems: ["plugin SDK ^3.0 — you have 1.0.0"],
      },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear@2.0.0" },
    });

    await screen.findByTestId("install-preview-verdict", undefined, {
      timeout: 3000,
    });
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("pre-expands details when a newer release was skipped", async () => {
    stubFetch({
      ...COMPATIBLE_PREVIEW,
      skipped: [{ version: "1.7.0-beta.1", reason: "prerelease excluded" }],
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear" },
    });

    await screen.findByTestId("install-preview-verdict", undefined, {
      timeout: 3000,
    });
    expect(
      screen
        .getByRole("button", { name: /details — version/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByText(/Skipped 1\.7\.0-beta\.1 — prerelease excluded/),
    ).toBeTruthy();
  });

  it("shows the server's 422 message for an unparsable source", async () => {
    stubFetch(
      { error: "not a path, npm:, or git: source — tried both" },
      422,
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "linear@nowhere" },
    });

    expect(
      await screen.findByText(
        "not a path, npm:, or git: source — tried both",
        undefined,
        { timeout: 3000 },
      ),
    ).toBeTruthy();
  });

  it("invalidates marketplace-search queries after a successful install", async () => {
    stubFetch(COMPATIBLE_PREVIEW);
    const { wrapper, queryClient } = createQueryClientTestHarness();
    // A cached Browse search must refetch so the card flips to Installed ✓.
    queryClient.setQueryData(marketplaceSearchQueryKey(""), []);
    render(<AddPluginDialog open onOpenChange={() => {}} />, { wrapper });

    fireEvent.change(screen.getByLabelText("Plugin source"), {
      target: { value: "npm:@bb-plugins/linear" },
    });
    await screen.findByTestId("install-preview-verdict", undefined, {
      timeout: 3000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /install linear/i }));

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(marketplaceSearchQueryKey(""))?.isInvalidated,
      ).toBe(true);
    });
  });

  it("previews marketplace installs with the marketplace body form", async () => {
    const requests = stubFetch(COMPATIBLE_PREVIEW);
    renderDialog({
      marketplaceId: "mkt_1",
      marketplaceName: "bb-official",
      entryId: "linear",
      displayName: "Linear",
    });

    await screen.findByTestId("install-preview-verdict", undefined, {
      timeout: 3000,
    });
    const preview = requests.find(
      (request) => request.url === "/api/v1/plugins/install/preview",
    );
    expect(JSON.parse(String(preview?.init?.body))).toEqual({
      marketplace: { marketplaceId: "mkt_1", entryId: "linear" },
    });
  });
});
