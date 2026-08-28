import {
  getProjectExecutionDefaults,
  getLatestThreadSequence,
  listEnvironments,
  listQueuedThreadMessages,
  listThreads,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { availableModelFixture } from "../helpers/available-models.js";
import {
  listQueuedCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  registerHostRpcResponder,
  registerProviderHostRpcResponder,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedQueuedMessage,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function threadCreateBody(args: {
  environment:
    | { type: "reuse"; environmentId: string }
    | {
        type: "host";
        hostId: string;
        workspace: {
          type: "managed-worktree";
          baseBranch: { kind: "default" };
        };
      };
  model: string;
  projectId: string;
  reasoningLevel: "low" | "medium" | "high";
}) {
  return {
    origin: "cli",
    projectId: args.projectId,
    providerId: "claude-code",
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    input: [{ type: "text", text: "Validate before doing work" }],
    environment: args.environment,
  };
}

describe("public thread execution-selection validation", () => {
  it("exposes the same typed target-aware policy for SDK/plugin preflights", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-sdk-primary",
      });
      const remote = seedHostSession(harness.deps, { id: "host-sdk-remote" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const primaryResponder = registerProviderHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [availableModelFixture({ model: "primary-model" })],
            selectedOnlyModels: [],
          },
        },
      });
      const remoteResponder = registerProviderHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "remote-model",
                reasoningLevels: ["low"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });

      const response = await harness.app.request(
        "/api/v1/system/execution-selection/validate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: remote.host.id,
            providerId: "claude-code",
            model: "remote-model",
            reasoningLevel: "medium",
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "reasoning_level_not_supported",
      });
      expect(primaryResponder.requests).toEqual([]);
      expect(
        remoteResponder.requests.map((request) => request.command.type),
      ).toEqual(["provider.list_models"]);
    });
  });

  it.each([
    {
      name: "a model absent from the authoritative catalog",
      model: "claude-does-not-exist-9",
      reasoningLevel: "low" as const,
      expectedCode: "model_not_available",
      expectedMessage: "claude-does-not-exist-9",
    },
    {
      name: "reasoning absent from the selected model contract",
      model: "claude-haiku-test",
      reasoningLevel: "medium" as const,
      expectedCode: "reasoning_level_not_supported",
      expectedMessage: "medium",
    },
  ])(
    "rejects $name before managed-environment and thread provisioning",
    async ({ model, reasoningLevel, expectedCode, expectedMessage }) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const responder = registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          restoreCommandCaptureAfterResponse: true,
          modelsByProviderId: {
            "claude-code": {
              models: [
                availableModelFixture({
                  model: "claude-haiku-test",
                  reasoningLevels: ["low"],
                  isDefault: true,
                }),
              ],
              selectedOnlyModels: [],
            },
          },
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/execution-selection-managed-source",
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            threadCreateBody({
              projectId: project.id,
              model,
              reasoningLevel,
              environment: {
                type: "host",
                hostId: host.id,
                workspace: {
                  type: "managed-worktree",
                  baseBranch: { kind: "default" },
                },
              },
            }),
          ),
        });

        expect(response.status).toBe(400);
        await expect(readJson(response)).resolves.toMatchObject({
          code: expectedCode,
          message: expect.stringContaining(expectedMessage),
        });
        expect(listThreads(harness.db, { projectId: project.id })).toEqual([]);
        expect(listEnvironments(harness.db, project.id)).toEqual([]);
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual(["provider.list_models"]);
        expect(listQueuedCommands(harness, "environment.provision")).toEqual(
          [],
        );
        expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
        expect(listQueuedCommands(harness, "turn.submit")).toEqual([]);
      });
    },
  );

  it("validates against the explicitly targeted remote machine catalog", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-selection-primary",
      });
      const remote = seedHostSession(harness.deps, {
        id: "host-selection-remote",
      });
      seedPrimaryHost(harness.deps, primary.host.id);
      const primaryResponder = registerProviderHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [availableModelFixture({ model: "primary-only" })],
            selectedOnlyModels: [],
          },
        },
      });
      const remoteResponder = registerProviderHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              {
                ...availableModelFixture({
                  model: "remote-only",
                  reasoningLevels: ["high"],
                  defaultReasoningLevel: "high",
                }),
                id: "remote-alias",
              },
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: remote.host.id,
        path: "/tmp/execution-selection-remote-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remote.host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-remote-source",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          threadCreateBody({
            projectId: project.id,
            model: "remote-alias",
            reasoningLevel: "high",
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          }),
        ),
      });

      expect(response.status).toBe(201);
      expect(primaryResponder.requests).toEqual([]);
      expect(
        remoteResponder.requests.map((request) => request.command.type),
      ).toEqual(["provider.list_models"]);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: { model: "remote-only" },
      });
    });
  });

  it("validates a project-default plugin spawn on the resolved project host", async () => {
    await withTestHarness(async (harness) => {
      const target = seedHostSession(harness.deps, {
        id: "host-project-default-target",
      });
      const unrelated = seedHostSession(harness.deps, {
        id: "host-project-default-unrelated",
      });
      seedPrimaryHost(harness.deps, target.host.id);
      const unrelatedResponder = registerProviderHostRpcResponder(harness, {
        hostId: unrelated.host.id,
        sessionId: unrelated.session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "unrelated-only",
                reasoningLevels: ["low"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const targetResponder = registerHostRpcResponder(harness, {
        hostId: target.host.id,
        sessionId: target.session.id,
        handle(request) {
          if (request.command.type === "host.list_branches") {
            return {
              ok: true,
              result: {
                branches: ["main"],
                branchesTruncated: false,
                checkout: {
                  kind: "branch",
                  branchName: "main",
                  headSha: "abc123",
                },
                defaultBranch: "main",
                defaultBranchRelation: "equal",
                hasUncommittedChanges: false,
                operation: { kind: "none" },
                originDefaultBranch: "origin/main",
                remoteBranches: ["origin/main"],
                remoteBranchesTruncated: false,
                selectedBranch: null,
              },
            };
          }
          if (request.command.type === "provider.list_models") {
            return {
              ok: true,
              result: {
                models: [
                  availableModelFixture({
                    model: "target-only",
                    reasoningLevels: ["low"],
                    isDefault: true,
                  }),
                ],
                selectedOnlyModels: [],
              },
            };
          }
          throw new Error(`Unexpected host command ${request.command.type}`);
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: target.host.id,
        path: "/tmp/execution-selection-project-default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "plugin",
          originPluginId: "tasks",
          projectId: project.id,
          providerId: "claude-code",
          model: "unrelated-only",
          reasoningLevel: "low",
          input: [{ type: "text", text: "Dispatch the preset" }],
          environment: { type: "project-default" },
        }),
      });

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "model_not_available",
      });
      expect(
        targetResponder.requests.map((request) => request.command.type),
      ).toEqual(["host.list_branches", "provider.list_models"]);
      expect(unrelatedResponder.requests).toEqual([]);
      expect(listThreads(harness.db, { projectId: project.id })).toEqual([]);
      expect(listEnvironments(harness.db, project.id)).toEqual([]);
    });
  });

  it("uses a registered fallback catalog after a transient probe failure", async () => {
    await withTestHarness(async (harness) => {
      const fallbackModel = harness.deps.providerRegistry
        .get("claude-code")
        ?.fallbackModels.find((model) => model.isDefault);
      if (!fallbackModel) {
        throw new Error("Expected the Claude Code fallback catalog");
      }
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelErrorsByProviderId: {
          "claude-code": {
            errorCode: "command_timeout",
            errorMessage: "model list timed out",
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-fallback-catalog",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-fallback-catalog",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "sdk",
          projectId: project.id,
          providerId: "claude-code",
          model: fallbackModel.model,
          reasoningLevel: fallbackModel.defaultReasoningEffort,
          input: [{ type: "text", text: "Use the fallback catalog" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: {
          model: fallbackModel.model,
          reasoningLevel: fallbackModel.defaultReasoningEffort,
        },
      });
    });
  });

  it("keeps a transient fallback from replacing a remembered model it does not contain", async () => {
    await withTestHarness(async (harness) => {
      const rememberedModel = "claude-sonnet-4-6";
      expect(
        harness.deps.providerRegistry
          .get("claude-code")
          ?.fallbackModels.some(
            (model) =>
              model.id === rememberedModel || model.model === rememberedModel,
          ),
      ).toBe(false);
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelErrorsByProviderId: {
          "claude-code": {
            errorCode: "command_timeout",
            errorMessage: "model list timed out",
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-fallback-remembered",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-fallback-remembered",
      });
      const rememberedDefaults = upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: rememberedModel,
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const preflight = await harness.app.request(
        "/api/v1/system/execution-selection/validate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            environmentId: environment.id,
            providerId: "claude-code",
            model: rememberedModel,
            reasoningLevel: "high",
          }),
        },
      );
      expect(preflight.status).toBe(503);
      await expect(readJson(preflight)).resolves.toMatchObject({
        code: "model_catalog_unavailable",
        retryable: true,
      });
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelErrorsByProviderId: {
          "claude-code": {
            errorCode: "command_timeout",
            errorMessage: "model list timed out",
          },
        },
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "claude-code",
          input: [{ type: "text", text: "Keep my remembered model" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(503);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "model_catalog_unavailable",
        retryable: true,
      });
      expect(
        getProjectExecutionDefaults(harness.db, { projectId: project.id }),
      ).toEqual(rememberedDefaults);
      expect(listThreads(harness.db, { projectId: project.id })).toEqual([]);
      expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
    });
  });

  it("accepts a selected-only model through explicit create and SDK preflight paths", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-current",
                reasoningLevels: ["low"],
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [
              availableModelFixture({
                model: "claude-selected-only",
                reasoningLevels: ["high"],
                defaultReasoningLevel: "high",
              }),
            ],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-selected-only",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-selected-only",
      });

      const preflight = await harness.app.request(
        "/api/v1/system/execution-selection/validate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            environmentId: environment.id,
            providerId: "claude-code",
            model: "claude-selected-only",
            reasoningLevel: "high",
          }),
        },
      );
      expect(preflight.status).toBe(200);

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          threadCreateBody({
            projectId: project.id,
            model: "claude-selected-only",
            reasoningLevel: "high",
            environment: { type: "reuse", environmentId: environment.id },
          }),
        ),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: {
          model: "claude-selected-only",
          reasoningLevel: "high",
        },
      });
    });
  });

  it("uses an explicit model's default reasoning instead of an inherited project level", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-haiku-low-only",
                reasoningLevels: ["low"],
                defaultReasoningLevel: "low",
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-explicit-model-reasoning",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-explicit-model-reasoning",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: "claude-opus-high",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "claude-code",
          model: "claude-haiku-low-only",
          reasoningLevel: "high",
          executionInputSources: {
            providerId: "explicit",
            model: "explicit",
          },
          input: [{ type: "text", text: "Use Haiku defaults" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: {
          model: "claude-haiku-low-only",
          reasoningLevel: "low",
        },
      });
    });
  });

  it("retains compatible inherited reasoning for an explicit model", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-next",
                reasoningLevels: ["low", "medium", "high"],
                defaultReasoningLevel: "high",
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-compatible-reasoning",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-compatible-reasoning",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: "claude-previous",
        reasoningLevel: "low",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "sdk",
          projectId: project.id,
          providerId: "claude-code",
          model: "claude-next",
          input: [{ type: "text", text: "Keep compatible reasoning" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: { model: "claude-next", reasoningLevel: "low" },
      });
    });
  });

  it("recovers a stale implicit project model to the current catalog default", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-current-default",
                reasoningLevels: ["low"],
                defaultReasoningLevel: "low",
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-stale-default",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-stale-default",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: "claude-removed",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "sdk",
          projectId: project.id,
          providerId: "claude-code",
          input: [{ type: "text", text: "Recover stale defaults" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: {
          model: "claude-current-default",
          reasoningLevel: "low",
        },
      });
    });
  });

  it("recovers stale implicit reasoning for a still-available model", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-current",
                reasoningLevels: ["low", "medium"],
                defaultReasoningLevel: "medium",
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-stale-reasoning",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-stale-reasoning",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: "claude-current",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "sdk",
          projectId: project.id,
          input: [{ type: "text", text: "Recover stale reasoning" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: {
          model: "claude-current",
          reasoningLevel: "medium",
        },
      });
    });
  });

  it("recovers implicit reasoning to the advertised ladder when its default is inconsistent", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-inconsistent-default",
                reasoningLevels: ["low"],
                defaultReasoningLevel: "medium",
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-inconsistent-reasoning",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-inconsistent-reasoning",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "sdk",
          projectId: project.id,
          providerId: "claude-code",
          input: [{ type: "text", text: "Use a supported default" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: {
          model: "claude-inconsistent-default",
          reasoningLevel: "low",
        },
      });
    });
  });

  it("rejects an invalid explicit send before appending or submitting a turn", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-valid",
                reasoningLevels: ["low"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-send",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-send",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        model: "claude-valid",
        providerThreadId: "provider-selection-send",
        reasoningLevel: "low",
        threadId: thread.id,
      });
      const sequenceBefore = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "auto",
            input: [{ type: "text", text: "Do not send this" }],
            model: "claude-does-not-exist-9",
            reasoningLevel: "low",
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "model_not_available",
      });
      expect(getLatestThreadSequence(harness.db, { threadId: thread.id })).toBe(
        sequenceBefore,
      );
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["provider.list_models"],
      );
      expect(listQueuedCommands(harness, "turn.submit")).toEqual([]);
    });
  });

  it("queues explicit execution preferences without probing a live catalog", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelErrorsByProviderId: {
          "claude-code": {
            errorCode: "provider_unavailable",
            errorMessage: "provider is temporarily offline",
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-offline-queue",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-offline-queue",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        model: "claude-current",
        providerThreadId: "provider-offline-queue",
        reasoningLevel: "low",
        threadId: thread.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queue while offline" }],
            model: "claude-next",
            reasoningLevel: "high",
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(responder.requests).toEqual([]);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([
        expect.objectContaining({
          model: "claude-next",
          reasoningLevel: "high",
        }),
      ]);
    });
  });

  it("drains a queued message that replays a selected-only model", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          codex: {
            models: [
              availableModelFixture({
                model: "gpt-current",
                reasoningLevels: ["medium"],
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [
              availableModelFixture({
                model: "gpt-selected-only",
                reasoningLevels: ["high"],
                defaultReasoningLevel: "high",
              }),
            ],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-queued-selected-only",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-queued-selected-only",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        model: "gpt-selected-only",
        providerThreadId: "provider-queued-selected-only",
        reasoningLevel: "high",
        threadId: thread.id,
      });
      const queuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: [{ type: "text", text: "Replay selected-only", mentions: [] }],
        model: "gpt-selected-only",
        reasoningLevel: "high",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "auto" }),
        },
      );

      expect(response.status).toBe(200);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      const queuedSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "turn.submit",
      );
      expect(queuedSubmit.command).toMatchObject({
        options: { model: "gpt-selected-only", reasoningLevel: "high" },
      });
    });
  });

  it("retains an invalid queued head without blocking later valid input", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          codex: {
            models: [
              availableModelFixture({
                model: "gpt-current",
                reasoningLevels: ["medium"],
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-queued-invalid-head",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-queued-invalid-head",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        model: "gpt-current",
        providerThreadId: "provider-queued-invalid-head",
        reasoningLevel: "medium",
        threadId: thread.id,
      });
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: [{ type: "text", text: "Invalid first", mentions: [] }],
        model: "gpt-retired",
        reasoningLevel: "medium",
      });
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: [{ type: "text", text: "Valid second", mentions: [] }],
        model: "gpt-current",
        reasoningLevel: "medium",
      });
      const warnings: string[] = [];
      const logger = harness.deps.logger;
      harness.deps.logger = {
        ...logger,
        warn(_fields: unknown, message?: string): void {
          warnings.push(message ?? "");
        },
      };

      await expect(
        sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).resolves.toBe(true);

      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([
        expect.objectContaining({ model: "gpt-retired" }),
      ]);
      expect(warnings).toContain(
        "Queued message auto-send skipped an unavailable execution selection",
      );
      const queuedSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "turn.submit",
      );
      expect(queuedSubmit.command).toMatchObject({
        input: [expect.objectContaining({ text: "Valid second" })],
        options: { model: "gpt-current", reasoningLevel: "medium" },
      });

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "stop.requested" },
        threadId: thread.id,
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "stop.settled" },
        threadId: thread.id,
      });
      responder.unregister();
      const updatedSession = seedSession(harness.deps, host.id);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: updatedSession.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          codex: {
            models: [
              availableModelFixture({
                model: "gpt-current",
                reasoningLevels: ["medium"],
                isDefault: true,
              }),
              availableModelFixture({
                model: "gpt-retired",
                reasoningLevels: ["medium"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });

      await expect(
        sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).resolves.toBe(true);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("keeps an inherited selected-only model valid after the active catalog changes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-current",
                reasoningLevels: ["low"],
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [
              availableModelFixture({
                model: "claude-remembered",
                reasoningLevels: ["low"],
              }),
            ],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-remembered",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-remembered",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: "claude-remembered",
        reasoningLevel: "low",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "claude-code",
          input: [{ type: "text", text: "Use the remembered model" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: { model: "claude-remembered", reasoningLevel: "low" },
      });
    });
  });

  it("allows an operator-configured unlisted model from the effective catalog", async () => {
    await withTestHarness(
      {
        customModels: [
          {
            providerId: "claude-code",
            model: "claude-private-preview",
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const responder = registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          restoreCommandCaptureAfterResponse: true,
          modelsByProviderId: {
            "claude-code": {
              models: [availableModelFixture({ model: "catalog-model" })],
              selectedOnlyModels: [],
            },
          },
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/execution-selection-custom-source",
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/execution-selection-custom-source",
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            threadCreateBody({
              projectId: project.id,
              model: "claude-private-preview",
              reasoningLevel: "medium",
              environment: {
                type: "reuse",
                environmentId: environment.id,
              },
            }),
          ),
        });

        expect(response.status).toBe(201);
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual(["provider.list_models"]);
      },
    );
  });
});
