import { getThread, listEvents } from "@bb/db";
import { afterEach, expect, it, vi } from "vitest";
import { dispatchTurnDuringReprovision } from "../../src/services/threads/thread-turn-dispatch.js";
import { readThreadProvisionContext } from "../../src/services/threads/thread-startup-store.js";
import { buildExecutionOptions } from "../../src/services/threads/thread-commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

afterEach(() => vi.restoreAllMocks());

it("leaves reprovision unstarted when dispatch admission rejects the request", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      status: "error",
      path: "/tmp/rejected-reprovision",
      environmentProviderId: "personal-workspace",
      environmentProviderPluginId: "bb-plugin-environment-personal-workspace",
      isGitRepo: false,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "idle",
    });
    const execution = await buildExecutionOptions(
      harness.deps,
      {
        model: "gpt-5",
        reasoningLevel: "medium",
        serviceTier: "default",
        permissionMode: "full",
      },
      { threadId: thread.id },
    );
    const eventsBefore = listEvents(harness.db, { threadId: thread.id });
    const notifyThread = vi.spyOn(harness.deps.hub, "notifyThread");
    const rejected = new Error("Dispatch admission rejected");
    let admissionStatus: string | undefined;

    await expect(
      dispatchTurnDuringReprovision({
        deps: harness.deps,
        environment,
        execution,
        initiator: "user",
        input: textInput("must remain undelivered"),
        senderThreadId: null,
        thread,
        beforeRequestAppendInTransaction: ({ tx }) => {
          admissionStatus = getThread(tx, thread.id)?.status;
          throw rejected;
        },
      }),
    ).rejects.toBe(rejected);

    expect(admissionStatus).toBe("idle");
    expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    expect(readThreadProvisionContext(harness.db, thread.id)).toBeNull();
    expect(listEvents(harness.db, { threadId: thread.id })).toEqual(
      eventsBefore,
    );
    expect(notifyThread).not.toHaveBeenCalled();
  });
});
