import { describe, expect, it, vi } from "vitest";
import {
  type DefaultEnvironment,
  type ProjectResponse,
  type SystemEnvironmentProvider,
  updateProjectRequestSchema,
} from "@bb/server-contract";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  resolveLocalHostIdMock,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerProjectCommands } from "../../commands/project.js";

const worktreeProvider: SystemEnvironmentProvider = {
  id: "git-worktree",
  displayName: "Worktree",
  description: "Prepare a workspace for this thread.",
  icon: "Folder",
  logoUrl: null,
  pluginId: "environment-git-worktree",
  machineProviderId: null,
  requires: {
    projectCheckout: true,
    gitCheckout: true,
    gitRemote: false,
    projectless: false,
  },
  inputs: { type: "object", properties: { branch: { type: "object" } } },
  acceptsEmptyInputs: true,
  availability: null,
  machineAvailability: {},
};

const berthProvider: SystemEnvironmentProvider = {
  ...worktreeProvider,
  id: "berth",
  displayName: "Berth (new machine for each thread)",
  description: "A new machine for each thread.",
  icon: "Cloud",
  pluginId: "berth",
  machineProviderId: "berth-machine",
  environmentProviderId: "git-worktree",
  machineInputs: null,
  machineAcceptsEmptyInputs: true,
};

