import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  readlineMocks,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerProjectCommands } from "../../commands/project.js";

describe("bb project command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerProjectCommands(program, () => "http://server");

  it("bb project list --json prints raw projects", async () => {
    const projects = [
      {
        id: "proj-1",
        name: "Alpha",
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const get = vi.fn(async () => projects);
    stubServerApi({ "v1.projects.$get": get });

    await runCommand(["project", "list", "--json"], register);

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(projects);
  });

  it("bb project list renders the shared borderless table", async () => {
    const projects = [
      {
        id: "proj-1",
        name: "Alpha",
        sources: [
          { hostId: "host-test-001", type: "local_path", path: "/tmp/alpha" },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const get = vi.fn(async () => projects);
    stubServerApi({ "v1.projects.$get": get });

    await runCommand(["project", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID      Name   Path\n------  -----  ----------\nproj-1  Alpha  /tmp/alpha",
      "",
    ]);
  });

  it("bb project create --json prints the created project", async () => {
    const created = {
      id: "proj-created",
      name: "Alpha",
      createdAt: 1,
      updatedAt: 2,
    };
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.projects.$post": post });

    await runCommand(
      [
        "project",
        "create",
        "--name",
        "Alpha",
        "--root",
        "/tmp/alpha",
        "--json",
      ],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(created);
  });

  it("bb project source update patches the existing source type", async () => {
    const get = vi.fn(async () => ({
      createdAt: 1,
      id: "proj-1",
      name: "Alpha",
      sources: [
        {
          createdAt: 1,
          hostId: "host-test-001",
          id: "source-1",
          isDefault: true,
          path: "/tmp/alpha",
          projectId: "proj-1",
          type: "local_path",
          updatedAt: 2,
        },
      ],
      updatedAt: 2,
    }));
    const patch = vi.fn(async () => ({
      createdAt: 1,
      hostId: "host-test-001",
      id: "source-1",
      isDefault: true,
      path: "/tmp/renamed",
      projectId: "proj-1",
      type: "local_path",
      updatedAt: 3,
    }));
    stubServerApi({
      "v1.projects.:id.$get": get,
      "v1.projects.:id.sources.:sourceId.$patch": patch,
    });

    await runCommand(
      [
        "project",
        "source",
        "update",
        "proj-1",
        "source-1",
        "--path",
        "/tmp/renamed",
      ],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Project source updated: source-1",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "source-1  local_path  /tmp/renamed [default]",
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        json: {
          path: "/tmp/renamed",
          type: "local_path",
        },
        param: { id: "proj-1", sourceId: "source-1" },
      }),
    );
  });

  it("bb project source delete deletes without prompting when --yes is passed", async () => {
    const del = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.projects.:id.sources.:sourceId.$delete": del });

    await runCommand(
      ["project", "source", "delete", "proj-1", "source-1", "--yes"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Project source source-1 deleted",
    );
    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        param: { id: "proj-1", sourceId: "source-1" },
      }),
    );
  });
});
