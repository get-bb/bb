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

async function createThread(
  harness: TestAppHarness,
  args: { hostId: string; projectId: string; sessionOptions?: unknown },
) {
  return harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "app",
      projectId: args.projectId,
      providerId: "codex",
      model: "gpt-5",
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
  const { host } = seedHostSession(harness.deps, { id: `host-${name}` });
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
  return { host, project };
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
});
