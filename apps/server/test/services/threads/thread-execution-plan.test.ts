import { upsertProjectExecutionDefaults } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  buildExistingThreadExecutionInput,
  resolveExistingThreadExecutionPlan,
  resolveExistingThreadPermissionMode,
} from "../../../src/services/threads/thread-execution-plan.js";
import { resolveProjectExecutionDefaultsForCreate } from "../../../src/services/threads/project-execution-defaults.js";
import { getLastExecutionOptions } from "../../../src/services/threads/thread-events.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("thread execution plan input sources", () => {
  it("treats supplied execution fields as explicit when legacy callers omit sources", () => {
    expect(
      buildExistingThreadExecutionInput({
        model: "gpt-5",
        permissionMode: "accept-edits",
        reasoningLevel: "high",
        serviceTier: "fast",
      }),
    ).toEqual({
      model: { source: "explicit", value: "gpt-5" },
      permissionMode: { source: "explicit", value: "accept-edits" },
      reasoningLevel: { source: "explicit", value: "high" },
      serviceTier: { source: "explicit", value: "fast" },
    });
  });

  it("ignores displayed-only values when new callers provide empty source metadata", () => {
    expect(
      buildExistingThreadExecutionInput({
        model: "gpt-5",
        permissionMode: "accept-edits",
        reasoningLevel: "high",
        serviceTier: "fast",
        executionInputSources: {},
      }),
    ).toEqual({});
  });

  it("keeps caller-owned source metadata on supplied execution fields", () => {
    expect(
      buildExistingThreadExecutionInput({
        model: "gpt-5",
        permissionMode: "accept-edits",
        reasoningLevel: "high",
        serviceTier: "fast",
        executionInputSources: {
          model: "client-preference",
          permissionMode: "explicit",
          reasoningLevel: "client-preference",
          serviceTier: "explicit",
        },
      }),
    ).toEqual({
      model: { source: "client-preference", value: "gpt-5" },
      permissionMode: { source: "explicit", value: "accept-edits" },
      reasoningLevel: { source: "client-preference", value: "high" },
      serviceTier: { source: "explicit", value: "fast" },
    });
  });

  it("uses source metadata before resolving create provider defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-source-aware-create-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      upsertProjectExecutionDefaults(harness.deps.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const ignoredDisplayedValue = resolveProjectExecutionDefaultsForCreate(
        harness.deps,
        {
          executionInputSources: {},
          model: "openai-codex/gpt-5.4",
          projectId: project.id,
          providerId: "pi",
        },
      );
      const legacyExplicitValue = resolveProjectExecutionDefaultsForCreate(
        harness.deps,
        {
          model: "openai-codex/gpt-5.4",
          projectId: project.id,
          providerId: "pi",
        },
      );

      expect(ignoredDisplayedValue.providerId).toBe("codex");
      expect(ignoredDisplayedValue.executionDefaults?.model).toBe("gpt-5");
      expect(legacyExplicitValue.providerId).toBe("pi");
      expect(legacyExplicitValue.executionDefaults).toBeNull();
    });
  });

  it("uses server product defaults when create metadata has no caller-owned provider or model", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-source-aware-standard-product-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const resolution = resolveProjectExecutionDefaultsForCreate(
        harness.deps,
        {
          executionInputSources: {},
          model: "openai-codex/gpt-5.4",
          projectId: project.id,
          providerId: "pi",
        },
      );

      expect(resolution.providerId).toBe("codex");
      expect(resolution.executionDefaults).toEqual({
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "default",
      });
    });
  });
});

describe("legacy readonly side-chat permission resolution", () => {
  it.each(["full", "auto"] as const)(
    "inherits a source without execution history from its matching %s project default",
    async (permissionMode) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-legacy-side-chat-${permissionMode}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        upsertProjectExecutionDefaults(harness.deps.db, {
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode,
          serviceTier: "default",
        });
        const sourceThread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId: "codex",
        });
        const sideChat = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          originKind: "side-chat",
          providerId: "codex",
          sourceThreadId: sourceThread.id,
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          permissionMode: "readonly",
          providerThreadId: `provider-legacy-side-chat-${permissionMode}`,
          threadId: sideChat.id,
        });

        expect(
          resolveExistingThreadPermissionMode(harness.deps, sideChat.id),
        ).toBe(permissionMode);
        const plan = await resolveExistingThreadExecutionPlan(harness.deps, {
          executionSource: "client/turn/requested",
          input: {},
          threadId: sideChat.id,
        });
        expect(plan.resolvedExecution.permissionMode).toBe(permissionMode);
        expect(
          getLastExecutionOptions(harness.deps, sideChat.id)?.permissionMode,
        ).toBe("readonly");
      });
    },
  );

  it("uses the source provider fallback when project defaults target another provider", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-legacy-side-chat-provider-fallback",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      upsertProjectExecutionDefaults(harness.deps.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "default",
      });
      const sourceThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "pi",
      });
      const sideChat = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        originKind: "side-chat",
        providerId: "pi",
        sourceThreadId: sourceThread.id,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        permissionMode: "readonly",
        providerThreadId: "provider-legacy-side-chat-provider-fallback",
        threadId: sideChat.id,
      });

      expect(
        resolveExistingThreadPermissionMode(harness.deps, sideChat.id),
      ).toBe("full");
      const plan = await resolveExistingThreadExecutionPlan(harness.deps, {
        executionSource: "client/turn/requested",
        input: {},
        threadId: sideChat.id,
      });
      expect(plan.resolvedExecution.permissionMode).toBe("full");
    });
  });
});
