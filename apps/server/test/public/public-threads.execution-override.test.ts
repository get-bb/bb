import { describe, expect, it } from "vitest";
import { getThreadExecutionOverride } from "@bb/db";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

async function stubClaudeCodeCatalog(
  harness: TestAppHarness,
  hostId: string,
): Promise<void> {
  const providersCommand = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "provider.list",
  );
  await reportQueuedCommandSuccess(
    harness,
    providersCommand,
    {
      providers: [
        {
          id: "claude-code",
          displayName: "Claude Code",
          capabilities: {
            supportsArchive: true,
            supportsRename: false,
            supportsServiceTier: true,
            supportsUserQuestion: true,
            supportedPermissionModes: ["full", "workspace-write", "readonly"],
          },
          available: true,
        },
      ],
    },
    { hostId },
  );
  const modelsCommand = await waitForQueuedCommandAfter(
    harness,
    providersCommand.row.cursor,
    ({ command }) =>
      command.type === "provider.list_models" &&
      command.providerId === "claude-code",
  );
  await reportQueuedCommandSuccess(
    harness,
    modelsCommand,
    {
      models: [
        {
          id: "claude-opus-4-8",
          model: "claude-opus-4-8",
          displayName: "Opus 4.8",
          description: "",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "medium", description: "" },
            { reasoningEffort: "high", description: "" },
            { reasoningEffort: "xhigh", description: "" },
            { reasoningEffort: "max", description: "" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    },
    { hostId },
  );
}

function seedClaudeCodeThread(harness: TestAppHarness, providerId = "claude-code") {
  const { host } = seedHostSession(harness.deps, {
    id: `host-override-${providerId}`,
  });
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
  return { host, thread };
}

function patchThread(harness: TestAppHarness, threadId: string, body: unknown) {
  return harness.app.request(`/api/v1/threads/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /threads/:id execution override", () => {
  it("persists a model + reasoning override after catalog validation", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, thread } = seedClaudeCodeThread(harness);

      const responsePromise = patchThread(harness, thread.id, {
        model: "claude-opus-4-8",
        reasoningLevel: "high",
      });
      await stubClaudeCodeCatalog(harness, host.id);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-opus-4-8",
        reasoningLevelOverride: "high",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects a model that is not in the provider's catalog", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, thread } = seedClaudeCodeThread(harness);

      const responsePromise = patchThread(harness, thread.id, {
        model: "gpt-5",
      });
      await stubClaudeCodeCatalog(harness, host.id);
      const response = await responsePromise;

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(JSON.stringify(body)).toContain("not available for provider claude-code");
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects an in-place override for a non-claude-code thread", async () => {
    const harness = await createTestAppHarness();
    try {
      const { thread } = seedClaudeCodeThread(harness, "codex");

      // The provider gate rejects before any catalog command is queued.
      const response = await patchThread(harness, thread.id, {
        model: "gpt-5",
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(JSON.stringify(body)).toContain("only supported for claude-code");
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    } finally {
      await harness.cleanup();
    }
  });
});
