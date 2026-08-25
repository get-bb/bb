import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const PLUGIN_ID = "provider-action-test";
const PROVIDER_ID = "action-test";
const KIND = `${PLUGIN_ID}/terminal` as const;

function registerProvider(
  harness: Parameters<typeof registerHostRpcResponder>[0],
) {
  harness.deps.providerRegistry.register({
    ...buildPluginProviderRegistration({
      available: true,
      pluginId: PLUGIN_ID,
      declaration: validatePluginProviderDeclaration({
        id: PROVIDER_ID,
        displayName: "Action test",
        maintenance: { health: false, usage: false, installation: false },
        capabilities: {
          supportsServiceTier: false,
          supportsNativeUserQuestion: false,
          fork: "none",
          supportsManualCompaction: false,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ["full"],
          reasoningLevels: ["medium"],
        },
        composerActions: [],
        extensionKinds: {
          terminal: {
            state: z.unknown(),
            experimental_action: z.object({ type: z.literal("cancel") }),
          },
        },
      }),
      readSettings: () => ({}),
    }),
    pluginId: PLUGIN_ID,
    iconNames: new Set<string>(),
  });
}

describe("provider extension-state actions", () => {
  it("validates and forwards an action to the current host runtime", async () => {
    await withTestHarness(async (harness) => {
      registerProvider(harness);
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: PROVIDER_ID,
        status: "active",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          expect(command).toEqual({
            type: "thread.extension-state.action",
            environmentId: environment.id,
            threadId: thread.id,
            extensionKind: KIND,
            action: { type: "cancel" },
          });
          return { ok: true, result: { applied: true } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/extension-state/action`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: KIND, action: { type: "cancel" } }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ applied: true });
      expect(responder.requests).toHaveLength(1);
    });
  });

  it("rejects an undeclared action before host dispatch", async () => {
    await withTestHarness(async (harness) => {
      registerProvider(harness);
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: PROVIDER_ID,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/extension-state/action`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: KIND, action: { type: "input" } }),
        },
      );

      expect(response.status).toBe(400);
    });
  });
});
