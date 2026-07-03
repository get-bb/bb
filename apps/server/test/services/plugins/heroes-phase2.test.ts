import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments, setThreadExecutionOverride } from "@bb/db";
import { defaultExperiments, encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { PromptInput } from "@bb/domain";
import { buildThreadStartCommand } from "../../../src/services/threads/thread-commands.js";
import { UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME } from "../../../src/services/threads/thread-environment-directory.js";
import { resolveExecutionOptions } from "../../../src/services/threads/thread-runtime-config.js";
import { sendThreadMessage } from "../../../src/services/threads/thread-send.js";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import { textInput } from "../../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  startTestServer,
  type RunningTestServer,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/** The repo's real Phase-2 hero example plugins — installed exactly as
 * shipped. */
const EXAMPLES_DIR = fileURLToPath(
  new URL("../../../../../examples/plugins", import.meta.url),
);

// The examples pin engines.bb to ">=0.9"; the harness default app version
// ("0.0.0-test") would legitimately mark them incompatible.
const APP_VERSION = "1.0.0";

describe("hero plugin: small-ux-pack", () => {
  let server: RunningTestServer;
  let threadId: string;

  beforeEach(async () => {
    server = await startTestServer({ appVersion: APP_VERSION });
    setExperiments(server.db, { ...defaultExperiments, plugins: true });
    // The thread action sends a follow-up through the plugin's loopback
    // bb.sdk, so the SDK must be bound to the listening server.
    server.pluginService.bindSdk({ baseUrl: server.baseUrl });

    const { host } = seedHostSession(server.deps);
    const { project } = seedProjectWithSource(server.deps, {
      hostId: host.id,
      path: "/tmp/small-ux-pack-source",
    });
    const environment = seedEnvironment(server.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/small-ux-pack-workspace",
      status: "ready",
    });
    const thread = seedThread(server.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "idle",
      title: "Fix the login flow",
    });
    threadId = thread.id;
    // A thread the user has already run once carries a stored model; the
    // plugin's follow-up send inherits it instead of naming one.
    setThreadExecutionOverride(server.db, {
      threadId,
      modelOverride: "gpt-5",
    });
    seedThread(server.deps, {
      projectId: project.id,
      title: "Ship the mentions popover",
    });

    const entry = await server.pluginService.installPath(
      join(EXAMPLES_DIR, "small-ux-pack"),
    );
    expect(entry.id).toBe("small-ux-pack");
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await server.pluginService.stop();
    await server.close();
  });

  async function post(path: string, body: unknown): Promise<Response> {
    return await fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("lists both thread actions (with confirm metadata) in contributions", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/v1/plugins/contributions`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      threadActions: unknown;
    };
    expect(body.threadActions).toEqual([
      {
        pluginId: "small-ux-pack",
        id: "summarize-thread",
        title: "Summarize thread",
        icon: "ListChecks",
        confirm: "Ask this thread's agent for a three-bullet summary?",
      },
      {
        pluginId: "small-ux-pack",
        id: "copy-status",
        title: "Copy status",
        icon: "Clipboard",
        confirm: null,
      },
    ]);
  });

  it("Summarize thread sends a follow-up prompt via bb.sdk and returns a success toast", async () => {
    const response = await post(
      "/api/v1/plugins/small-ux-pack/actions/summarize-thread",
      { threadId },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      toast: {
        kind: "success",
        message: "Summary requested — watch for the agent's reply.",
      },
    });

    // The idle thread got a real turn: the send dispatched a thread.start
    // command carrying the summarize prompt.
    const queued = await waitForQueuedCommand(
      server,
      (candidate) =>
        candidate.command.type === "thread.start" &&
        candidate.command.threadId === threadId,
    );
    if (queued.command.type !== "thread.start") {
      throw new Error("Expected a thread.start command");
    }
    expect(queued.command.input[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Summarize this thread so far"),
    });

    const entry = server.pluginService
      .list()
      .find((plugin) => plugin.id === "small-ux-pack");
    expect(entry?.handlerStats.errorCount).toBe(0);
  });

  it("Copy status demonstrates the error-toast path: a 500 envelope carrying the thread status", async () => {
    const response = await post(
      "/api/v1/plugins/small-ux-pack/actions/copy-status",
      { threadId },
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    // The handler really fetched the thread over bb.sdk before throwing.
    expect(body.error).toContain('thread status is "idle"');
    expect(body.error).toContain("error toast");

    const entry = server.pluginService
      .list()
      .find((plugin) => plugin.id === "small-ux-pack");
    expect(entry?.handlerStats.errorCount).toBe(1);
  });

});

describe("hero plugin: agent-enrichment (Phase 2 surfaces)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness({ appVersion: APP_VERSION });
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    const entry = await harness.pluginService.installPath(
      join(EXAMPLES_DIR, "agent-enrichment"),
    );
    expect(entry.id).toBe("agent-enrichment");
    expect(entry.statusDetail).toBeNull();
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  function seedThreadFixture(value: number) {
    const { host, session } = seedHostSession(harness.deps, {
      id: `host-enrichment-${value}`,
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      path: `/tmp/enrichment-${value}`,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: `/tmp/enrichment-${value}`,
      status: "ready",
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "idle",
    });
    return { environment, project, session, thread };
  }

  it("docs_search and the repo-conventions skill ride thread.start", async () => {
    const { environment, project, thread } = seedThreadFixture(1);
    const execution = await resolveExecutionOptions(harness.deps, {
      threadId: thread.id,
      requestedExecution: { model: "gpt-5", source: "client/turn/requested" },
    });
    const command = await buildThreadStartCommand(harness.deps, {
      environment,
      execution,
      fork: null,
      permissionEscalation: "ask",
      input: textInput("hello"),
      projectId: project.id,
      providerId: "codex",
      requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
      syncGeneratedTitle: false,
      thread,
    });

    // Native tool: listed in dynamicTools with the zod-derived JSON schema.
    expect(command.dynamicTools.map((tool) => tool.name)).toEqual([
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
      "docs_search",
    ]);
    const docsSearch = command.dynamicTools.find(
      (tool) => tool.name === "docs_search",
    );
    expect(docsSearch?.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    expect(command.instructions).toContain(
      'The following instructions come from the BB plugin "agent-enrichment" for its tool "docs_search":',
    );
    expect(command.instructions).toContain(
      "Use the docs_search tool to look up repo conventions",
    );

    // Skills tier: the plugin's skills/ directory is injected.
    expect(command.injectedSkillSources).toContainEqual(
      expect.objectContaining({
        name: "repo-conventions",
        sourceRootPath: join(
          EXAMPLES_DIR,
          "agent-enrichment",
          "skills",
          "repo-conventions",
        ),
      }),
    );
  });

  it("the internal tool-call route dispatches docs_search; the CLI command shares its kv cache", async () => {
    const { session, thread } = seedThreadFixture(2);
    const postToolCall = (args: unknown) =>
      harness.app.request("/internal/session/tool-call", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          threadId: thread.id,
          providerThreadId: "provider-enrichment",
          turnId: "turn-enrichment",
          callId: "call-enrichment",
          tool: "docs_search",
          arguments: args,
        }),
      });

    const response = await postToolCall({ query: "conventional commits" });
    expect(response.status).toBe(200);
    const result = (await readJson(response)) as {
      success: boolean;
      contentItems: Array<{ text: string }>;
    };
    expect(result.success).toBe(true);
    expect(result.contentItems[0].text).toContain("conventions.md");
    expect(result.contentItems[0].text).toContain("conventional commits");

    // Zod-invalid arguments are a tool error, not a plugin error.
    const invalid = await postToolCall({});
    const invalidResult = (await readJson(invalid)) as {
      success: boolean;
      contentItems: Array<{ text: string }>;
    };
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.contentItems[0].text).toContain(
      'Invalid arguments for tool "docs_search"',
    );
    expect(
      harness.pluginService
        .list()
        .find((plugin) => plugin.id === "agent-enrichment")?.handlerStats
        .errorCount,
    ).toBe(0);

    // The CLI command and the native tool share one search helper — the
    // tool call above is now `bb docs last`.
    const last = await harness.app.request(
      "http://127.0.0.1:3334/api/v1/plugins/agent-enrichment/cli",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv: ["last"] }),
      },
    );
    expect(last.status).toBe(200);
    const lastBody = (await last.json()) as { exitCode: number; stdout: string };
    expect(lastBody.exitCode).toBe(0);
    expect(lastBody.stdout).toContain('"conventional commits"');
  });

  it("the docs mention provider searches titles and resolves the doc body at send", async () => {
    const search = await harness.app.request(
      "http://127.0.0.1:3334/api/v1/plugins/mentions/search?q=test",
    );
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      ok: boolean;
      groups: unknown;
    };
    expect(searchBody.ok).toBe(true);
    expect(searchBody.groups).toEqual([
      {
        pluginId: "agent-enrichment",
        providerId: "docs",
        label: "Plugin docs",
        items: [
          {
            itemId: "docs:testing.md",
            title: "Testing",
            subtitle: "testing.md",
            icon: null,
          },
        ],
      },
    ]);

    // Resolve-at-send: the picked doc's body is attached as agent-only
    // context on the dispatched thread.start command.
    const { environment, thread } = seedThreadFixture(3);
    const input: PromptInput[] = [
      {
        type: "text",
        text: "Follow @Repo conventions please",
        mentions: [
          {
            start: 7,
            end: 24,
            resource: {
              kind: "plugin",
              pluginId: "agent-enrichment",
              itemId: "docs:conventions.md",
              label: "Repo conventions",
            },
          },
        ],
      },
    ];
    await sendThreadMessage(harness.deps, {
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
      harness,
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
      text: expect.stringContaining("conventional commits"),
    });
    expect(agentOnly[0]).toMatchObject({
      text: expect.stringContaining('resolved by plugin "agent-enrichment"'),
    });
  });

  it("mention resolve rejects item ids outside the docs dir, blocking the send", async () => {
    const { environment, thread } = seedThreadFixture(4);
    await expect(
      sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [
            {
              type: "text",
              text: "@Sneaky",
              mentions: [
                {
                  start: 0,
                  end: 7,
                  resource: {
                    kind: "plugin",
                    pluginId: "agent-enrichment",
                    itemId: "docs:../server.ts",
                    label: "Sneaky",
                  },
                },
              ],
            },
          ],
          mode: "start",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      }),
    ).rejects.toMatchObject({
      status: 422,
      body: {
        code: "plugin_mention_resolve_failed",
        message: expect.stringContaining("unknown doc"),
      },
    });
    expect(
      listQueuedThreadCommands(harness, "thread.start", thread.id),
    ).toHaveLength(0);
  });
});
