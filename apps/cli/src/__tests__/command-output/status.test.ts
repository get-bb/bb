import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerStatusCommand } from "../../commands/status.js";

describe("bb status command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerStatusCommand(program, () => "http://server");

  it("bb status prints the context it has and fails when the server does not know it", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thread-1");
    const missing = async () =>
      new Response(JSON.stringify({ code: "not_found", error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    stubServerApi({
      "v1.projects.:id.$get": vi.fn(missing),
      "v1.threads.:id.$get": vi.fn(missing),
    });

    await expect(runCommand(["status"], register)).rejects.toThrow(
      "process.exit:1",
    );

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("Project: proj-1");
    expect(lines).toContain("Thread: thread-1");
    expect(console.error).toHaveBeenCalledWith(
      "Error: The context project proj-1 and thread thread-1 was not found on the server",
    );
  });

  it("bb status prints environment without fetching hosts", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thread-1");

    const getProject = vi.fn(async () => ({
      id: "proj-1",
      name: "Alpha",
    }));
    const getThread = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-1",
        projectId: "proj-1",
        providerId: "codex",
        environmentId: "env-1",
      }),
    );
    const getEnvironment = vi.fn(async () =>
      fixtures.makeEnvironment({
        id: "env-1",
        projectId: "proj-1",
        hostId: "host-remote",
      }),
    );
    stubServerApi({
      "v1.projects.:id.$get": getProject,
      "v1.threads.:id.$get": getThread,
      "v1.environments.:id.$get": getEnvironment,
      "v1.threads.:id.head-state.$get": vi.fn(async () => ({
        pendingTodos: null,
      })),
      "v1.threads.$get": vi.fn(async () => []),
    });

    await runCommand(["status"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "  Environment: Working locally (env-1)",
    );
  });

  it("bb status reports only the unreachable server when every request fails", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thread-1");
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const unreachable = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    stubServerApi({
      "v1.projects.:id.$get": unreachable,
      "v1.threads.:id.$get": unreachable,
    });

    await expect(runCommand(["status"], register)).rejects.toThrow(
      "process.exit:1",
    );

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Project: proj-1",
      "",
      "Thread: thread-1",
    ]);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["Error: The bb server at http://server did not answer: fetch failed"],
    ]);
  });

  it("bb status prints pinned state for pinned thread context", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thread-pinned-1");

    const getProject = vi.fn(async () => ({
      id: "proj-1",
      name: "Alpha",
    }));
    const getThread = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-pinned-1",
        projectId: "proj-1",
        providerId: "codex",
        pinnedAt: 1_700_000_000_000,
      }),
    );
    stubServerApi({
      "v1.projects.:id.$get": getProject,
      "v1.threads.:id.$get": getThread,
      "v1.threads.:id.head-state.$get": vi.fn(async () => ({
        pendingTodos: null,
      })),
      "v1.threads.$get": vi.fn(async () => []),
    });

    await runCommand(["status"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines.some((line) => line.includes("Pinned:"))).toBe(true);
  });
});

function stubServer(plugins: Array<{ id: string; status: string }>): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = url.endsWith("/api/v1/system/config")
      ? { dataDir: "/data/bb" }
      : {
          plugins: plugins.map(({ id, status }) => ({
            id,
            status,
            statusDetail: null,
            source: `path:/plugins/${id}`,
            rootDir: `/plugins/${id}`,
            version: "1.0.0",
            provenance: "direct",
            publisherLabel: null,
            isOrphanedBuiltin: false,
            sourceDisplay: `path · /plugins/${id}`,
            sourceNotice: null,
            updateState: {},
            enabled: true,
            description: null,
            name: null,
            icon: null,
            iconUrl: null,
            handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
            services: [],
            schedules: [],
            cliCommand: null,
            hasSettings: false,
            app: { hasApp: false, bundle: null },
            logoUrl: null,
            logoDarkUrl: null,
          })),
        };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("bb status plugin attention", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerStatusCommand(
      program,
      () => "http://server",
      () => ({ serverUrl: "http://server" }),
    );

  it("names enabled plugins that are not running (#1915)", async () => {
    stubServer([
      { id: "notify", status: "incompatible" },
      { id: "ok", status: "running" },
    ]);

    await runCommand(["status"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "1 plugin not running (notify: incompatible). Run bb plugin list.",
    );
  });

  it("prints no plugin line when every plugin runs", async () => {
    stubServer([{ id: "ok", status: "running" }]);

    await runCommand(["status"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).not.toContain(
      "not running",
    );
  });
});
