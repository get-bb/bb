// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { makeHost as makeHostFixture } from "@bb/test-helpers/domain-fixtures";
import type { SystemConfigResponse } from "@bb/server-contract";
import type {
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { defaultExperiments, type Host, type LastServerMove } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { MachineSettingsView } from "./MachineSettingsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    experimental_server: {
      checkMove: vi.fn(),
      moveStatus: vi.fn(),
      startMove: vi.fn(),
    },
    hosts: {
      delete: vi.fn(),
      experimental_deleteOldServerCopy: vi.fn(),
      list: vi.fn(),
      experimental_listProviders: vi.fn(),
      providerCliStatus: vi.fn(),
      experimental_resume: vi.fn(),
      experimental_retryCleanup: vi.fn(),
      retryUpdate: vi.fn(),
      experimental_suspend: vi.fn(),
      update: vi.fn(),
    },
    providers: { list: vi.fn() },
    system: { config: vi.fn(), version: vi.fn() },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

const hostDaemon = vi.hoisted(() => ({
  localDaemonHostId: null as string | null,
  platform: null as "darwin" | "linux" | "wsl" | "unknown" | null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: hostDaemon.localDaemonHostId,
    platform: hostDaemon.platform,
  }),
}));

const HOST_ID = "host_remote";

function host(overrides: Partial<Host> = {}): Host {
  return makeHostFixture({
    id: HOST_ID,
    name: "dev-vm",
    lastSeenAt: Date.now(),
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    ...overrides,
  });
}

function systemConfig(): SystemConfigResponse {
  return makeSystemConfig({
    primaryHostId: "host_primary",
    primaryHostPlatform: "darwin",
    experiments: { ...defaultExperiments, serverMove: true },
  });
}

function providerCliStatus(
  provider: ProviderCliKey,
  currentVersion: string,
): ProviderCliStatus {
  const identity =
    provider === "codex"
      ? { displayName: "Codex", executableName: "codex" }
      : provider === "claude-code"
        ? { displayName: "Claude Code", executableName: "claude" }
        : { displayName: "Cursor", executableName: "agent" };
  return {
    ...identity,
    executablePath: `/usr/local/bin/${identity.executableName}`,
    installed: true,
    installSource: "npmGlobal",
    currentVersion,
    latestVersion: currentVersion,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
  };
}

