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
import {
  formatPluginAttentionLine,
  registerStatusCommand,
} from "../../commands/status.js";

describe("bb status command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerStatusCommand(program, () => "http://server");

  it("bb status prints project/thread context", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thread-1");

    await runCommand(["status"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("Project: proj-1");
    expect(lines).toContain("Thread: thread-1");
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
    });

    await runCommand(["status"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "  Environment: Working locally (env-1)",
    );
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
    });

    await runCommand(["status"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines.some((line) => line.includes("Pinned:"))).toBe(true);
  });
});

function jsonResponse(value: object): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubServer(
  attention: ReadonlyArray<{
    id: string;
    status: string;
    statusDetail: string | null;
  }>,
): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/api/v1/system/config")) {
      return jsonResponse({ dataDir: "/data/bb" });
    }
    if (url.endsWith("/api/v1/plugins/attention")) {
      return jsonResponse({ plugins: attention });
    }
    throw new Error(`unexpected fetch ${url}`);
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

  it("reports the server's attention summary, grouped by status", async () => {
    stubServer([
      {
        id: "notify",
        status: "incompatible",
        statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
      },
      { id: "foo", status: "error", statusDetail: "boom" },
    ]);

    await runCommand(["status"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Data dir: /data/bb");
    expect(output).toContain(
      "2 plugins need attention (incompatible: notify; error: foo). Run bb plugin list.",
    );
  });

  it("prints no plugin line when every plugin runs", async () => {
    stubServer([]);

    await runCommand(["status"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).not.toContain("need attention");
    expect(output).not.toContain("needs attention");
  });

  it("includes the plugins in --json output", async () => {
    stubServer([
      {
        id: "notify",
        status: "incompatible",
        statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
      },
    ]);

    await runCommand(["status", "--json"], register);

    const payload = JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]);
    expect(payload.pluginsNeedingAttention).toEqual([
      {
        id: "notify",
        status: "incompatible",
        statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
      },
    ]);
  });
});

describe("formatPluginAttentionLine", () => {
  it("uses the singular for one plugin", () => {
    expect(
      formatPluginAttentionLine([
        { id: "notify", status: "incompatible", statusDetail: null },
      ]),
    ).toBe(
      "1 plugin needs attention (incompatible: notify). Run bb plugin list.",
    );
  });
});
