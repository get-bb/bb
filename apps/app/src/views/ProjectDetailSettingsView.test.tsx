// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Host, ProjectExecutionDefaults } from "@bb/domain";
import type {
  DefaultEnvironment,
  DefaultEnvironmentProblem,
  ProjectResponse,
  SystemEnvironmentProvider,
} from "@bb/server-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { SETTINGS_PROJECT_ROUTE_PATH } from "@/lib/route-paths";
import { ProjectDetailSettingsView } from "./ProjectDetailSettingsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { listProviders: vi.fn() },
    hosts: {
      cloneDefaultPath: vi.fn(),
      directory: vi.fn(),
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

function environmentProvider(
  id: string,
  overrides: Partial<SystemEnvironmentProvider> = {},
): SystemEnvironmentProvider {
  return {
    machineProviderId: null,
    id,
    displayName: id,
    description: null,
    icon: "Folder",
    logoUrl: null,
    pluginId: id,
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: true,
      gitCheckout: true,
      gitRemote: false,
      projectless: false,
    },
    inputs: null,
    ...overrides,
  };
}

const worktreeProvider = environmentProvider("git-worktree", {
  displayName: "Worktree",
});
const berthProvider = environmentProvider("berth", {
  displayName: "Berth",
  machineProviderId: "berth",
  machineInputs: null,
  machineAcceptsEmptyInputs: true,
});
const sandboxProvider = environmentProvider("cloud-sandbox", {
  displayName: "Cloud sandbox",
  machineProviderId: "cloud",
  machineInputs: { type: "object", required: ["size"] },
  machineAcceptsEmptyInputs: false,
});

function updatedProject(
  defaultEnvironment: DefaultEnvironment | null,
): ProjectResponse {
  return {
    id: "proj_bb",
    kind: "standard",
    name: "bb",
    gitRemoteUrl: "git@github.com:get-bb/bb.git",
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    sources: [],
    defaultEnvironment,
    defaultEnvironmentProblem: null,
  };
}

interface SourceFixture {
  hostId: string;
  path: string;
}

interface SidebarProjectDefault {
  defaultEnvironment: DefaultEnvironment | null;
  defaultEnvironmentProblem: DefaultEnvironmentProblem | null;
}

