import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { COMMAND_TIMEOUT_MS } from "../../../src/constants.js";
import { ApiError } from "../../../src/errors.js";
import {
  PROVIDER_LISTING_BUDGET_FLOOR_MS,
  PROVIDER_NATIVE_ROOTS_RESOLVE_TIMEOUT_MS,
  createProviderListingBudget,
  listNativeRootSkills,
  listProviderNativeCommands,
} from "../../../src/services/providers/native-roots.js";
import type { ProviderRegistration } from "../../../src/services/providers/provider-registry.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
import { stubHostArtifact } from "../../helpers/provider-registry.js";
import { seedHostSession } from "../../helpers/seed.js";
import {
  testLogger,
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const PLUGIN_ID = "provider-resolving";

function declaration(
  id: string,
  overrides: Partial<PluginProviderDeclaration> = {},
): PluginProviderDeclaration {
  return {
    id,
    displayName: id,
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
    ...overrides,
  };
}

const RESOLVING = {
  pluginId: PLUGIN_ID,
  declaration: declaration("resolving", {
    experimental_nativeSkillRoots: { project: [".resolving/skills"] },
    experimental_resolvesNativeRoots: true,
  }),
};

const DECLARED = {
  pluginId: "provider-declared",
  declaration: declaration("declared", {
    experimental_nativeSkillRoots: { user: [".declared/skills"] },
  }),
};

function registerListingHost(harness: TestAppHarness, hostId: string) {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  return registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: (request) => {
      if (request.command.type === "host.list_commands") {
        return { ok: true, result: { commands: [] } };
      }
      if (request.command.type === "host.list_skills") {
        return {
          ok: true,
          result: {
            workspaceSkills: [],
            sharedSkills: [],
            providers: request.command.providers.map((provider) => ({
              providerId: provider.providerId,
              skills: [],
            })),
          },
        };
      }
      throw new Error(`Unexpected RPC ${request.command.type}`);
    },
  });
}

function registration(
  harness: TestAppHarness,
  id: string,
): ProviderRegistration {
  const found = harness.deps.providerRegistry.get(id);
  if (found === null) throw new Error(`provider ${id} not registered`);
  return found;
}

const RESOLVING_SCAN = {
  providerId: "resolving",
  declaredRoots: {
    skills: {
      user: [],
      project: [
        {
          path: ".resolving/skills",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
      ],
    },
    commands: { user: [], project: [] },
  },
};

describe("native-root listings", () => {
  it("sends the resolver with the scan in one host call, leaving time for the scan after it", async () => {
    await withTestHarness({ extraProviders: [RESOLVING] }, async (harness) => {
      const artifact = stubHostArtifact(PLUGIN_ID);
      harness.deps.pluginHostArtifacts.set(PLUGIN_ID, artifact);
      const responder = registerListingHost(harness, "host-a");

      await listProviderNativeCommands(harness.deps, {
        registration: registration(harness, "resolving"),
        hostId: "host-a",
        cwd: "/work/one",
      });

      expect(responder.requests).toHaveLength(1);
      const command = responder.requests[0]?.command;
      if (command?.type !== "host.list_commands") {
        throw new Error("expected one host.list_commands");
      }
      expect(command).toEqual({
        type: "host.list_commands",
        cwd: "/work/one",
        provider: {
          ...RESOLVING_SCAN,
          resolver: {
            pluginId: PLUGIN_ID,
            generation: artifact.generation,
            artifact: {
              digest: artifact.digest,
              byteLength: artifact.byteLength,
            },
          },
        },
        resolution: { contributedEnv: [], timeoutMs: expect.any(Number) },
      });
      expect(command.resolution.timeoutMs).toBe(
        PROVIDER_NATIVE_ROOTS_RESOLVE_TIMEOUT_MS,
      );
    });
  });

  it("scans every provider and the shared roots in one host call", async () => {
    await withTestHarness(
      { extraProviders: [RESOLVING, DECLARED] },
      async (harness) => {
        harness.deps.pluginHostArtifacts.set(
          PLUGIN_ID,
          stubHostArtifact(PLUGIN_ID),
        );
        const responder = registerListingHost(harness, "host-a");
        const sharedRoots = {
          user: [
            {
              path: ".agents/skills",
              recursive: false,
              ancestors: false,
              namePrefix: "",
            },
          ],
          project: [],
        };

        const result = await listNativeRootSkills(harness.deps, {
          registrations: [
            registration(harness, "resolving"),
            registration(harness, "declared"),
          ],
          sharedRoots,
          hostId: "host-a",
          cwd: "/work/one",
        });

        expect(result.providers.map((entry) => entry.providerId)).toEqual([
          "resolving",
          "declared",
        ]);
        expect(responder.requests.map((request) => request.command)).toEqual([
          expect.objectContaining({
            type: "host.list_skills",
            cwd: "/work/one",
            sharedRoots,
            providers: [
              expect.objectContaining({
                providerId: "resolving",
                resolver: expect.objectContaining({ pluginId: PLUGIN_ID }),
              }),
              expect.objectContaining({
                providerId: "declared",
                resolver: null,
              }),
            ],
          }),
        ]);
      },
    );
  });

  it("lists declared roots only, and warns, when a resolving plugin has no live artifact", async () => {
    await withTestHarness({ extraProviders: [RESOLVING] }, async (harness) => {
      const responder = registerListingHost(harness, "host-a");
      const warn = vi.fn();
      const deps = { ...harness.deps, logger: { ...testLogger, warn } };

      await listProviderNativeCommands(deps, {
        registration: registration(harness, "resolving"),
        hostId: "host-a",
        cwd: "/work/one",
      });

      expect(responder.requests.map((request) => request.command)).toEqual([
        expect.objectContaining({
          provider: { ...RESOLVING_SCAN, resolver: null },
        }),
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        pluginId: PLUGIN_ID,
        providerId: "resolving",
      });
      expect(warn.mock.calls[0]?.[1]).toContain("no live bb.host artifact");
    });
  });
});

describe("createProviderListingBudget", () => {
  it("hands each step what is left of one command timeout and times out under the floor", () => {
    let clock = 5_000;
    const budget = createProviderListingBudget({ now: () => clock });
    expect(budget.remainingMs()).toBe(COMMAND_TIMEOUT_MS);

    clock += 25_000;
    expect(budget.remainingMs()).toBe(COMMAND_TIMEOUT_MS - 25_000);

    clock = 5_000 + COMMAND_TIMEOUT_MS - PROVIDER_LISTING_BUDGET_FLOOR_MS;
    expect(budget.remainingMs()).toBe(PROVIDER_LISTING_BUDGET_FLOOR_MS);
    clock += 1;
    let thrown: unknown;
    try {
      budget.remainingMs();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      status: 504,
      body: { code: "command_timeout" },
    });
  });
});
