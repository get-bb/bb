import {
  getProjectExecutionDefaults,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("project execution defaults persistence", () => {
  it("does not overwrite project defaults when an app thread reuses an existing environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reuse-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reuse-defaults-environment",
      });

      // Seed a known default — anything that mutates this table during
      // submission would be visible by comparing to this baseline.
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });

      await createThreadFromRequest(harness.deps, {
        origin: "app",
        childOrigin: null,
        startedOnBehalfOf: null,
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
        input: textInput("Reuse one-off"),
        environment: { type: "reuse", environmentId: environment.id },
      });

      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
        }),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });
    });
  });

  it("does overwrite project defaults for a regular app thread (non-reuse env)", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-non-reuse-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });

      await createThreadFromRequest(harness.deps, {
        origin: "app",
        childOrigin: null,
        startedOnBehalfOf: null,
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
        input: textInput("Set new defaults"),
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: null },
        },
      });

      // Sanity: host-mode submissions still update project defaults — proves
      // the reuse-only carve-out above isn't accidentally turning the whole
      // persistence path off.
      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
        }),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });
    });
  });

  it("does not overwrite project defaults for a fork/side-chat child spawn", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-child-origin-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const parentEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/child-origin-defaults-source",
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: parentEnvironment.id,
      });
      seedTurnStarted(harness.deps, {
        threadId: parentThread.id,
        turnId: "turn-child-origin-defaults-source",
        providerThreadId: "provider-child-origin-defaults-source",
      });

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });

      // A side chat forces permissionMode "readonly" and inherits a model the
      // user never picked in the composer; creating it must not reshape the
      // project's stored defaults (like the reuse carve-out above).
      await createThreadFromRequest(harness.deps, {
        origin: "app",
        childOrigin: "side-chat",
        startedOnBehalfOf: null,
        parentThreadId: parentThread.id,
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "readonly",
        serviceTier: "fast",
        input: textInput("Quick question"),
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: null },
        },
      });

      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
        }),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });
    });
  });
});