function providerCliStatusResponse(): ProviderCliStatusResponse {
  return {
    codex: providerCliStatus("codex", "0.148.0"),
    "claude-code": providerCliStatus("claude-code", "2.1.235"),
    "acp-cursor": providerCliStatus("acp-cursor", "1.4.6"),
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

function stubSupportingFetches(): void {
  vi.mocked(sdk.hosts.experimental_listProviders).mockResolvedValue([]);
  vi.mocked(sdk.hosts.providerCliStatus).mockResolvedValue(
    providerCliStatusResponse(),
  );
  vi.mocked(sdk.providers.list).mockResolvedValue([
    makeProviderInfo({ id: "codex", displayName: "Codex" }),
    makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
    makeProviderInfo({ id: "acp-cursor", displayName: "Cursor" }),
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

function lastMove(overrides: Partial<LastServerMove> = {}): LastServerMove {
  return {
    moveId: "move_1",
    fromHostId: HOST_ID,
    fromHostName: "dev-vm",
    toHostId: "host_primary",
    toHostName: "workstation",
    completedAt: Date.now() - 3_600_000,
    oldCopyDeletedAt: null,
    ...overrides,
  };
}

async function openMachineMenu(): Promise<void> {
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: "dev-vm actions" }),
    { button: 0 },
  );
  await screen.findByRole("menuitem", { name: "Rename" });
}

beforeEach(() => {
  hostDaemon.localDaemonHostId = null;
  hostDaemon.platform = null;
  vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
    move: null,
    lastMove: null,
  });
});

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

    const machineHeading = await screen.findByRole("heading", {
      name: /dev-vm/u,
    });
    expect(machineHeading.tagName).toBe("H1");
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
    expect(
      screen
        .getAllByRole("radio")
        .every((option) => option.querySelector("[data-icon]") === null),
    ).toBe(true);
    const machineSubtitle = screen.getByText(/^Online ·/u);
    expect(machineSubtitle.closest("section")).toBeNull();
    expect(screen.queryByRole("img", { name: "Online" })).toBeNull();
    expect(
      screen
        .getByRole("heading", { name: /dev-vm/u })
        .querySelector("[data-icon]"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("heading", { name: "Machine information" })
        .closest("section")
        ?.querySelector("[data-icon]"),
    ).toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-provider-icon="codex"] [data-provider-logo]',
        ),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector('[data-provider-icon="claude-code"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-provider-icon="acp-cursor"]'),
    ).not.toBeNull();
    expect(
      [...document.querySelectorAll("[data-provider-icon]")].every(
        (node) =>
          node.classList.contains("flex") &&
          node.classList.contains("size-3.5"),
      ),
    ).toBe(true);
    expect(
      screen
        .getByRole("heading", { name: "Provider CLIs" })
        .querySelector("[data-icon]"),
    ).toBeNull();
    const installedLabel = screen.getByText("Installed");
    expect(installedLabel.parentElement?.className).toContain("flex-col");
    expect(installedLabel.parentElement?.className).toContain("sm:flex-row");
    expect(installedLabel.nextElementSibling?.className).toContain(
      "justify-start",
    );
    expect(installedLabel.nextElementSibling?.className).toContain(
      "sm:justify-end",
    );
    expect(screen.getByText(/No sandbox and no approvals/u)).toBeDefined();
  });

  it("keeps Rename in the machine title menu", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    stubSupportingFetches();

    renderView();

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "dev-vm actions" }),
      { button: 0 },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Rename" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("shows an offline machine's status as text", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host({ status: "disconnected", lastSeenAt: Date.now() - 60_000 }),
    ]);
    stubSupportingFetches();

    renderView();

    expect(await screen.findByText(/^Offline · last seen/u)).toBeDefined();
    expect(screen.queryByRole("img", { name: "Offline" })).toBeNull();
  });

  it("links update issues to Updates in a warning pill", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    stubSupportingFetches();
    const statuses = providerCliStatusResponse();
    vi.mocked(sdk.hosts.providerCliStatus).mockResolvedValue({
      ...statuses,
      codex: {
        ...statuses.codex,
        latestVersion: "0.149.0",
        needsUpdate: true,
        installAction: {
          kind: "update",
          label: "Update",
          command: "codex update",
        },
      },
    });

    renderView();

    const issueLink = await screen.findByRole("link", { name: "1 to fix" });
    expect(issueLink.getAttribute("href")).toBe("/settings/updates");
    const pill = issueLink.firstElementChild;
    expect(pill?.className).toContain("bg-surface-attention");
    expect(pill?.className).toContain("text-warning-text");
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

  it("refuses to remove the server machine", async () => {
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
    expect(remove.className).toContain("bg-destructive");
    expect(remove.parentElement?.className).not.toContain("justify-end");
    expect(screen.queryByText("This machine")).toBeNull();
    expect(screen.getByText("Server")).toBeDefined();
    expect(
      screen.getByText(
        "The server machine can't be removed. Move the server to another machine first.",
      ),
    ).toBeDefined();
  });

  it("describes ephemeral compute and snapshot deletion in the danger zone", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host({ type: "ephemeral", machineProviderId: "modal-sandbox" }),
    ]);
    stubSupportingFetches();
    vi.mocked(sdk.hosts.experimental_listProviders).mockResolvedValue([
      {
        id: "modal-sandbox",
        displayName: "Modal Sandbox",
        description: "Run a machine for development.",
        icon: "Cloud",
        logoUrl: null,
        pluginId: "environment-modal-sandbox",
        inputs: null,
        acceptsEmptyInputs: true,
        supportsSuspend: true,
      },
    ]);
    renderView();

    expect(
      await screen.findByText(
        "Revokes dev-vm's access to this server. The compute and its saved snapshots are deleted. Thread history is preserved.",
      ),
    ).toBeDefined();
    const heading = await screen.findByRole("heading", { name: "dev-vm" });
    expect(heading.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(heading.querySelector('[data-icon="Laptop"]')).toBeNull();
    expect(screen.queryByText("Modal Sandbox")).toBeNull();
  });

  it("shows client-local identity only when several machines need disambiguation", async () => {
    hostDaemon.localDaemonHostId = HOST_ID;
    hostDaemon.platform = "linux";
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host(),
      host({ id: "host_primary", name: "workstation" }),
    ]);
    stubSupportingFetches();

    renderView();

    expect(await screen.findByText("This machine")).toBeDefined();
    expect(screen.queryByText("Server")).toBeNull();
    expect(screen.getByText(/Linux/u)).toBeDefined();
  });

  it("suppresses the client-local badge when there is only one machine", async () => {
    hostDaemon.localDaemonHostId = HOST_ID;
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    stubSupportingFetches();

    renderView();

    await screen.findByRole("heading", { name: /dev-vm/u });
    expect(screen.queryByText("This machine")).toBeNull();
  });

  it("badges a lone server machine but does not count sandboxes toward the client-local badge", async () => {
    hostDaemon.localDaemonHostId = HOST_ID;
    vi.mocked(sdk.system.config).mockResolvedValue({
      ...systemConfig(),
      primaryHostId: HOST_ID,
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host(),
      host({
        id: "host_sandbox",
        name: "Modal sandbox 3f9a",
        type: "ephemeral",
        machineProviderId: "modal-sandbox",
      }),
    ]);
    stubSupportingFetches();

    renderView();

    await screen.findByText(
      "The server machine can't be removed. Move the server to another machine first.",
    );
    expect(screen.getByText("Server")).toBeDefined();
    expect(screen.queryByText("This machine")).toBeNull();
  });

  it("badges the server machine when several persistent machines exist", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue({
      ...systemConfig(),
      primaryHostId: HOST_ID,
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host(),
      host({ id: "host_laptop", name: "laptop" }),
    ]);
    stubSupportingFetches();

    renderView();

    expect(await screen.findByText("Server")).toBeDefined();
  });

  it("offers Move server here in the title menu of an eligible machine", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    vi.mocked(sdk.experimental_server.checkMove).mockResolvedValue({
      targetHostId: HOST_ID,
      targetHostName: "dev-vm",
      mode: "connect",
      serverUrl: null,
      requiresServerUrl: false,
      targetDataDir: "/home/sawyer/.bb-machines/workstation",
      existingTargetServerData: null,
      items: [],
      canMove: true,
    });
    stubSupportingFetches();

    renderView();

    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.moveStatus)).toHaveBeenCalled();
    });
    await openMachineMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move server here" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Move the server to dev-vm" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.checkMove)).toHaveBeenCalledWith(
        { targetHostId: HOST_ID, serverUrl: null },
      );
    });
  });

  it("does not offer Move server here on the server machine or an offline machine", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue({
      ...systemConfig(),
      primaryHostId: HOST_ID,
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    stubSupportingFetches();

    renderView();

    await openMachineMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Move server here" }),
    ).toBeNull();
    cleanup();

    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host({ status: "disconnected", lastSeenAt: Date.now() - 60_000 }),
    ]);

    renderView();

    await openMachineMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Move server here" }),
    ).toBeNull();
  });

  it("deletes the locked old server copy on the machine the server moved from", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    vi.mocked(sdk.experimental_server.moveStatus)
      .mockResolvedValueOnce({ move: null, lastMove: lastMove() })
      .mockResolvedValue({
        move: null,
        lastMove: lastMove({ oldCopyDeletedAt: Date.now() }),
      });
    vi.mocked(sdk.hosts.experimental_deleteOldServerCopy).mockResolvedValue({
      deleted: true,
    });
    stubSupportingFetches();

    renderView();

    expect(
      await screen.findByRole("heading", { name: "Old server copy" }),
    ).toBeDefined();
    expect(
      screen.getByText(
        /The server moved from dev-vm to workstation\. The old server data is still on dev-vm/u,
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete old copy" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Delete the old server copy?",
    });
    expect(
      vi.mocked(sdk.hosts.experimental_deleteOldServerCopy),
    ).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Delete old copy" }),
    );

    await waitFor(() => {
      expect(
        vi.mocked(sdk.hosts.experimental_deleteOldServerCopy),
      ).toHaveBeenCalledWith({ hostId: HOST_ID });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Old server copy" }),
      ).toBeNull();
    });
  });

  it("hides Move server here and the old server copy while the serverMove experiment is off", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue({
      ...systemConfig(),
      experiments: defaultExperiments,
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: null,
      lastMove: lastMove(),
    });
    stubSupportingFetches();

    renderView();

    await screen.findByRole("heading", { name: "Machine information" });
    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.moveStatus)).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("heading", { name: "Old server copy" }),
    ).toBeNull();
    await openMachineMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Move server here" }),
    ).toBeNull();
  });

  it("shows the old server copy only on the machine the server left, until it is deleted", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([host()]);
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: null,
      lastMove: lastMove({ fromHostId: "host_laptop", fromHostName: "laptop" }),
    });
    stubSupportingFetches();

    const first = renderView();

    await screen.findByRole("heading", { name: "Machine information" });
    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.moveStatus)).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("heading", { name: "Old server copy" }),
    ).toBeNull();
    first.unmount();

    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: null,
      lastMove: lastMove({ oldCopyDeletedAt: Date.now() }),
    });
    vi.mocked(sdk.experimental_server.moveStatus).mockClear();

    renderView();

    await screen.findByRole("heading", { name: "Machine information" });
    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.moveStatus)).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("heading", { name: "Old server copy" }),
    ).toBeNull();
  });

  it("disables deleting the old server copy while that machine is offline", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      host({ status: "disconnected", lastSeenAt: Date.now() - 60_000 }),
    ]);
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: null,
      lastMove: lastMove(),
    });
    stubSupportingFetches();

    renderView();

    const deleteButton = await screen.findByRole("button", {
      name: "Delete old copy",
    });
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(/dev-vm has to be online to delete it\.$/u),
    ).toBeDefined();
  });

  it("explains a machine that is no longer paired", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    vi.mocked(sdk.hosts.list).mockResolvedValue([]);
    stubSupportingFetches();

    renderView();

    expect(
      await screen.findByText("Machine is no longer paired."),
    ).toBeDefined();
  });
});
