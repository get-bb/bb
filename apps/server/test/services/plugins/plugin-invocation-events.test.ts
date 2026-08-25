import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME } from "../../../src/services/threads/thread-environment-directory.js";

const globals = globalThis as Record<string, unknown>;

async function writePlugin(
  harness: TestAppHarness,
  id: string,
  serverSource: string,
): Promise<string> {
  const rootDir = join(harness.config.dataDir, "fixtures", `bb-plugin-${id}`);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${id}`,
      version: "0.1.0",
      bb: {
        name: `${id} fixture`,
        description: "Invocation event fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), serverSource);
  return rootDir;
}

async function install(
  harness: TestAppHarness,
  id: string,
  serverSource: string,
): Promise<void> {
  const result = await harness.pluginService.installPath(
    await writePlugin(harness, id, serverSource),
  );
  expect(result.status).toBe("running");
}

async function postToolCall(args: {
  harness: TestAppHarness;
  sessionId: string;
  threadId: string;
  tool: string;
  input?: unknown;
}): Promise<Response> {
  return args.harness.app.request("/internal/session/tool-call", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      threadId: args.threadId,
      providerThreadId: "provider-invocation-test",
      turnId: "turn-invocation-test",
      callId: "call-invocation-test",
      tool: args.tool,
      arguments: args.input,
    }),
  });
}

describe("plugin before-invocation events", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    delete globals.__invocationOrder;
    delete globals.__invocationEvents;
    delete globals.__invocationRelease;
    delete globals.__invokedAgentTools;
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("runs CLI handlers in plugin order, isolates event mutation, and stops at the first block", async () => {
    const order: string[] = [];
    const events: unknown[] = [];
    globals.__invocationOrder = order;
    globals.__invocationEvents = events;

    await install(
      harness,
      "zeta",
      `export default function plugin(bb: any) {
        bb.events.on("experimental_invocation.before", () => {
          globalThis.__invocationOrder.push("zeta");
        });
      }`,
    );
    await install(
      harness,
      "beta",
      `export default function plugin(bb: any) {
        bb.events.on("experimental_invocation.before", (event: any) => {
          globalThis.__invocationOrder.push("beta:" + event.argv[0]);
          return { block: true, reason: "Plugin commands require approval" };
        });
      }`,
    );
    await install(
      harness,
      "alpha",
      `export default function plugin(bb: any) {
        bb.events.on("experimental_invocation.before", (event: any) => {
          globalThis.__invocationOrder.push("alpha");
          globalThis.__invocationEvents.push(event);
          event.argv[0] = "changed";
        });
      }`,
    );

    const response = await harness.app.request(
      "/api/v1/plugins/invocations/preflight",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          argv: ["plugin", "disable", "policy"],
          cwd: "/workspace",
          threadId: "thread-1",
          projectId: "project-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      allowed: false,
      reason: "Plugin commands require approval",
    });
    expect(order).toEqual(["alpha", "beta:plugin"]);
    expect(events).toMatchObject([
      {
        kind: "cli",
        argv: ["changed", "disable", "policy"],
        cwd: "/workspace",
        threadId: "thread-1",
        projectId: "project-1",
      },
    ]);
  });

  it("returns the CLI preflight response head before handlers settle", async () => {
    let release!: () => void;
    globals.__invocationRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    await install(
      harness,
      "waiting-policy",
      `export default function plugin(bb: any) {
        bb.events.on("experimental_invocation.before", async () => {
          await globalThis.__invocationRelease;
        });
      }`,
    );

    const server = serve({
      fetch: harness.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP server address");
      }
      const responsePromise = fetch(
        `http://127.0.0.1:${address.port}/api/v1/plugins/invocations/preflight`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            argv: ["plugin", "list"],
            cwd: "/workspace",
            threadId: null,
            projectId: null,
          }),
        },
      );
      const earlyResponse = await Promise.race([
        responsePromise,
        sleep(1_000).then(() => null),
      ]);

      release();
      const response = earlyResponse ?? (await responsePromise);
      expect(earlyResponse).not.toBeNull();
      await expect(readJson(response)).resolves.toEqual({ allowed: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("blocks core and plugin tools before execution and ignores unsupported tools", async () => {
    const events: string[] = [];
    globals.__invocationEvents = events;
    globals.__invokedAgentTools = 0;
    await install(
      harness,
      "tool-policy",
      `export default function plugin(bb: any) {
        bb.events.on("experimental_invocation.before", (event: any) => {
          if (event.kind !== "agent-tool") return;
          globalThis.__invocationEvents.push(event.name);
          return { block: true, reason: "Tool calls are disabled" };
        });
        bb.agents.registerTool({
          name: "dangerous_fixture_tool",
          description: "A tool that must not execute",
          parameters: { type: "object" },
          execute() {
            globalThis.__invokedAgentTools += 1;
            return "executed";
          },
        });
      }`,
    );

    const { host, session } = seedHostSession(harness.deps, {
      id: "host-invocation-policy",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
    });

    for (const tool of [
      "dangerous_fixture_tool",
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
    ]) {
      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        tool,
        input: {},
      });
      await expect(readJson(response)).resolves.toEqual({
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: "Invocation blocked: Tool calls are disabled",
          },
        ],
      });
    }

    const unsupported = await postToolCall({
      harness,
      sessionId: session.id,
      threadId: thread.id,
      tool: "unsupported_fixture_tool",
    });
    await expect(readJson(unsupported)).resolves.toEqual({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: "Unsupported tool: unsupported_fixture_tool",
        },
      ],
    });
    expect(events).toEqual([
      "dangerous_fixture_tool",
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
    ]);
    expect(globals.__invokedAgentTools).toBe(0);
  });
});
