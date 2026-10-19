import { upsertProjectExecutionDefaults } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";
import { resolvePendingThreadSessionOptions } from "../../src/services/threads/thread-session-options.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";

function daybreakModel(
  model: string,
  daybreak: { value: boolean; fixed: boolean },
  isDefault = false,
) {
  return {
    ...availableModelFixture({ model, isDefault }),
    sessionOptions: [
      {
        type: "boolean" as const,
        id: "daybreak",
        label: "Daybreak",
        ...daybreak,
      },
    ],
  };
}

function registerDaybreakCatalog(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string },
) {
  registerProviderHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    restoreCommandCaptureAfterResponse: true,
    modelsByProviderId: {
      codex: {
        models: [
          daybreakModel("gpt-standard", { value: false, fixed: true }, true),
          daybreakModel("gpt-both", { value: false, fixed: false }),
        ],
        selectedOnlyModels: [
          daybreakModel("gpt-daybreak-only", { value: true, fixed: true }),
        ],
      },
    },
  });
}

async function startedModel(harness: TestAppHarness, response: Response) {
  expect(response.status).toBe(201);
  const thread = threadSchema.parse(await readJson(response));
  const start = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === thread.id,
  );
  return start.command.type === "thread.start"
    ? start.command.options.model
    : null;
}

async function createThread(
  harness: TestAppHarness,
  args: {
    hostId: string;
    projectId: string;
    sessionOptions?: unknown;
    model?: string | null;
  },
) {
  return harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "app",
      projectId: args.projectId,
      providerId: "codex",
      ...(args.model === null ? {} : { model: args.model ?? "gpt-5" }),
      input: [{ type: "text", text: "Start with my options" }],
      ...(args.sessionOptions === undefined
        ? {}
        : { sessionOptions: args.sessionOptions }),
      environment: {
        type: "host",
        hostId: args.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "default" },
        },
      },
    }),
  });
}

function seedWorkspace(harness: TestAppHarness, name: string) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-${name}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/${name}-project`,
  });
  seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/${name}-workspace`,
    status: "ready",
  });
  installFakeGitWorktreeProvider(() => ({
    action: "ready",
    environment: {
      type: "host",
      hostId: host.id,
      path: `/tmp/${name}-workspace`,
    },
  }));
  return { host, session, project };
}

describe("session options chosen when a thread is created", () => {
  it("sends the choices with the thread's first command, before the provider has reported any option", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedWorkspace(harness, "create-options");

      const response = await createThread(harness, {
        hostId: host.id,
        projectId: project.id,
        sessionOptions: { daybreak: true, mode: "plan" },
      });
      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(
        start.command.type === "thread.start"
          ? start.command.options.sessionOptions
          : null,
      ).toEqual({ daybreak: true, mode: "plan" });
      expect(resolvePendingThreadSessionOptions(harness.db, thread.id)).toEqual(
        { daybreak: true, mode: "plan" },
      );
    });
  });

  it("sends nothing when no choice was made, and refuses a value that is neither text nor on/off", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedWorkspace(harness, "create-no-options");

      const plain = await createThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      expect(plain.status).toBe(201);
      const thread = threadSchema.parse(await readJson(plain));
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(
        start.command.type === "thread.start" ? start.command.options : null,
      ).not.toHaveProperty("sessionOptions");

      const invalid = await createThread(harness, {
        hostId: host.id,
        projectId: project.id,
        sessionOptions: { daybreak: 1 },
      });
      expect(invalid.status).toBe(400);
    });
  });

  it("starts on a model that fits the chosen options when the caller left the model to bb, keeping a remembered model that fits", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, project } = seedWorkspace(
        harness,
        "create-options-default-model",
      );
      registerDaybreakCatalog(harness, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(
        await startedModel(
          harness,
          await createThread(harness, {
            hostId: host.id,
            projectId: project.id,
            model: null,
            sessionOptions: { daybreak: true },
          }),
        ),
      ).toBe("gpt-both");
      expect(
        await startedModel(
          harness,
          await createThread(harness, {
            hostId: host.id,
            projectId: project.id,
            model: null,
            sessionOptions: { daybreak: false },
          }),
        ),
      ).toBe("gpt-both");

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-standard",
        serviceTier: "default",
        reasoningLevel: "low",
        permissionMode: "full",
      });
      expect(
        await startedModel(
          harness,
          await createThread(harness, {
            hostId: host.id,
            projectId: project.id,
            model: null,
            sessionOptions: { daybreak: true },
          }),
        ),
      ).toBe("gpt-both");
    });
  });

  it("refuses a model the caller named that cannot run with the chosen options, and names one that can", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, project } = seedWorkspace(
        harness,
        "create-options-explicit-model",
      );
      registerDaybreakCatalog(harness, {
        hostId: host.id,
        sessionId: session.id,
      });

      const refused = await createThread(harness, {
        hostId: host.id,
        projectId: project.id,
        model: "gpt-standard",
        sessionOptions: { daybreak: true },
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(await readJson(refused))).toContain(
        "gpt-standard cannot run with the chosen options: Turn off Daybreak to use this model. gpt-both can.",
      );

      expect(
        await startedModel(
          harness,
          await createThread(harness, {
            hostId: host.id,
            projectId: project.id,
            model: "gpt-daybreak-only",
            sessionOptions: { daybreak: true },
          }),
        ),
      ).toBe("gpt-daybreak-only");
      expect(
        await startedModel(
          harness,
          await createThread(harness, {
            hostId: host.id,
            projectId: project.id,
            model: "gpt-unlisted",
            sessionOptions: { daybreak: true },
          }),
        ),
      ).toBe("gpt-unlisted");
    });
  });
});
