import { expect, it } from "vitest";
import { getStoredProviderModelCatalog, updateHost } from "@bb/db";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { requireRegistration } from "../helpers/provider-model-catalogs.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

it.each([
  ["persistent", "host"],
  ["ephemeral", "host"],
  ["ephemeral", "workspace"],
] as const)(
  "uses the active %s host catalog with %s scope for reasoning",
  async (hostType, catalogScope) => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      updateHost(harness.db, harness.hub, host.id, { type: hostType });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const workspacePath = "/tmp/reasoning-catalog";
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: workspacePath,
      });
      const registration = requireRegistration(harness, "codex");
      const provider = {
        ...registration.info,
        id: "reasoning-probe",
        capabilities: {
          ...registration.info.capabilities,
          modelCatalogScope: catalogScope,
        },
      };
      harness.deps.providerRegistry.register({
        ...registration,
        info: provider,
      });
      const models = [
        availableModelFixture({ model: "unknown", reasoningLevels: [] }),
        availableModelFixture({ model: "medium", reasoningLevels: ["medium"] }),
        availableModelFixture({
          model: "high",
          reasoningLevels: ["medium", "high"],
        }),
      ];
      const selectedOnlyModels = [
        availableModelFixture({ model: "selected-only", reasoningLevels: [] }),
      ];
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: { [provider.id]: { models, selectedOnlyModels } },
        restoreCommandCaptureAfterResponse: true,
      });
      const result =
        await harness.deps.lifecycleDedupers.providerModelCatalogs.read(
          harness.deps,
          {
            hostId: host.id,
            provider,
            cwd: environment.path,
            access: { kind: "picker" },
          },
        );
      expect(result.kind).toBe("catalog");
      if (hostType === "ephemeral") {
        expect(
          getStoredProviderModelCatalog(harness.db, {
            hostId: host.id,
            providerId: provider.id,
            scopeKey: catalogScope === "workspace" ? workspacePath : "",
          }),
        ).toBeNull();
      }
      const otherHost = seedHostSession(harness.deps).host;
      const otherWorkspace = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/other-reasoning-catalog",
      });
      const otherHostEnvironment = seedEnvironment(harness.deps, {
        hostId: otherHost.id,
        projectId: project.id,
        path: environment.path,
      });
      for (const [
        commandEnvironment,
        model,
        reasoningLevel,
        expected,
        reasoningSource,
      ] of [
        [environment, "unknown", undefined, undefined],
        [environment, "selected-only", undefined, undefined],
        [environment, "unknown", "high", "high"],
        [environment, "unknown", "high", "high", "explicit"],
        [environment, "unknown", "medium", undefined, "client-preference"],
        [environment, "unknown", "medium", "medium"],
        [environment, "selected-only", "high", "high"],
        [environment, "medium", "medium", "medium"],
        [environment, "high", "high", "high"],
        [environment, "uncatalogued", "high", "high"],
        [
          otherWorkspace,
          "unknown",
          undefined,
          catalogScope === "workspace" ? "medium" : undefined,
        ],
        [otherHostEnvironment, "unknown", undefined, "medium"],
        [otherHostEnvironment, "unknown", undefined, undefined, "explicit"],
      ] as const) {
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: commandEnvironment.id,
          providerId: provider.id,
        });
        const execution = await buildExecutionOptions(
          harness.deps,
          {
            model,
            ...(reasoningSource === undefined
              ? {}
              : {
                  executionInputSources: {
                    model: "explicit",
                    reasoningLevel: reasoningSource,
                  },
                }),
            ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
            permissionMode: "accept-edits",
          },
          { threadId: thread.id },
        );
        const start = await buildThreadStartCommand(harness.deps, {
          environment: commandEnvironment,
          execution,
          fork: null,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId: provider.id,
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          syncGeneratedTitle: false,
          thread,
        });
        const submit = await prepareTurnSubmitCommandPayload(harness.deps, {
          environment: commandEnvironment,
          execution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          providerThreadId: "provider-session",
          target: { mode: "start" },
          thread,
        });
        expect(start.options.reasoningLevel, model).toBe(expected);
        expect(submit.options.reasoningLevel, model).toBe(expected);
      }
      expect(responder.requests).toHaveLength(1);
    });
  },
);
