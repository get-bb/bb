import { threadScope } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { resolveSystemExecutionOptions } from "../../src/services/system/execution-options.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  healthAnswer,
  installCatalogStore,
  modelList,
  requireRegistration,
} from "../helpers/provider-model-catalogs.js";
import { seedThreadFixture, seedThreadIdentity } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("session model catalogs", () => {
  it.each([
    { providerThreadId: "current-session", expectedModel: "live-model" },
    { providerThreadId: "retired-session", expectedModel: "cached-model" },
  ])(
    "accepts catalog updates only from the current session: $providerThreadId",
    async (scenario) => {
      await withTestHarness(async (harness) => {
        const { host, session, environment, thread } = seedThreadFixture(
          harness,
          {
            thread: { providerId: "codex" },
          },
        );
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            if (request.command.type === "provider.health") {
              return healthAnswer("not_installed");
            }
            throw new Error(`Unexpected RPC ${request.command.type}`);
          },
        });
        seedThreadIdentity(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "current-session",
        });
        const store = installCatalogStore(harness, {
          clock: { now: Date.now() },
        });
        await store.remember(harness.deps, {
          hostId: host.id,
          provider: requireRegistration(harness, "codex").info,
          cwd: environment.path,
          models: modelList("cached-model"),
          selectedOnlyModels: [],
        });
        const response = await harness.app.request("/internal/session/events", {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents([
              {
                threadId: thread.id,
                event: {
                  type: "thread/extensionState/updated",
                  threadId: thread.id,
                  providerThreadId: scenario.providerThreadId,
                  scope: threadScope(),
                  kind: "bb/provider-model-catalog",
                  payload: {
                    models: modelList("live-model"),
                    selectedOnlyModels: [],
                  },
                },
              },
            ]),
          }),
        });
        expect(response.status).toBe(200);
        const picker = await resolveSystemExecutionOptions(harness.deps, {
          environmentId: environment.id,
          providerId: "codex",
        });
        expect(picker.models.map((model) => model.model)).toEqual([
          scenario.expectedModel,
        ]);
        expect(
          responder.requests.filter(
            (request) => request.command.type === "provider.list_models",
          ),
        ).toHaveLength(0);
      });
    },
  );
});
