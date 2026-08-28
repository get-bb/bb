// A held thread's provider can still change, and the rule that decides when.
//
// The invariant is NOT "provider is locked when the row is inserted" — it is
// **provider is immutable once a provider session exists**. A thread whose
// first turn is parked in a hold has a row and no session, so releasing that
// hold may repoint it. Everything here is about where that line falls, and
// about the property the router depends on: a refused amendment is refused
// BEFORE the hold is settled, so the user's message is never stranded by a
// plugin asking for something it may not have.

import { getThread, listDispatchHolds, listEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { createThreadDispatchHold } from "../../src/services/threads/dispatch-holds.js";
import { releaseDispatchHoldForOwnerPlugin } from "../../src/services/threads/dispatch-hold-owner.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/dispatch-hold-provider-amendment";
const PLUGIN_ID = "model-router";

interface FixtureOptions {
  hostId: string;
  /** Non-null makes the held creation a fork, as a real fork's hold is. */
  fork?: { sourceProviderThreadId: string } | null;
  /** Seeds a provider session, which is what "has already started" means. */
  started?: boolean;
  originKind?: "fork" | null;
  providerId?: string;
  /** Omit the cold-start context, as a plain turn.submit hold does. */
  coldStart?: boolean;
}

function seedHeldFixture(harness: TestAppHarness, options: FixtureOptions) {
  const { host, session } = seedHostSession(harness.deps, { id: options.hostId });
  // The provider amendment validates the model against the NEW provider's
  // catalog, and a catalog comes from the host. Without a responder the probe
  // would simply never answer.
  registerProviderHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    modelsByProviderId: {
      codex: {
        models: [
          availableModelFixture({ model: "gpt-5-mini" }),
          availableModelFixture({ model: "gpt-5", reasoningLevels: ["low", "high"] }),
        ],
        selectedOnlyModels: [],
      },
      "claude-code": {
        models: [
          availableModelFixture({ model: "opus", reasoningLevels: ["medium"] }),
        ],
        selectedOnlyModels: [],
      },
    },
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: options.providerId ?? "codex",
    status: "idle",
    ...(options.originKind !== undefined
      ? { originKind: options.originKind }
      : {}),
  });
  if (options.started === true) {
    seedThreadRuntimeState(harness.deps, {
      environmentId: environment.id,
      providerThreadId: `provider-${options.hostId}`,
      threadId: thread.id,
    });
  }
  const hold = createThreadDispatchHold(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    holder: `plugin:${PLUGIN_ID}`,
    payload: {
      kind: "inline",
      input: textInput("route me"),
      execution: {
        model: "gpt-5-mini",
        serviceTier: "default",
        reasoningLevel: "low",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      pluginInputs: {},
    },
    reason: "Choosing a model…",
    resumeAt: null,
    userReleasable: true,
    ...(options.coldStart === false
      ? {}
      : {
          threadStartContext: {
            environmentIntent: { type: "reuse", environmentId: environment.id },
            fork:
              options.fork === undefined || options.fork === null
                ? null
                : {
                    sourceProviderThreadId: options.fork.sourceProviderThreadId,
                  },
            startedOnBehalfOf: null,
            titleProvided: false,
          },
        }),
  });
  return { environment, hold, project, thread };
}

