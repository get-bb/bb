import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getThread,
  listPluginSchedules,
  pluginSchedules,
  setExperiments,
} from "@bb/db";
import {
  defaultExperiments,
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
} from "@bb/domain";
import type { PromptInput } from "@bb/domain";
import { sendThreadMessage } from "../../../src/services/threads/thread-send.js";
import { waitForQueuedCommand } from "../../helpers/commands.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../../helpers/test-app.js";

/** The repo's real Linear hero example plugin — installed exactly as
 * shipped, including its install-time frontend bundle build. */
const LINEAR_DIR = fileURLToPath(
  new URL("../../../../../examples/plugins/linear", import.meta.url),
);

// The example pins engines.bb to ">=0.9"; the harness default app version
// ("0.0.0-test") would legitimately mark it incompatible.
const APP_VERSION = "1.0.0";

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  updatedAt: string;
  state: { name: string };
}

const ISSUE_ONE: LinearIssueNode = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Fix the auth token refresh loop",
  description: "Tokens refresh every request.\n\n- reproduce\n- fix",
  updatedAt: "2026-07-01T10:00:00.000Z",
  state: { name: "In Progress" },
};
const ISSUE_TWO: LinearIssueNode = {
  id: "issue-2",
  identifier: "ENG-2",
  title: "Board drag-and-drop is janky",
  description: null,
  updatedAt: "2026-07-01T11:00:00.000Z",
  state: { name: "Todo" },
};