function stubSidebarBootstrapFetch(
  sources: SourceFixture[],
  options: {
    status?: number;
    projectId?: string;
    gitRemoteUrl?: string | null;
    defaultEnvironment?: DefaultEnvironment;
    defaultEnvironmentProblem?: DefaultEnvironmentProblem;
  } = {},
): SidebarProjectDefault {
  const projectId = options.projectId ?? "proj_bb";
  const projectDefault: SidebarProjectDefault = {
    defaultEnvironment: options.defaultEnvironment ?? null,
    defaultEnvironmentProblem: options.defaultEnvironmentProblem ?? null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          sections: [],
          projects: [
            {
              id: projectId,
              kind: "standard",
              name: "bb",
              gitRemoteUrl:
                options.gitRemoteUrl === undefined
                  ? "git@github.com:get-bb/bb.git"
                  : options.gitRemoteUrl,
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
              ...projectDefault,
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
            defaultEnvironment: null,
            defaultEnvironmentProblem: null,
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
  return projectDefault;
}

function serveDefaultEnvironmentUpdate(
  projectDefault: SidebarProjectDefault,
  stored: DefaultEnvironment | null,
): void {
  vi.mocked(sdk.projects.update).mockImplementation(async () => {
    projectDefault.defaultEnvironment = stored;
    projectDefault.defaultEnvironmentProblem = null;
    return updatedProject(stored);
  });
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
  vi.mocked(sdk.environments.listProviders).mockResolvedValue([
    worktreeProvider,
    berthProvider,
    sandboxProvider,
  ]);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ProjectDetailSettingsView", () => {
  it("keeps checkout counts in sync with the show-all machine toggle", async () => {
    const sandbox = host({
      id: "host_sandbox",
      name: "Sandbox",
      type: "ephemeral",
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      primaryHost,
      remoteHost,
      sandbox,
    ]);
    stubSidebarBootstrapFetch(
      [primaryHost, remoteHost, sandbox].map((machine) => ({
        hostId: machine.id,
        path: `/repos/${machine.id}`,
      })),
    );
    renderView();
    await screen.findByRole("heading", { name: "bb" });
    expect(screen.getByText(/2 of 2 machines/)).toBeDefined();
    expect(screen.queryByRole("link", { name: sandbox.name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all machines" }));
    expect(screen.getByText(/3 of 3 machines/)).toBeDefined();
    expect(screen.getByRole("link", { name: sandbox.name })).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Show fewer machines" }),
    );
    expect(screen.getByText(/2 of 2 machines/)).toBeDefined();
    expect(screen.queryByRole("link", { name: sandbox.name })).toBeNull();
  });

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

  it("changes the folder of a checkout on another machine", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
      { hostId: "host_remote", path: "/home/me/bb" },
    ]);
    vi.mocked(sdk.hosts.directory).mockResolvedValue({
      directory: "/home/me/bb",
      parent: "/home/me",
      entries: [],
      roots: ["/"],
    });

    renderView();
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "dev-vm checkout actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Change folder" }),
    );

    expect(
      await screen.findByText(
        "Browse to the project folder on dev-vm, or edit the path directly.",
      ),
    ).toBeDefined();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save path" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save path" }));

    await waitFor(() =>
      expect(sdk.projects.sources.update).toHaveBeenCalledWith({
        projectId: "proj_bb",
        sourceId: "src_1",
        type: "local_path",
        path: "/home/me/bb",
      }),
    );
    expect(sdk.hosts.directory).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host_remote" }),
    );
  });

  it("disables changing the folder on an offline machine", async () => {
    stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
      { hostId: "host_offline", path: "/home/old/bb" },
    ]);

    renderView();
    fireEvent.pointerDown(
      await screen.findByRole("button", {
        name: "old-laptop checkout actions",
      }),
      { button: 0 },
    );

    const changeFolder = await screen.findByRole("menuitem", {
      name: "Change folder",
    });
    expect(changeFolder.getAttribute("aria-disabled")).toBe("true");
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

  it("stores the environment picked on another machine as the default", async () => {
    const projectDefault = stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
      { hostId: "host_remote", path: "/home/me/bb" },
    ]);
    serveDefaultEnvironmentUpdate(projectDefault, {
      type: "provider",
      environmentProviderId: "git-worktree",
      machine: { type: "existing", hostId: "host_remote" },
      inputs: {},
    });
    const composerDraftKey = getProjectScopedStorageKey(
      "bb.promptbox.draft-environment",
      "proj_bb",
    );
    sessionStorage.setItem(composerDraftKey, "provider:berth");

    renderView();
    const trigger = await screen.findByRole("button", { name: "Environment" });
    await waitFor(() => expect(trigger.textContent).toContain("Automatic"));
    fireEvent.click(trigger, { button: 0 });
    fireEvent.click(await screen.findByRole("option", { name: "dev-vm" }));
    expect(sdk.projects.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: /Worktree/u }));

    await waitFor(() =>
      expect(sdk.projects.update).toHaveBeenCalledWith({
        projectId: "proj_bb",
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host_remote" },
          inputs: null,
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Environment" }).textContent,
      ).toContain("dev-vm · Worktree"),
    );
    expect(sessionStorage.getItem(composerDraftKey)).toBe("");
  });

  it("refuses a composition as the default of a project without a Git remote", async () => {
    stubSidebarBootstrapFetch(
      [{ hostId: "host_primary", path: "/Users/me/bb" }],
      { gitRemoteUrl: null },
    );

    renderView();
    const trigger = await screen.findByRole("button", { name: "Environment" });
    await waitFor(() => expect(trigger.getAttribute("aria-busy")).toBe("false"));
    fireEvent.click(trigger, { button: 0 });
    const berth = await screen.findByRole("option", { name: /Berth/u });

    expect(berth.getAttribute("aria-disabled")).toBe("true");
    expect(berth.textContent).toContain("Needs the project's Git remote");
  });

  it("offers a composition as the default unless it asks for options on each thread", async () => {
    const projectDefault = stubSidebarBootstrapFetch([
      { hostId: "host_primary", path: "/Users/me/bb" },
    ]);
    serveDefaultEnvironmentUpdate(projectDefault, {
      type: "provider",
      environmentProviderId: "berth",
      machine: { type: "new", machineProviderId: "berth", inputs: null },
      inputs: null,
    });

    renderView();
    const trigger = await screen.findByRole("button", { name: "Environment" });
    await waitFor(() => expect(trigger.getAttribute("aria-busy")).toBe("false"));
    fireEvent.click(trigger, { button: 0 });
    const sandbox = await screen.findByRole("option", {
      name: /Cloud sandbox/u,
    });
    expect(sandbox.getAttribute("aria-disabled")).toBe("true");
    expect(sandbox.textContent).toContain("Asks for options on each thread");
    fireEvent.click(screen.getByRole("option", { name: /Berth/u }));

    await waitFor(() =>
      expect(sdk.projects.update).toHaveBeenCalledWith({
        projectId: "proj_bb",
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: "berth",
          inputs: null,
        },
      }),
    );
    expect(await screen.findByText(/Each one gets a new machine\.$/u)).toBeDefined();
  });

  it("explains an unavailable default and resets it to Automatic", async () => {
    const projectDefault = stubSidebarBootstrapFetch(
      [{ hostId: "host_primary", path: "/Users/me/bb" }],
      {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host_destroyed" },
          inputs: {},
        },
        defaultEnvironmentProblem: {
          reason: "machine_missing",
          message: "its machine no longer exists",
        },
      },
    );
    serveDefaultEnvironmentUpdate(projectDefault, null);

    renderView();

    expect(await screen.findByText("Unavailable")).toBeDefined();
    expect(
      screen.getByText(
        "Its machine no longer exists. Threads started without a choice fail until you change or reset it.",
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() =>
      expect(sdk.projects.update).toHaveBeenCalledWith({
        projectId: "proj_bb",
        defaultEnvironment: null,
      }),
    );
    await waitFor(() => expect(screen.queryByText("Unavailable")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Environment" }).textContent,
    ).toContain("Automatic");
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
