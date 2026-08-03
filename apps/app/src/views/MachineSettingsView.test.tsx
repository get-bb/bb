// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Host } from "@bb/domain";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { MachineSettingsView } from "./MachineSettingsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      delete: vi.fn(),
      list: vi.fn(),
      providerCliStatus: vi.fn(),
      retryUpdate: vi.fn(),
      update: vi.fn(),
    },
    system: { config: vi.fn(), version: vi.fn() },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

const HOST_ID = "host_remote";

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: HOST_ID,
    name: "dev-vm",
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastSeenAt: Date.now(),
    lastRejectedProtocolVersion: null,
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function systemConfig(): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false, timelineWindowEventBudget: 1_500 },
    hostDaemonPort: null,
    primaryHostId: "host_primary",
    primaryHostPlatform: "darwin",
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

function renderView() {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={[`/settings/machines/${HOST_ID}`]}>
      <Routes>
        <Route
          path="/settings/machines/:hostId"
          element={<MachineSettingsView />}
        />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

/** Everything except the hosts list; the view also reads projects and versions. */
function stubSupportingFetches(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projects: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MachineSettingsView", () => {
  it("renders the machine's permission limit as a checked radio with descriptions", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host({ maxPermissionMode: "auto" }),
    ]);
    stubSupportingFetches();

    renderView();

    expect(
      await screen.findByRole("heading", { name: "dev-vm" }),
    ).toBeDefined();
    const checkedByMode = Object.fromEntries(
      (await screen.findAllByRole("radio")).map((option) => [
        option.textContent?.startsWith("Accept Edits")
          ? "accept-edits"
          : option.textContent?.startsWith("Approve for me")
            ? "auto"
            : "full",
        option.getAttribute("aria-checked"),
      ]),
    );
    expect(checkedByMode).toEqual({
      "accept-edits": "false",
      auto: "true",
      full: "false",
    });
    // The page exists so the modes can explain themselves.
    expect(screen.getByText(/No sandbox and no approvals/u)).toBeDefined();
  });

  it("writes the selected limit to the owner-only route", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    const requests: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/permission-ceiling")) {
          requests.push({ url, body: String(init?.body ?? "") });
          return new Response(
            JSON.stringify(host({ maxPermissionMode: "accept-edits" })),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    renderView();

    fireEvent.click(
      await screen.findByRole("radio", { name: /Accept Edits/u }),
    );

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.url).toContain(
      `/api/v1/hosts/${HOST_ID}/permission-ceiling`,
    );
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      maxPermissionMode: "accept-edits",
    });
  });

  it("refuses to remove the primary machine", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue({
      ...systemConfig(),
      primaryHostId: HOST_ID,
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    stubSupportingFetches();

    renderView();

    const remove = await screen.findByRole("button", {
      name: "Remove machine",
    });
    expect(remove.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("this machine")).toBeDefined();
  });

  it("explains a machine that is no longer paired", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([]);
    stubSupportingFetches();

    renderView();

    expect(
      await screen.findByText("This machine is no longer paired."),
    ).toBeDefined();
  });
});
