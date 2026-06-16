import { describe, expect, it } from "vitest";
import { getThreadExecutionOverride } from "@bb/db";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

function stubClaudeCodeCatalog(
  harness: TestAppHarness,
  hostId: string,
  sessionId: string,
): void {
  registerProviderHostRpcResponder(harness, {
    hostId,
    sessionId,
    modelsByProviderId: {
      "claude-code": {
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
    },
  });
}

function seedClaudeCodeThread(
  harness: TestAppHarness,
  providerId = "claude-code",
) {
  const { host, session } = seedHostSession(harness.deps, {
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
  return { host, session, thread };
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
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedClaudeCodeThread(harness);
      stubClaudeCodeCatalog(harness, host.id, session.id);

      const response = await patchThread(harness, thread.id, {
        model: "claude-opus-4-8",
        reasoningLevel: "high",
      });

      expect(response.status).toBe(200);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-opus-4-8",
        reasoningLevelOverride: "high",
      });
    });
  });

  it("rejects a model that is not in the provider's catalog", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedClaudeCodeThread(harness);
      stubClaudeCodeCatalog(harness, host.id, session.id);

      const response = await patchThread(harness, thread.id, {
        model: "gpt-5",
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(JSON.stringify(body)).toContain(
        "not available for provider claude-code",
      );
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    });
  });

  it("rejects an in-place override for a non-claude-code thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedClaudeCodeThread(harness, "codex");

      // The provider gate rejects before catalog lookup.
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
    });
  });
});
