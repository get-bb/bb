// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  buildProjectReorderRequest,
  formatGitRemote,
  ProjectsSettingsSection,
} from "./ProjectsSettingsSection";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: { list: vi.fn(), pickFolder: vi.fn() },
    projects: {
      create: vi.fn(),
      delete: vi.fn(),
      reorder: vi.fn(),
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
const remoteHost = host({
  id: "host_remote",
  name: "dev-vm",
  status: "disconnected",
});

interface SidebarProjectFixture {
  id: string;
  name: string;
  gitRemoteUrl: string | null;
  hostIds: string[];
  threadCount: number;
}

function stubSidebarBootstrapFetch(
  projects: SidebarProjectFixture[],
  status = 200,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sections: [],
          projects: projects.map((project) => ({
            id: project.id,
            kind: "standard",
            name: project.name,
            gitRemoteUrl: project.gitRemoteUrl,
            createdAt: NOW,
            updatedAt: NOW,
            sources: project.hostIds.map((hostId, index) => ({
              id: `src_${project.id}_${index}`,
              projectId: project.id,
              type: "local_path",
              hostId,
              path: `/repos/${project.name}`,
              isDefault: index === 0,
              createdAt: NOW,
              updatedAt: NOW,
            })),
            defaultExecutionOptions: null,
            threads: Array.from({ length: project.threadCount }, (_, i) => ({
              id: `thr_${project.id}_${i}`,
              projectId: project.id,
            })),
          })),
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
        { status, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

const projects: SidebarProjectFixture[] = [
  {
    id: "proj_bb",
    name: "bb",
    gitRemoteUrl: "git@github.com:get-bb/bb.git",
    hostIds: ["host_primary", "host_remote"],
    threadCount: 3,
  },
  {
    id: "proj_pierre",
    name: "pierre",
    gitRemoteUrl: "https://github.com/get-bb/pierre.git",
    hostIds: ["host_remote"],
    threadCount: 1,
  },
  {
    id: "proj_ingest",
    name: "ingest",
    gitRemoteUrl: null,
    hostIds: [],
    threadCount: 0,
  },
];

function renderSection() {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <ProjectsSettingsSection />
    </MemoryRouter>,
    { wrapper },
  );
}

async function openProjectMenu(projectName: string): Promise<void> {
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: `${projectName} actions` }),
    { button: 0 },
  );
}

beforeEach(() => {
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({
      primaryHostId: "host_primary",
      primaryHostPlatform: "darwin",
    }),
  );
  vi.mocked(sdk.hosts.list).mockResolvedValue([primaryHost, remoteHost]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("counts only persistent checkouts and their connection status in project summaries", async () => {
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
  stubSidebarBootstrapFetch([
    {
      id: "proj_all",
      name: "All checkouts",
      gitRemoteUrl: null,
      hostIds: [primaryHost.id, remoteHost.id, sandbox.id],
      threadCount: 1,
    },
    {
      id: "proj_offline",
      name: "Offline checkout",
      gitRemoteUrl: null,
      hostIds: [remoteHost.id, sandbox.id],
      threadCount: 1,
    },
  ]);
  renderSection();
  const all = await screen.findByRole("link", {
    name: "Open All checkouts settings",
  });
  const offline = screen.getByRole("link", {
    name: "Open Offline checkout settings",
  });
  expect(all.textContent).toContain("2 of 2 machines");
  expect(offline.textContent).toContain("1 of 2 machines");
  expect(offline.textContent).toContain("offline");
});

describe("buildProjectReorderRequest", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a project down and reports its new neighbours", () => {
    expect(buildProjectReorderRequest(ids, "a", "c")).toEqual({
      order: ["b", "c", "a", "d"],
      previousProjectId: "c",
      nextProjectId: "d",
    });
  });

  it("moves a project to the top with no previous neighbour", () => {
    expect(buildProjectReorderRequest(ids, "d", "a")).toEqual({
      order: ["d", "a", "b", "c"],
      previousProjectId: null,
      nextProjectId: "a",
    });
  });

  it("moves a project to the bottom with no next neighbour", () => {
    expect(buildProjectReorderRequest(ids, "a", "d")).toEqual({
      order: ["b", "c", "d", "a"],
      previousProjectId: "d",
      nextProjectId: null,
    });
  });

  it("ignores drops on the same row or unknown ids", () => {
    expect(buildProjectReorderRequest(ids, "b", "b")).toBeNull();
    expect(buildProjectReorderRequest(ids, "b", "zzz")).toBeNull();
    expect(buildProjectReorderRequest(ids, "zzz", "b")).toBeNull();
  });
});

