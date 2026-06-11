import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerAppCommands } from "../../commands/app.js";

describe("bb app command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerAppCommands(program, () => "http://server");

  it("bb app list renders resolved app summaries", async () => {
    const apps = [
      {
        applicationId: "status",
        name: "Project Status",
        entry: { path: "index.html", kind: "html" },
        capabilities: ["data", "message"],
        icon: { kind: "builtin", name: "ListTodo" },
        source: null,
      },
      {
        applicationId: "demo",
        name: "Demo",
        entry: { path: "readme.md", kind: "md" },
        capabilities: [],
        icon: {
          kind: "logo",
          url: "/api/v1/apps/demo/icon",
        },
        source: null,
      },
    ];
    const get = vi.fn(async () => apps);
    stubServerApi({ "v1.apps.$get": get });

    await runCommand(["app", "list"], register);

    expect(get).toHaveBeenCalledWith();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Application ID                    Name                      Entry                     Capabilities              Icon                Source\n--------------------------------  ------------------------  ------------------------  ------------------------  ------------------  ------------------------\nstatus                            Project Status            html:index.html           data,message              ListTodo            -\n--------------------------------  ------------------------  ------------------------  ------------------------  ------------------  ------------------------\ndemo                              Demo                      md:readme.md              -                         logo                -",
    ]);
  });

  it("bb app new derives a slug from display name", async () => {
    const created = {
      applicationId: "review-board",
      name: "Review Board",
      entry: { path: "index.html", kind: "html" },
      capabilities: ["data", "message"],
      icon: { kind: "builtin", name: "ListTodo" },
      appsRootPath: "/tmp/bb-data/apps",
      appRootPath: "/tmp/bb-data/apps/review-board",
      appDataPath: "/tmp/bb-data/app-data/review-board",
    };
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.apps.$post": post });

    await runCommand(["app", "new", "--name", "Review Board"], register);

    expect(post).toHaveBeenCalledWith({
      json: { applicationId: "review-board", name: "Review Board" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Application ID: review-board",
      "  Name:          Review Board",
      "  Entry:         html:index.html",
      "  Capabilities:  data,message",
      "  Icon:          ListTodo",
      "  App root:      /tmp/bb-data/apps/review-board",
      "  App data path: /tmp/bb-data/app-data/review-board",
    ]);
  });

  it("bb app new honors an explicit slug", async () => {
    const created = {
      applicationId: "status",
      name: "status",
      entry: { path: "index.html", kind: "html" },
      capabilities: ["data", "message"],
      icon: { kind: "builtin", name: "ListTodo" },
      appsRootPath: "/tmp/bb-data/apps",
      appRootPath: "/tmp/bb-data/apps/status",
      appDataPath: "/tmp/bb-data/app-data/status",
    };
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.apps.$post": post });

    await runCommand(["app", "new", "--slug", "status"], register);

    expect(post).toHaveBeenCalledWith({
      json: { applicationId: "status" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Application ID: status",
      "  Name:          status",
      "  Entry:         html:index.html",
      "  Capabilities:  data,message",
      "  Icon:          ListTodo",
      "  App root:      /tmp/bb-data/apps/status",
      "  App data path: /tmp/bb-data/app-data/status",
    ]);
  });

  it("bb app current renders runtime app paths", async () => {
    vi.stubEnv("BB_APP_ID", "current");
    vi.stubEnv("BB_APP_ROOT", "/tmp/bb-data/apps/current");
    vi.stubEnv("BB_APP_DATA_PATH", "/tmp/bb-data/app-data/current");
    vi.stubEnv("BB_APPS_ROOT", "/tmp/bb-data/apps");

    await runCommand(["app", "current"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Application ID: current",
      "  App root:      /tmp/bb-data/apps/current",
      "  App data path: /tmp/bb-data/app-data/current",
      "  Apps root:     /tmp/bb-data/apps",
    ]);
  });

  it("bb app source add posts the request and renders the source status", async () => {
    const status = {
      name: "team-apps",
      origin: "https://github.com/acme/team-apps.git",
      ref: null,
      lastSyncStartedAt: "2026-06-05T00:00:00.000Z",
      lastSyncedAt: "2026-06-05T00:00:01.000Z",
      lastCommitSha: "abcdef1234567890",
      lastError: null,
      syncing: false,
      apps: [
        { applicationId: "hello", status: "installed", error: null },
        {
          applicationId: "broken",
          status: "invalid",
          error: "manifest.json failed validation",
        },
      ],
    };
    const post = vi.fn(async () => status);
    stubServerApi({ "v1.app-sources.$post": post });

    await runCommand(
      ["app", "source", "add", "https://github.com/acme/team-apps.git"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: { origin: "https://github.com/acme/team-apps.git" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Source team-apps",
      "  Origin:      https://github.com/acme/team-apps.git",
      "  Ref:         (default branch)",
      "  Commit:      abcdef1234567890",
      "  Last synced: 2026-06-05T00:00:01.000Z",
      "  Error:       -",
      "  Apps:",
      "    hello                       installed",
      "    broken                      invalid  manifest.json failed validation",
    ]);
  });

  it("bb app source sync forwards force after --yes", async () => {
    const status = {
      name: "team-apps",
      origin: "https://github.com/acme/team-apps.git",
      ref: "v1",
      lastSyncStartedAt: "2026-06-05T00:00:00.000Z",
      lastSyncedAt: "2026-06-05T00:00:01.000Z",
      lastCommitSha: "abcdef1234567890",
      lastError: null,
      syncing: false,
      apps: [],
    };
    const post = vi.fn(async () => status);
    stubServerApi({ "v1.app-sources.:name.sync.$post": post });

    await runCommand(
      ["app", "source", "sync", "team-apps", "--force", "--yes"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { name: "team-apps" },
      json: { force: true },
    });
  });

  it("bb app source remove deletes after --yes", async () => {
    const del = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.app-sources.:name.$delete": del });

    await runCommand(
      ["app", "source", "remove", "team-apps", "--yes"],
      register,
    );

    expect(del).toHaveBeenCalledWith({ param: { name: "team-apps" } });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "App source team-apps removed",
    ]);
  });

  it("bb app source detach posts the detach route", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.apps.:applicationId.detach.$post": post });

    await runCommand(["app", "source", "detach", "hello"], register);

    expect(post).toHaveBeenCalledWith({ param: { applicationId: "hello" } });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "App hello detached; it is now locally managed",
    ]);
  });

  it("bb app data read reports a missing data path for an existing app", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            code: "ENOENT",
            message: "App data not found: state.json",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    await expect(
      runCommand(["app", "data", "read", "status", "state.json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: App data path not found: state.json",
    );
  });

  it("bb app data read surfaces the server error for a missing app", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: "app_missing", message: "App not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    await expect(
      runCommand(["app", "data", "read", "ghost", "state.json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: HTTP 404: App not found",
    );
  });
});