const hosts = [
  {
    id: "host-builder",
    name: "builder",
    status: "connected",
    lastSeenAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
];

const berthDefault: DefaultEnvironment = {
  type: "provider",
  environmentProviderId: "berth",
  machine: { type: "new", machineProviderId: "berth-machine", inputs: null },
  inputs: {},
};

function worktreeDefault(hostId: string): DefaultEnvironment {
  return {
    type: "provider",
    environmentProviderId: "git-worktree",
    machine: { type: "existing", hostId },
    inputs: {},
  };
}

function makeProject(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  return {
    id: "proj-1",
    kind: "standard",
    name: "Alpha",
    gitRemoteUrl: "git@example.test:alpha.git",
    createdAt: 1,
    updatedAt: 2,
    sources: [],
    defaultEnvironment: null,
    defaultEnvironmentProblem: null,
    ...overrides,
  };
}

function stubApi(handlers: Parameters<typeof stubServerApi>[0]): void {
  stubServerApi({
    "v1.hosts.$get": vi.fn(async () => hosts),
    "v1.system.environment-providers.$get": vi.fn(async () => ({
      providers: [worktreeProvider, berthProvider],
    })),
    ...handlers,
  });
}

function validatedPatch(response: ProjectResponse) {
  return vi.fn(async ({ json }: { json: unknown }) => {
    updateProjectRequestSchema.parse(json);
    return response;
  });
}

describe("bb project default-environment", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerProjectCommands(program, () => "http://server");

  it.each<[label: string, project: ProjectResponse, lines: string[]]>([
    [
      "a composition by its display name",
      makeProject({ defaultEnvironment: berthDefault }),
      ["Default environment: Berth (new machine for each thread)"],
    ],
    [
      "a provider with the name of its machine",
      makeProject({ defaultEnvironment: worktreeDefault("host-builder") }),
      ["Default environment: Worktree on builder"],
    ],
    [
      "Automatic when no default is set",
      makeProject(),
      ["Default environment: Automatic"],
    ],
    [
      "why a default is unavailable",
      makeProject({
        defaultEnvironment: worktreeDefault("host-removed"),
        defaultEnvironmentProblem: {
          reason: "machine_missing",
          message: "its machine no longer exists",
        },
      }),
      [
        "Default environment: Worktree on host-removed",
        "Unavailable: its machine no longer exists",
      ],
    ],
  ])(
    "shows %s when no sub-command is given",
    async (_label, project, lines) => {
      stubApi({ "v1.projects.:id.$get": vi.fn(async () => project) });

      await runCommand(["project", "default-environment", "proj-1"], register);

      expect(collectLogLines(vi.mocked(console.log))).toEqual(lines);
    },
  );

  it("sets a composition without choosing its machine", async () => {
    const patch = validatedPatch(
      makeProject({ defaultEnvironment: berthDefault }),
    );
    stubApi({ "v1.projects.:id.$patch": patch });

    await runCommand(
      [
        "project",
        "default-environment",
        "set",
        "proj-1",
        "--environment-provider",
        "berth",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "proj-1" },
      json: {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: "berth",
          inputs: null,
        },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Default environment: Berth (new machine for each thread)",
    ]);
  });

  it("sets a provider on the machine named by --machine", async () => {
    const patch = validatedPatch(
      makeProject({ defaultEnvironment: worktreeDefault("host-builder") }),
    );
    stubApi({ "v1.projects.:id.$patch": patch });

    await runCommand(
      [
        "project",
        "default-environment",
        "set",
        "proj-1",
        "--environment-provider",
        "git-worktree",
        "--machine",
        "builder",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "proj-1" },
      json: {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host-builder" },
          inputs: null,
        },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Default environment: Worktree on builder",
    ]);
  });

  it.each<[label: string, args: string[], error: string]>([
    [
      "a provider without --machine instead of using this machine",
      ["--environment-provider", "git-worktree"],
      "Error: The 'git-worktree' environment provider runs on an existing machine; pass --machine <id-or-name>.",
    ],
    [
      "--machine for a provider that creates its own machine",
      ["--environment-provider", "berth", "--machine", "builder"],
      "Error: This environment provider chooses its own new machine; omit machine selectors.",
    ],
  ])("refuses %s", async (_label, args, error) => {
    const patch = vi.fn();
    stubApi({ "v1.projects.:id.$patch": patch });

    await expect(
      runCommand(
        ["project", "default-environment", "set", "proj-1", ...args],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(error);
    expect(patch).not.toHaveBeenCalled();
    expect(resolveLocalHostIdMock).not.toHaveBeenCalled();
  });

  it("resets the project to Automatic", async () => {
    const patch = validatedPatch(makeProject());
    stubApi({ "v1.projects.:id.$patch": patch });

    await runCommand(
      ["project", "default-environment", "reset", "proj-1"],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "proj-1" },
      json: { defaultEnvironment: null },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Default environment reset: Alpha is back to Automatic.",
    ]);
  });

  it.each<[subcommand: string, args: string[]]>([
    ["show", []],
    ["set", ["--environment-provider", "berth"]],
    ["reset", []],
  ])(
    "refuses %s for Personal before calling the server",
    async (subcommand, args) => {
      const get = vi.fn();
      const patch = vi.fn();
      stubApi({ "v1.projects.:id.$get": get, "v1.projects.:id.$patch": patch });

      await expect(
        runCommand(
          [
            "project",
            "default-environment",
            subcommand,
            "proj_personal",
            ...args,
          ],
          register,
        ),
      ).rejects.toThrow("process.exit:1");

      expect(console.error).toHaveBeenCalledWith(
        "Error: Personal has no default environment.",
      );
      expect(get).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each<[subcommand: string, args: string[]]>([
    ["show", []],
    ["set", ["--environment-provider", "berth"]],
    ["reset", []],
  ])(
    "%s --json prints only the project, as bb project show --json does",
    async (subcommand, args) => {
      const project = makeProject({ defaultEnvironment: berthDefault });
      stubApi({
        "v1.projects.:id.$get": vi.fn(async () => project),
        "v1.projects.:id.$patch": vi.fn(async () => project),
      });

      await runCommand(
        [
          "project",
          "default-environment",
          subcommand,
          "proj-1",
          ...args,
          "--json",
        ],
        register,
      );

      expect(console.log).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
      ).toEqual(project);
    },
  );

  it("bb project show prints the default environment and its problem", async () => {
    stubApi({
      "v1.projects.:id.$get": vi.fn(async () =>
        makeProject({
          defaultEnvironment: worktreeDefault("host-builder"),
          defaultEnvironmentProblem: {
            reason: "project_source_missing",
            message: "builder has no checkout of Alpha",
          },
        }),
      ),
    });

    await runCommand(["project", "show", "proj-1"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("  Default environment: Worktree on builder");
    expect(lines).toContain("  Unavailable: builder has no checkout of Alpha");
  });

  it("bb project show prints no default environment for Personal", async () => {
    stubApi({
      "v1.projects.:id.$get": vi.fn(async () =>
        makeProject({
          id: "proj_personal",
          kind: "personal",
          name: "Personal",
        }),
      ),
    });

    await runCommand(["project", "show", "proj_personal"], register);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("  Name:     Personal");
    expect(output).not.toContain("Default environment");
  });
});
