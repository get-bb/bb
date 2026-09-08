// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Host, ProjectExecutionDefaults } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { SETTINGS_PROJECT_ROUTE_PATH } from "@/lib/route-paths";
import { ProjectDetailSettingsView } from "./ProjectDetailSettingsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      cloneDefaultPath: vi.fn(),
      list: vi.fn(),
      pathsExist: vi.fn(),
      pickFolder: vi.fn(),
    },
    projects: {
      defaultExecutionOptions: vi.fn(),
      delete: vi.fn(),
      sources: { add: vi.fn(), delete: vi.fn(), update: vi.fn() },
      update: vi.fn(),
    },
    system: { config: vi.fn() },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: "host_primary",
    localHostId: "host_primary",
    hasDaemon: true,
    supportsNativeFolderPicker: false,
    platform: "darwin",
    isLocalDaemonHost: (hostId: string | null) => hostId === "host_primary",
  }),
}));

const NOW = Date.now();

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return makeHost({ lastSeenAt: NOW, ...overrides });
}

const primaryHost = host({ id: "host_primary", name: "MacBook Pro" });
const remoteHost = host({ id: "host_remote", name: "dev-vm" });
const offlineHost = host({
  id: "host_offline",
  name: "old-laptop",
  status: "disconnected",
});

interface SourceFixture {
  hostId: string;
  path: string;
}

function stubSidebarBootstrapFetch(
  sources: SourceFixture[],
  options: { status?: number; projectId?: string } = {},
): void {
  const projectId = options.projectId ?? "proj_bb";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sections: [],
          projects: [
            {
              id: projectId,
              kind: "standard",
              name: "bb",
              gitRemoteUrl: "git@github.com:get-bb/bb.git",
              createdAt: NOW - 86_400_000,
              updatedAt: NOW,
              sources: sources.map((source, index) => ({
                id: `src_${index}`,
                projectId,
                type: "local_path",
                hostId: source.hostId,
                path: source.path,
                isDefault: index === 0,
                createdAt: NOW,
                updatedAt: NOW,
              })),
              defaultExecutionOptions: null,
              threads: [{ id: "thr_1", projectId }],
            },
          ],
          personalProject: {
            id: "proj_personal",
            kind: "personal",
            name: "Personal",
            gitRemoteUrl: null,
            createdAt: NOW,
            updatedAt: NOW,
            sources: [],
            defaultExecutionOptions: null,
            threads: [],
          },
        }),
        {
          status: options.status ?? 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ),
  );
}

function renderView(projectId = "proj_bb") {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={[`/settings/projects/${projectId}`]}>
      <Routes>
        <Route
          path={SETTINGS_PROJECT_ROUTE_PATH}
          element={<ProjectDetailSettingsView />}
        />
        <Route path="/settings/projects" element={<p>Projects list</p>} />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

beforeEach(() => {
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({
      primaryHostId: "host_primary",
      primaryHostPlatform: "darwin",
    }),
  );
  vi.mocked(sdk.hosts.list).mockResolvedValue([
    primaryHost,
    remoteHost,
    offlineHost,
  ]);
  vi.mocked(sdk.hosts.pathsExist).mockResolvedValue({ existence: {} });
  vi.mocked(sdk.hosts.cloneDefaultPath).mockResolvedValue({
    path: "/home/me/bb",
  });
  vi.mocked(sdk.projects.defaultExecutionOptions).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ProjectDetailSettingsView", () => {
  it("lists every paired machine with its checkout or a set-up action", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);

    renderView();

    expect(await screen.findByRole("heading", { name: "bb" })).toBeDefined();
    expect(screen.getByText("/Users/me/bb")).toBeDefined();
    expect(
      screen.getByText("github.com/get-bb/bb · 1 of 3 machines · 1 thread"),
    ).toBeDefined();
    expect(screen.getAllByText("Not set up on this machine")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Set up" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Offline" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "dev-vm" }).getAttribute("href"),
    ).toBe("/settings/machines/host_remote");
  });

  it("opens the machine setup dialog for a remote machine", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));

    expect(await screen.findByText("Set up bb on dev-vm")).toBeDefined();
  });

  it("opens the path dialog when the local machine has no checkout", async () => {
    stubSidebarBootstrapFetch([{ hostId: "host_remote", path: "/home/me/bb" }]);

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));

    expect(await screen.findByText("Add project source")).toBeDefined();
  });

  it("refuses to remove the last checkout but removes an extra one", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
      { hostId: "host_remote", path: "/home/me/bb" },
    ]);
    vi.mocked(sdk.projects.sources.delete).mockResolvedValue({ ok: true });

    renderView();
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "dev-vm checkout actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove checkout" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Remove/ }));

    await waitFor(() =>
      expect(sdk.projects.sources.delete).toHaveBeenCalledWith({
        projectId: "proj_bb",
        sourceId: "src_1",
      }),
    );
  });

  it("disables removal when the project has a single checkout", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);

    renderView();
    fireEvent.pointerDown(
      await screen.findByRole("button", {
        name: "MacBook Pro checkout actions",
      }),
      { button: 0 },
    );

    const remove = await screen.findByRole("menuitem", {
      name: "Remove checkout",
    });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows derived thread defaults when the project has run threads", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);
    const defaults: ProjectExecutionDefaults = {
      providerId: "codex",
      model: "gpt-6-astra",
      serviceTier: "default",
      reasoningLevel: "medium",
      permissionMode: "auto",
    };
    vi.mocked(sdk.projects.defaultExecutionOptions).mockResolvedValue(defaults);

    renderView();

    expect(await screen.findByText("gpt-6-astra")).toBeDefined();
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.queryByText(/^No threads have run here yet/u)).toBeNull();
  });

  it("distinguishes a failed defaults load from an empty one", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);
    vi.mocked(sdk.projects.defaultExecutionOptions).mockRejectedValue(
      new Error("boom"),
    );

    renderView();

    expect(
      await screen.findByText("Couldn't load thread defaults."),
    ).toBeDefined();
    expect(screen.queryByText(/^No threads have run here yet/u)).toBeNull();
  });

  it("deletes the project and returns to the list", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);
    vi.mocked(sdk.projects.delete).mockResolvedValue({ ok: true });

    renderView();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete project" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove project" }),
    );

    await waitFor(() =>
      expect(sdk.projects.delete).toHaveBeenCalledWith({
        projectId: "proj_bb",
      }),
    );
    expect(await screen.findByText("Projects list")).toBeDefined();
  });

  it("explains a project that no longer exists", async () => {
    stubSidebarBootstrapFetch([], { projectId: "proj_other" });

    renderView("proj_missing");

    expect(
      await screen.findByText("This project no longer exists."),
    ).toBeDefined();
  });

  it("surfaces a failed load instead of staying on the loader", async () => {
    stubSidebarBootstrapFetch([], { status: 500 });

    renderView();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
