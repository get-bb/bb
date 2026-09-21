import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread list command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread list supports parent-thread filtering", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    await runCommand(
      [
        "thread",
        "list",
        "--project",
        "proj-1",
        "--parent-thread",
        "thread-manager-1",
      ],
      register,
    );

    expect(list).toHaveBeenCalledWith({
      query: {
        projectId: "proj-1",
        parentThreadId: "thread-manager-1",
      },
    });
  });

  it("bb thread list opts into hidden threads explicitly", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    await runCommand(["thread", "list", "--include-hidden"], register);

    expect(list).toHaveBeenCalledWith({
      query: { includeHidden: "true" },
    });
  });

  it("bb thread list rejects invalid parent-thread values", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    await expect(
      runCommand(
        [
          "thread",
          "list",
          "--project",
          "proj-1",
          "--parent-thread",
          "thread/invalid",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      'Error: Invalid ID from --parent-thread: "thread/invalid". IDs must contain only letters, digits, hyphens, and underscores.',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("bb thread list renders archived status in the shared borderless table", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thread-archived-1",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        archivedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    stubServerApi({
      "v1.threads.$get": list,
      "v1.projects.$get": async () => [{ id: "proj-1", name: "Alpha" }],
    });

    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID                 Title  Project  Status         \n-----------------  -----  -------  ---------------\nthread-archived-1  -      Alpha    idle (archived)",
      "",
    ]);
  });

  it("bb thread list renders pinned status in the shared borderless table", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thread-pinned-1",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        pinnedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    stubServerApi({
      "v1.threads.$get": list,
      "v1.projects.$get": async () => [],
    });

    await runCommand(["thread", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "idle (pinned)",
    );
  });

  it("bb thread list hides the personal project label", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thread-personal-1",
        projectId: domain.PERSONAL_PROJECT_ID,
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    stubServerApi({
      "v1.threads.$get": list,
      "v1.projects.$get": async () => [],
    });

    vi.stubEnv("BB_PROJECT_ID", undefined);
    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID                 Title  Project  Status      \n-----------------  -----  -------  ------------\nthread-personal-1  -      -        idle        ",
      "",
    ]);
  });

  it("bb thread list prints the thread title, fallback, and project name (#1648)", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thr_a9niqhjj9c",
        projectId: "proj_bsst4jxfwv",
        providerId: "codex",
        status: "idle",
        title: "Investigate flaky login test",
        titleFallback: "Reply only with ok.",
        createdAt: 1,
        updatedAt: 1,
      }),
      fixtures.makeThread({
        id: "thr_uwfzqywzsz",
        projectId: "proj_bsst4jxfwv",
        providerId: "codex",
        status: "idle",
        title: null,
        titleFallback: "Reply only with ok.\nThis is the second QA thread.",
        createdAt: 1,
        updatedAt: 1,
      }),
      fixtures.makeThread({
        id: "thr_unknownproj",
        projectId: "proj_missing",
        providerId: "codex",
        status: "idle",
        title: "x".repeat(80),
        titleFallback: null,
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    const projects = vi.fn(async () => [{ id: "proj_bsst4jxfwv", name: "qa" }]);
    stubServerApi({ "v1.threads.$get": list, "v1.projects.$get": projects });

    await runCommand(["thread", "list"], register);

    expect(projects).toHaveBeenCalledWith({
      query: { includePersonal: "false" },
    });
    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    const lines = output.split("\n");
    expect(lines[1]).toMatch(/^ID\s+Title\s+Project\s+Status/);
    expect(output).toContain("Investigate flaky login test");
    expect(output).toContain(
      "Reply only with ok. This is the second QA thread.",
    );
    expect(output).toContain(`${"x".repeat(59)}…`);
    expect(output).not.toContain("x".repeat(60));
    expect(output).toMatch(
      /thr_a9niqhjj9c\s+Investigate flaky login test\s+qa\s+idle/,
    );
    expect(output).toMatch(/thr_unknownproj\s+x+…\s+proj_missing\s+idle/);
  });

  it("bb thread list --json does not fetch projects", async () => {
    const list = vi.fn(async () => []);
    const projects = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list, "v1.projects.$get": projects });

    await runCommand(["thread", "list", "--json"], register);

    expect(projects).not.toHaveBeenCalled();
  });

  it("bb thread list ignores BB_PROJECT_ID when --project is omitted", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    vi.stubEnv("BB_PROJECT_ID", "proj-env");
    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
  });

  it("bb thread list does not infer parent-thread from BB_THREAD_ID", async () => {
    const list = vi.fn(async () => []);

    stubServerApi({ "v1.threads.$get": list });

    vi.stubEnv("BB_PROJECT_ID", "proj-env");
    vi.stubEnv("BB_THREAD_ID", "thread-current");
    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
  });
});