function liveHolds(harness: TestAppHarness, threadId: string) {
  return listDispatchHolds(harness.db, { threadId, liveOnly: true });
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

async function expectApiError(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describe("releasing a hold onto a different provider", () => {
  it("repoints a never-started thread and starts it there", async () => {
    await withTestHarness(async (harness) => {
      const { hold, thread } = seedHeldFixture(harness, {
        hostId: "host-amend-ok",
        providerId: "codex",
      });

      await releaseDispatchHoldForOwnerPlugin(harness.deps, {
        pluginId: PLUGIN_ID,
        holdId: hold.id,
        amend: { providerId: "claude-code", model: "opus" },
      });

      // The row is the only place a provider can live, and the dispatch that
      // follows reads it from there.
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      expect(liveHolds(harness, thread.id)).toEqual([]);
      expect(turnRequests(harness, thread.id).length).toBeGreaterThan(0);
    });
  });

  it("clears the sticky overrides, which belonged to the old provider", async () => {
    // They were validated against the previous catalog and its ladder, so
    // keeping them would pin the thread to a model the new provider does not
    // have — a failure on the NEXT turn rather than this one.
    await withTestHarness(async (harness) => {
      const { hold, thread } = seedHeldFixture(harness, {
        hostId: "host-amend-overrides",
      });

      await releaseDispatchHoldForOwnerPlugin(harness.deps, {
        pluginId: PLUGIN_ID,
        holdId: hold.id,
        amend: { providerId: "claude-code", model: "opus" },
      });

      const row = getThread(harness.db, thread.id);
      expect(row?.modelOverride).toBeNull();
      expect(row?.reasoningLevelOverride).toBeNull();
    });
  });

  it("refuses once the thread has a provider session, and keeps the hold", async () => {
    // The hold surviving is the property the router depends on: it can ask
    // optimistically and still release the message when told no.
    await withTestHarness(async (harness) => {
      const { hold, thread } = seedHeldFixture(harness, {
        hostId: "host-amend-started",
        started: true,
      });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "claude-code", model: "opus" },
        }),
      );

      expect(error.body.code).toBe("provider_not_amendable");
      expect(error.body.message).toContain("already started");
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      expect(liveHolds(harness, thread.id)).toHaveLength(1);
    });
  });

  it("refuses a fork, whose first turn clones the source session", async () => {
    await withTestHarness(async (harness) => {
      const { hold, thread } = seedHeldFixture(harness, {
        hostId: "host-amend-fork",
        fork: { sourceProviderThreadId: "provider-source" },
      });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "claude-code", model: "opus" },
        }),
      );

      expect(error.body.code).toBe("provider_not_amendable");
      expect(error.body.message).toContain("fork");
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      expect(liveHolds(harness, thread.id)).toHaveLength(1);
    });
  });

  it("refuses a fork recorded only on the thread row", async () => {
    // Two markers, because they can disagree: the start context is what
    // release hands to provisioning, and `originKind` is the durable fact.
    await withTestHarness(async (harness) => {
      const { hold } = seedHeldFixture(harness, {
        hostId: "host-amend-fork-row",
        originKind: "fork",
      });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "claude-code", model: "opus" },
        }),
      );

      expect(error.body.message).toContain("fork");
    });
  });

  it("refuses a hold that is not starting a thread", async () => {
    // A hold with no cold-start context sends into a thread that is already
    // established; releasing it never establishes a session, so a provider
    // amendment there would change a row nothing reads again.
    await withTestHarness(async (harness) => {
      const { hold } = seedHeldFixture(harness, {
        hostId: "host-amend-not-start",
        coldStart: false,
      });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "claude-code", model: "opus" },
        }),
      );

      expect(error.body.code).toBe("provider_not_amendable");
      expect(error.body.message).toContain("already established");
    });
  });

  it("refuses a provider change that names no model", async () => {
    // The held tuple's model belongs to the provider being left, and a
    // resolved tuple cannot say "re-resolve this".
    await withTestHarness(async (harness) => {
      const { hold, thread } = seedHeldFixture(harness, {
        hostId: "host-amend-no-model",
      });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "claude-code" },
        }),
      );

      expect(error.status).toBe(400);
      expect(error.body.message).toContain("also needs a model");
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      expect(liveHolds(harness, thread.id)).toHaveLength(1);
    });
  });

  it("refuses a provider nothing serves", async () => {
    await withTestHarness(async (harness) => {
      const { hold } = seedHeldFixture(harness, { hostId: "host-amend-bogus" });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "not-a-provider", model: "opus" },
        }),
      );

      expect(error.body.message).toContain("not-a-provider");
      expect(liveHolds(harness, hold.threadId)).toHaveLength(1);
    });
  });

  it("refuses a model the NEW provider does not offer", async () => {
    // Validating against the provider being adopted rather than the one being
    // left is the whole point: `gpt-5-mini` is a perfectly good model, just
    // not one claude-code has.
    await withTestHarness(async (harness) => {
      const { hold } = seedHeldFixture(harness, { hostId: "host-amend-model" });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: PLUGIN_ID,
          holdId: hold.id,
          amend: { providerId: "claude-code", model: "gpt-5-mini" },
        }),
      );

      expect(error.status).toBe(400);
      expect(error.body.message).toContain("gpt-5-mini");
      expect(error.body.message).toContain("claude-code");
      expect(liveHolds(harness, hold.threadId)).toHaveLength(1);
    });
  });

  it("refuses another plugin's hold before it looks at the amendment", async () => {
    await withTestHarness(async (harness) => {
      const { hold } = seedHeldFixture(harness, { hostId: "host-amend-owner" });

      const error = await expectApiError(() =>
        releaseDispatchHoldForOwnerPlugin(harness.deps, {
          pluginId: "someone-else",
          holdId: hold.id,
          amend: { providerId: "claude-code", model: "opus" },
        }),
      );

      expect(error.status).toBe(403);
      expect(liveHolds(harness, hold.threadId)).toHaveLength(1);
    });
  });
});
