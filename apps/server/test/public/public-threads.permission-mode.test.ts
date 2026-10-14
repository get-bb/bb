import { describe, expect, it } from "vitest";
import {
  getThreadExecutionOverride,
  listEvents,
  setThreadExecutionOverride,
  updateHost,
} from "@bb/db";
import type { PermissionMode } from "@bb/domain";
import {
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import { recoverThreadModelOverride } from "../../src/services/threads/thread-execution-override.js";
import { resolveExistingThreadPermissionMode } from "../../src/services/threads/thread-execution-plan.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

interface SeedPermissionThreadArgs {
  hostId: string;
  maxPermissionMode?: PermissionMode;
  priorPermissionMode?: PermissionMode;
  providerId?: string;
}

function seedPermissionThread(
  harness: TestAppHarness,
  args: SeedPermissionThreadArgs,
) {
  const providerId = args.providerId ?? "claude-code";
  const { host } = seedHostSession(harness.deps, { id: args.hostId });
  if (args.maxPermissionMode !== undefined) {
    updateHost(harness.db, harness.hub, host.id, {
      maxPermissionMode: args.maxPermissionMode,
    });
  }
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
  });
  if (args.priorPermissionMode !== undefined) {
    seedThreadRuntimeState(harness.deps, {
      environmentId: environment.id,
      model: "claude-sonnet-4-6",
      permissionMode: args.priorPermissionMode,
      providerThreadId: `provider-${thread.id}`,
      threadId: thread.id,
    });
  }
  return { environment, thread };
}

function patchThread(harness: TestAppHarness, threadId: string, body: unknown) {
  return harness.app.request(`/api/v1/threads/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listPermissionModeChanges(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter(
      (event) =>
        event.type === "system/operation" &&
        JSON.parse(event.data).operation === "permission_mode_change",
    )
    .map((event) => JSON.parse(event.data));
}

describe("PATCH /threads/:id permissionMode", () => {
  it("stores a sticky permission mode override and logs the change once", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-store",
        priorPermissionMode: "accept-edits",
      });

      const response = await patchThread(harness, thread.id, {
        permissionMode: "full",
      });

      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBe("full");
      const changes = listPermissionModeChanges(harness, thread.id);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        status: "completed",
        metadata: {
          previousPermissionMode: "accept-edits",
          permissionMode: "full",
        },
      });

      const repeat = await patchThread(harness, thread.id, {
        permissionMode: "full",
      });
      expect(repeat.status).toBe(200);
      expect(listPermissionModeChanges(harness, thread.id)).toHaveLength(1);
    });
  });

  it("accepts the legacy workspace-write alias as accept-edits", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-alias",
      });

      const response = await patchThread(harness, thread.id, {
        permissionMode: "workspace-write",
      });

      expect(response.status).toBe(200);
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBe("accept-edits");
    });
  });

  it("rejects an unknown permission mode without touching the thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-invalid",
      });

      const response = await patchThread(harness, thread.id, {
        permissionMode: "yolo",
      });

      expect(response.status).toBe(400);
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBeNull();
      expect(listPermissionModeChanges(harness, thread.id)).toHaveLength(0);
    });
  });

  it("rejects a mode the provider does not support", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-provider",
        providerId: "pi",
      });

      const response = await patchThread(harness, thread.id, {
        permissionMode: "auto",
      });

      expect(response.status).toBe(400);
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBeNull();
    });
  });

  it("rejects a mode above the machine's permission ceiling", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-ceiling",
        maxPermissionMode: "auto",
      });

      const response = await patchThread(harness, thread.id, {
        permissionMode: "full",
      });

      expect(response.status).toBe(400);
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBeNull();
      expect(listPermissionModeChanges(harness, thread.id)).toHaveLength(0);

      const allowed = await patchThread(harness, thread.id, {
        permissionMode: "auto",
      });
      expect(allowed.status).toBe(200);
    });
  });

  it("rejects the whole update before saving a model when the permission mode is not allowed", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-atomic",
        maxPermissionMode: "auto",
      });

      const response = await patchThread(harness, thread.id, {
        model: "claude-opus-4-8",
        permissionMode: "full",
      });

      expect(response.status).toBe(400);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
        permissionModeOverride: null,
      });
    });
  });

  it("clamps a stored override when the machine ceiling is lowered later", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-lowered",
        priorPermissionMode: "auto",
      });
      const response = await patchThread(harness, thread.id, {
        permissionMode: "full",
      });
      expect(response.status).toBe(200);

      updateHost(harness.db, harness.hub, "host-permission-mode-lowered", {
        maxPermissionMode: "accept-edits",
      });

      expect(resolveExistingThreadPermissionMode(harness.deps, thread.id)).toBe(
        "accept-edits",
      );
      const execution = await buildExecutionOptions(
        harness.deps,
        {},
        { threadId: thread.id },
      );
      expect(execution.permissionMode).toBe("accept-edits");
    });
  });
});

describe("thread permission mode override on the next turn", () => {
  it("applies to the next claude-code turn.submit and still yields to an explicit request", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-turn",
        priorPermissionMode: "accept-edits",
      });

      const before = await buildExecutionOptions(
        harness.deps,
        {},
        { threadId: thread.id },
      );
      expect(before.permissionMode).toBe("accept-edits");

      const response = await patchThread(harness, thread.id, {
        permissionMode: "full",
      });
      expect(response.status).toBe(200);

      const after = await buildExecutionOptions(
        harness.deps,
        {},
        { threadId: thread.id },
      );
      expect(after.permissionMode).toBe("full");
      expect(resolveExistingThreadPermissionMode(harness.deps, thread.id)).toBe(
        "full",
      );

      const command = await prepareTurnSubmitCommandPayload(harness.deps, {
        environment,
        execution: after,
        permissionEscalation: "ask",
        input: textInput("continue"),
        target: { mode: "start" },
        thread,
      });
      expect(command.options).toMatchObject({
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
      });

      const oneOff = await buildExecutionOptions(
        harness.deps,
        { permissionMode: "auto" },
        { threadId: thread.id },
      );
      expect(oneOff.permissionMode).toBe("auto");
    });
  });

  it("follows an explicit per-turn choice instead of snapping back to a stale override", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-recover",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        permissionModeOverride: "full",
      });

      await recoverThreadModelOverride(harness.deps, {
        model: undefined,
        modelSource: undefined,
        permissionMode: "auto",
        permissionModeSource: "client-preference",
        reasoningLevel: undefined,
        reasoningLevelSource: undefined,
        thread,
      });
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBe("full");

      await recoverThreadModelOverride(harness.deps, {
        model: undefined,
        modelSource: undefined,
        permissionMode: "auto",
        permissionModeSource: "explicit",
        reasoningLevel: undefined,
        reasoningLevelSource: undefined,
        thread,
      });
      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBe("auto");
    });
  });

  it("does not store an explicit per-turn mode the provider cannot run", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedPermissionThread(harness, {
        hostId: "host-permission-mode-recover-invalid",
        providerId: "pi",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        permissionModeOverride: "full",
      });

      await recoverThreadModelOverride(harness.deps, {
        model: undefined,
        modelSource: undefined,
        permissionMode: "auto",
        permissionModeSource: "explicit",
        reasoningLevel: undefined,
        reasoningLevelSource: undefined,
        thread,
      });

      expect(
        getThreadExecutionOverride(harness.db, thread.id)
          ?.permissionModeOverride,
      ).toBe("full");
    });
  });
});
