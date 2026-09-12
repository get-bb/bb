import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createThread } from "@bb/db";
import { encodeClientTurnRequestIdNumber, type JsonObject } from "@bb/domain";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { installDefaultEnvironmentProviders } from "../helpers/environment-provider.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  startTestServer,
  withTestHarness,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

const PRIVATE_MARKER = "launch-seed-private-marker";

interface ConfigureObservation {
  threadId: string;
  pluginMetadata: JsonObject;
  frozen: boolean;
}

function launchSeed(issueKey: string): JsonObject {
  return {
    issueKey,
    enableIssueTool: true,
    privateMarker: PRIVATE_MARKER,
  };
}

async function installIssueLauncher(
  harness: TestAppHarness,
  pluginsDir: string,
): Promise<() => Promise<ConfigureObservation[]>> {
  const observationsPath = join(pluginsDir, "configure-observations.jsonl");
  const rootDir = join(pluginsDir, "bb-plugin-issue-launcher");
  await mkdir(rootDir, { recursive: true });
  await writeFile(observationsPath, "");
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-issue-launcher",
      version: "0.1.0",
      bb: {
        name: "Issue launcher fixture",
        description: "Configures agents from launch metadata.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `
      import { appendFileSync } from "node:fs";
      export default function plugin(bb: any) {
        bb.agents.registerTool({
          name: "issue_lookup",
          description: "Look up the launch issue.",
          parameters: { type: "object" },
          execute: () => "unused",
        });
        bb.agents.configure((context: any) => {
          const metadata = context.pluginMetadata;
          appendFileSync(
            ${JSON.stringify(observationsPath)},
            JSON.stringify({
              threadId: context.thread.id,
              pluginMetadata: metadata,
              frozen: Object.isFrozen(metadata),
            }) + "\\n",
          );
          return {
            tools: metadata.enableIssueTool === true ? ["issue_lookup"] : [],
            skills: [],
            ...(typeof metadata.issueKey === "string"
              ? { instructions: "Issue: " + metadata.issueKey }
              : {}),
          };
        });
      }
    `,
  );
  const entry = await harness.pluginService.installPath(rootDir);
  expect(entry.status).toBe("running");
  return async () =>
    (await readFile(observationsPath, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): ConfigureObservation => JSON.parse(line));
}

function expectPrivateCommand(command: object, issueKey: string): void {
  const serialized = JSON.stringify(command);
  expect(serialized).toContain(`Issue: ${issueKey}`);
  expect(serialized).not.toContain(PRIVATE_MARKER);
  expect(serialized).not.toContain("pluginMetadata");
}

async function withIssueLauncher(
  run: (args: {
    server: RunningTestServer;
    readObservations: () => Promise<ConfigureObservation[]>;
  }) => Promise<void>,
): Promise<void> {
  const server = await startTestServer();
  installDefaultEnvironmentProviders();
  const pluginsDir = await mkdtemp(
    join(tmpdir(), "bb-thread-plugin-metadata-"),
  );
  try {
    const readObservations = await installIssueLauncher(server, pluginsDir);
    await run({ server, readObservations });
  } finally {
    await server.pluginService.stop();
    await rm(pluginsDir, { recursive: true, force: true });
    await server.close();
  }
}

describe("thread plugin metadata in agent configuration", () => {
  it("configures the first thread.start from the creation seed without serializing it", async () => {
    await withIssueLauncher(async ({ server, readObservations }) => {
      const { host } = seedHostSession(server.deps, {
        id: "host-plugin-metadata-configure",
      });
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
        path: join(server.config.dataDir, "plugin-metadata-workspace"),
      });
      const seed = launchSeed("BB-42");
      const thread = createThread(server.db, server.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        originPluginId: "issue-launcher",
        pluginMetadata: { pluginId: "issue-launcher", metadata: seed },
      });
      const execution = await buildExecutionOptions(
        server.deps,
        { model: "gpt-5" },
        { threadId: thread.id },
      );

      const startCommand = await buildThreadStartCommand(server.deps, {
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

      expect(await readObservations()).toEqual([
        { threadId: thread.id, pluginMetadata: seed, frozen: true },
      ]);
      expect(startCommand.dynamicTools.map((tool) => tool.name)).toContain(
        "issue_lookup",
      );
      expectPrivateCommand(startCommand, "BB-42");

      seedThreadRuntimeState(server.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-plugin-metadata-configure",
        threadId: thread.id,
      });
      const submitCommand = await prepareTurnSubmitCommandPayload(server.deps, {
        environment,
        execution,
        permissionEscalation: "ask",
        input: textInput("continue"),
        target: { mode: "start" },
        thread,
      });
      expect(
        submitCommand.resumeContext.dynamicTools.map((tool) => tool.name),
      ).toContain("issue_lookup");
      expectPrivateCommand(submitCommand, "BB-42");
    });
  });

  it("seeds threads spawned and forked through the plugin SDK before their first queued thread.start", async () => {
    await withIssueLauncher(async ({ server, readObservations }) => {
      const workspacePath = "/tmp/plugin-metadata-spawn-project";
      const { host } = seedHostSession(server.deps, {
        id: "host-plugin-metadata-spawn",
      });
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: workspacePath,
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
        path: workspacePath,
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const api = server.pluginService.getApi("issue-launcher");
      if (!api) throw new Error("issue-launcher is not running");

      const spawnSeed = launchSeed("BB-42");
      const spawned = await api.sdk.threads.spawn({
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: workspacePath },
        },
        pluginMetadata: spawnSeed,
        projectId: project.id,
        prompt: "Investigate the issue",
        providerId: "codex",
      });
      const spawnStart = await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === spawned.id,
      );

      const source = seedThread(server.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedTurnStarted(server.deps, {
        threadId: source.id,
        turnId: "turn-plugin-metadata-fork-source",
        providerThreadId: "provider-plugin-metadata-fork-source",
      });
      const forkSeed = launchSeed("BB-43");
      const fork = await api.sdk.threads.fork({
        input: textInput("Continue the issue"),
        pluginMetadata: forkSeed,
        sourceThreadId: source.id,
      });
      const forkStart = await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );

      const observations = await readObservations();
      expect(
        observations.find((entry) => entry.threadId === spawned.id),
      ).toEqual({
        threadId: spawned.id,
        pluginMetadata: spawnSeed,
        frozen: true,
      });
      expect(observations.find((entry) => entry.threadId === fork.id)).toEqual({
        threadId: fork.id,
        pluginMetadata: forkSeed,
        frozen: true,
      });
      for (const [queued, issueKey] of [
        [spawnStart, "BB-42"],
        [forkStart, "BB-43"],
      ] as const) {
        if (queued.command.type !== "thread.start") {
          throw new Error("Expected a thread.start command");
        }
        expect(queued.command.dynamicTools.map((tool) => tool.name)).toContain(
          "issue_lookup",
        );
        expectPrivateCommand(queued.command, issueKey);
      }
    });
  });

  it("rejects pluginMetadata without a plugin origin before creating a thread", async () => {
    await withTestHarness(async (harness) => {
      const workspacePath = "/tmp/plugin-metadata-orphan-project";
      const { host } = seedHostSession(harness.deps, {
        id: "host-plugin-metadata-orphan",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: workspacePath,
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: workspacePath,
      });

      await expect(
        createThreadFromRequest(harness.deps, {
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: workspacePath },
          },
          input: textInput("Orphaned launch"),
          origin: "sdk",
          pluginMetadata: launchSeed("BB-44"),
          projectId: project.id,
          providerId: "codex",
          startedOnBehalfOf: null,
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: {
          code: "invalid_request",
          message: 'pluginMetadata requires origin "plugin"',
        },
      });
      expect(
        harness.db.$client
          .prepare("SELECT COUNT(*) AS count FROM threads WHERE project_id = ?")
          .get(project.id),
      ).toEqual({ count: 0 });
      expect(
        harness.db.$client
          .prepare("SELECT COUNT(*) AS count FROM thread_plugin_metadata")
          .get(),
      ).toEqual({ count: 0 });
    });
  });
});