describe("formatGitRemote", () => {
  it("shortens ssh and https remotes to host/path", () => {
    expect(formatGitRemote("git@github.com:get-bb/bb.git")).toBe(
      "github.com/get-bb/bb",
    );
    expect(formatGitRemote("https://github.com/get-bb/pierre.git")).toBe(
      "github.com/get-bb/pierre",
    );
  });

  it("leaves unparseable remotes alone", () => {
    expect(formatGitRemote("not a url")).toBe("not a url");
  });
});

describe("ProjectsSettingsSection", () => {
  it("summarises each project's remote, machine coverage, and threads", async () => {
    stubSidebarBootstrapFetch(projects);

    renderSection();

    expect(await screen.findByText("bb")).toBeDefined();
    expect(screen.getByText("github.com/get-bb/bb")).toBeDefined();
    expect(screen.getByText("2 of 2 machines")).toBeDefined();
    expect(screen.getByText("3 threads")).toBeDefined();
    expect(screen.getByText("1 of 2 machines")).toBeDefined();
    expect(screen.getByText("No git remote")).toBeDefined();
    expect(screen.getByText("Not set up on any machine")).toBeDefined();
    expect(screen.getByText("needs setup")).toBeDefined();
    expect(screen.queryByText("Personal")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Open bb settings" })
        .getAttribute("href"),
    ).toBe("/settings/projects/proj_bb");
  });

  it("marks a project offline when every configured machine is disconnected", async () => {
    stubSidebarBootstrapFetch(projects);

    renderSection();

    await screen.findByText("1 of 2 machines");
    const pierre = screen.getByText("pierre");
    expect(pierre.parentElement?.textContent).toContain("offline");
    const bb = screen.getByText("bb");
    expect(bb.parentElement?.textContent).not.toContain("offline");
  });

  it("shows a drag handle per project and disables them with a single project", async () => {
    stubSidebarBootstrapFetch(projects);
    const { unmount } = renderSection();

    await screen.findByText("bb");
    const handles = screen.getAllByRole("button", { name: /^Reorder / });
    expect(handles).toHaveLength(3);
    expect(handles.every((handle) => !handle.hasAttribute("disabled"))).toBe(
      true,
    );
    unmount();

    stubSidebarBootstrapFetch([projects[0]!]);
    renderSection();
    await screen.findByText("bb");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Reorder bb",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });

  it("renames a project through the existing dialog", async () => {
    stubSidebarBootstrapFetch(projects);
    vi.mocked(sdk.projects.update).mockResolvedValue({
      id: "proj_bb",
      kind: "standard",
      name: "bb-next",
      gitRemoteUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
      sources: [],
    });

    renderSection();
    await openProjectMenu("bb");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByDisplayValue("bb");
    fireEvent.change(input, { target: { value: "bb-next" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(sdk.projects.update).toHaveBeenCalledWith({
        projectId: "proj_bb",
        name: "bb-next",
      }),
    );
  });

  it("deletes a project after confirmation", async () => {
    stubSidebarBootstrapFetch(projects);
    vi.mocked(sdk.projects.delete).mockResolvedValue({ ok: true });

    renderSection();
    await openProjectMenu("ingest");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete project" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove project" }),
    );

    await waitFor(() =>
      expect(sdk.projects.delete).toHaveBeenCalledWith({
        projectId: "proj_ingest",
      }),
    );
  });

  it("opens the add-project dialog with the paired machines listed", async () => {
    stubSidebarBootstrapFetch(projects);

    renderSection();
    await screen.findByText("bb");
    fireEvent.click(screen.getByRole("button", { name: "Add a project" }));

    expect(
      await screen.findByRole("heading", { name: "Add project" }),
    ).toBeDefined();
    expect(screen.queryByText(/Every machine is offline/u)).toBeNull();
  });

  it("explains an empty project list", async () => {
    stubSidebarBootstrapFetch([]);

    renderSection();

    expect(await screen.findByText(/^No projects yet/u)).toBeDefined();
  });

  it("surfaces a failed project load instead of staying on the loader", async () => {
    stubSidebarBootstrapFetch([], 500);

    renderSection();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