describe("hero plugin: linear", () => {
  let server: RunningTestServer;
  let projectId: string;
  let hostId: string;
  const realFetch = globalThis.fetch;
  /** Mutable fixture: tests change it to simulate Linear-side edits. */
  let issueNodes: LinearIssueNode[] = [ISSUE_ONE, ISSUE_TWO];
  const linearRequests: Array<{
    authorization: string | null;
    variables: { filter?: Record<string, unknown>; first?: number };
  }> = [];

  function setSyncDue(): void {
    server.db
      .update(pluginSchedules)
      .set({ nextRunAt: Date.now() - 60_000 })
      .where(
        and(
          eq(pluginSchedules.pluginId, "linear"),
          eq(pluginSchedules.name, "sync-issues"),
        ),
      )
      .run();
  }

  async function rpc(method: string, input?: unknown): Promise<Response> {
    return await realFetch(
      `${server.baseUrl}/api/v1/plugins/linear/rpc/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input ?? null),
      },
    );
  }

  async function cli(argv: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const response = await realFetch(
      `${server.baseUrl}/api/v1/plugins/linear/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  }

  beforeAll(async () => {
    // Prove the install-time build below really builds: start distless.
    await rm(join(LINEAR_DIR, "dist"), { recursive: true, force: true });

    server = await startTestServer({ appVersion: APP_VERSION });
    setExperiments(server.db, { ...defaultExperiments, plugins: true });
    const { host } = seedHostSession(server.deps);
    hostId = host.id;
    seedPrimaryHost(server.deps, host.id);
    const { project } = seedProjectWithSource(server.deps, {
      hostId: host.id,
      path: "/tmp/linear-hero-source",
    });
    projectId = project.id;

    // Fake ONLY the outbound Linear GraphQL API (the true external
    // boundary); everything else — including the plugin's loopback bb.sdk
    // calls — passes through to the real fetch.
    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://api.linear.app/")) {
        const body = JSON.parse(String(init?.body)) as {
          variables: { filter?: Record<string, unknown>; first?: number };
        };
        const headers = new Headers(init?.headers);
        linearRequests.push({
          authorization: headers.get("authorization"),
          variables: body.variables,
        });
        return new Response(
          JSON.stringify({ data: { issues: { nodes: issueNodes } } }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    }) as typeof fetch;

    server.pluginService.bindSdk({ baseUrl: server.baseUrl });
    const entry = await server.pluginService.installPath(LINEAR_DIR);
    expect(entry.id).toBe("linear");
    // Unconfigured: loaded, honestly reporting what it needs.
    expect(entry.status).toBe("needs-configuration");
    expect(entry.statusDetail).toContain("bb plugin config linear");
  }, 180_000);

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await server.pluginService.stop();
    await server.close();
  });

  it("built the frontend bundle at install time (bb.app declared) and serves it", async () => {
    await stat(join(LINEAR_DIR, "dist", "app.js"));
    await stat(join(LINEAR_DIR, "dist", "app.css"));
    await stat(join(LINEAR_DIR, "dist", "app.meta.json"));

    const entry = server.pluginService
      .list()
      .find((plugin) => plugin.id === "linear");
    expect(entry?.app.hasApp).toBe(true);
    expect(entry?.app.bundle).toMatchObject({
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: PLUGIN_SDK_VERSION,
      compatible: true,
    });
    const jsUrl = entry?.app.bundle?.jsUrl;
    expect(jsUrl).toContain("?h=");
    const js = await realFetch(`${server.baseUrl}${jsUrl}`);
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("__bbPluginRuntime");
  });

  it("an unconfigured sync reports the needs-configuration hint instead of crash-looping", async () => {
    setSyncDue();
    await server.pluginService.sweepDueSchedules(Date.now());
    const row = listPluginSchedules(server.db, "linear")[0];
    expect(row?.name).toBe("sync-issues");
    expect(row?.lastStatus).toBe("error");
    expect(row?.lastError).toContain("bb plugin config linear");
    // No request ever left for Linear.
    expect(linearRequests).toHaveLength(0);
  });

  it("configure + reload → running", async () => {
    await server.pluginService.updateSettings("linear", {
      apiKey: "lin_api_test_key",
      teamKey: "ENG",
      defaultProject: projectId,
    });
    await server.pluginService.reload("linear");
    expect(
      server.pluginService.list().find((plugin) => plugin.id === "linear")
        ?.status,
    ).toBe("running");
  });

  it("the sync schedule fills the sqlite cache and publishes issues-updated only on change", async () => {
    const socket = createMockHubSocket();
    server.hub.subscribe(socket, { kind: "system" });
    const pluginSignals = () =>
      socket.messages
        .map((message) => JSON.parse(message) as { type: string })
        .filter((message) => message.type === "plugin-signal");

    setSyncDue();
    await server.pluginService.sweepDueSchedules(Date.now());

    // The outbound request carried the API key and the team filter.
    expect(linearRequests).toHaveLength(1);
    expect(linearRequests[0]?.authorization).toBe("lin_api_test_key");
    expect(linearRequests[0]?.variables.filter).toMatchObject({
      state: { type: { nin: ["completed", "canceled"] } },
      team: { key: { eq: "ENG" } },
    });

    // Cache populated (via the same rpc the frontend uses).
    const listed = await rpc("listIssues");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      ok: boolean;
      result: { issues: Array<{ identifier: string; state: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.result.issues.map((issue) => issue.identifier).sort()).toEqual(
      ["ENG-1", "ENG-2"],
    );

    // First sync changed the (empty) cache → exactly one signal.
    expect(pluginSignals()).toEqual([
      {
        type: "plugin-signal",
        pluginId: "linear",
        channel: "issues-updated",
        payload: { count: 2 },
      },
    ]);

    // Second sync with identical data → silent.
    setSyncDue();
    await server.pluginService.sweepDueSchedules(Date.now());
    expect(pluginSignals()).toHaveLength(1);

    // Linear-side change → the cache updates and a fresh signal fires.
    issueNodes = [
      { ...ISSUE_ONE, state: { name: "Done" }, updatedAt: "2026-07-02T09:00:00.000Z" },
      ISSUE_TWO,
    ];
    setSyncDue();
    await server.pluginService.sweepDueSchedules(Date.now());
    expect(pluginSignals()).toHaveLength(2);
    const schedule = listPluginSchedules(server.db, "linear")[0];
    expect(schedule?.lastStatus).toBe("ok");
  });

  it("listIssues filters the cache; bb linear issues/sync share the surface via the CLI endpoint", async () => {
    const filtered = await rpc("listIssues", { filter: "drag-and-drop" });
    const filteredBody = (await filtered.json()) as {
      result: { issues: Array<{ identifier: string }> };
    };
    expect(
      filteredBody.result.issues.map((issue) => issue.identifier),
    ).toEqual(["ENG-2"]);

    const issues = await cli(["issues"]);
    expect(issues.exitCode).toBe(0);
    expect(issues.stdout).toContain("ENG-1");
    expect(issues.stdout).toContain("ENG-2");
    expect(issues.stdout).toContain("last synced");

    const requestsBefore = linearRequests.length;
    const sync = await cli(["sync"]);
    expect(sync.exitCode).toBe(0);
    expect(sync.stdout).toContain("Synced 2 open issue(s)");
    expect(linearRequests.length).toBe(requestsBefore + 1);
  });

  it("startWork spawns an attributed thread in the default project and links it", async () => {
    const response = await rpc("startWork", { issueId: "issue-1" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      result: { threadId: string };
    };
    expect(body.ok).toBe(true);
    const threadId = body.result.threadId;

    const thread = getThread(server.db, threadId);
    expect(thread?.originPluginId).toBe("linear");
    expect(thread?.projectId).toBe(projectId);
    expect(thread?.title).toBe("ENG-1: Fix the auth token refresh loop");

    // The link backs issueForThread (the panel tab) and listLinks (the
    // frontend's sync-visible() cache).
    const forThread = await rpc("issueForThread", { threadId });
    const forThreadBody = (await forThread.json()) as {
      result: { issue: { identifier: string } | null };
    };
    expect(forThreadBody.result.issue?.identifier).toBe("ENG-1");

    const links = await rpc("listLinks");
    const linksBody = (await links.json()) as {
      result: { threadIds: string[] };
    };
    expect(linksBody.result.threadIds).toContain(threadId);

    // An unlinked thread resolves to null (the tab stays hidden).
    const unlinked = await rpc("issueForThread", { threadId: "thr_nope" });
    const unlinkedBody = (await unlinked.json()) as {
      result: { issue: unknown };
    };
    expect(unlinkedBody.result.issue).toBeNull();

    // No project anywhere → a clear error, not a broken spawn.
    await server.pluginService.updateSettings("linear", {
      defaultProject: "",
    });
    const noProject = await rpc("startWork", { issueId: "issue-2" });
    expect(noProject.status).toBe(500);
    expect(await noProject.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("defaultProject"),
    });
    await server.pluginService.updateSettings("linear", {
      defaultProject: projectId,
    });
  });

  it("the mention provider searches the cache and resolves issue context at send", async () => {
    const search = await realFetch(
      `${server.baseUrl}/api/v1/plugins/mentions/search?q=eng-1`,
    );
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { ok: boolean; groups: unknown };
    expect(searchBody.ok).toBe(true);
    expect(searchBody.groups).toEqual([
      {
        pluginId: "linear",
        providerId: "linear-issue",
        label: "Linear issues",
        items: [
          {
            itemId: "linear-issue:issue-1",
            title: "ENG-1 Fix the auth token refresh loop",
            subtitle: "Done",
            icon: null,
          },
        ],
      },
    ]);

    // Resolve-at-send: the picked issue rides the dispatched thread.start
    // command as agent-only context.
    const environment = seedEnvironment(server.deps, {
      hostId,
      projectId,
      path: "/tmp/linear-hero-workspace",
      status: "ready",
    });
    const thread = seedThread(server.deps, {
      projectId,
      environmentId: environment.id,
      status: "idle",
    });
    const input: PromptInput[] = [
      {
        type: "text",
        text: "Please pick up @ENG-1",
        mentions: [
          {
            start: 15,
            end: 21,
            resource: {
              kind: "plugin",
              pluginId: "linear",
              itemId: "linear-issue:issue-1",
              label: "ENG-1",
            },
          },
        ],
      },
    ];
    await sendThreadMessage(server.deps, {
      environment,
      payload: {
        input,
        mode: "start",
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
      },
      thread,
      trigger: "user",
    });
    const queued = await waitForQueuedCommand(
      server,
      (candidate) =>
        candidate.command.type === "thread.start" &&
        candidate.command.threadId === thread.id,
    );
    if (queued.command.type !== "thread.start") {
      throw new Error("Expected a thread.start command");
    }
    const agentOnly = queued.command.input.filter(
      (item) => item.type === "text" && item.visibility === "agent-only",
    );
    expect(agentOnly).toHaveLength(1);
    expect(agentOnly[0]).toMatchObject({
      text: expect.stringContaining(
        "Linear issue ENG-1: Fix the auth token refresh loop",
      ),
    });
    expect(agentOnly[0]).toMatchObject({
      text: expect.stringContaining("Tokens refresh every request."),
    });

    // Failure isolation saw exactly the two intended failures: the
    // unconfigured sync and the no-project startWork (stats survive reload).
    const entry = server.pluginService
      .list()
      .find((plugin) => plugin.id === "linear");
    expect(entry?.handlerStats.errorCount).toBe(2);
  });
});
