import { getAppSettings, updateHost } from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import {
  systemConfigResponseSchema,
  systemExecutionOptionsResponseSchema,
  systemProviderInfoSchema,
} from "@bb/server-contract";
import { availableModelFixture } from "../helpers/available-models.js";
import { readJson } from "../helpers/json.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { createProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { listSystemProviderInfos } from "../../src/services/system/execution-options.js";

function providerHostResponse(
  request: HostDaemonOnlineRpcRequestMessage,
  installedProviderId: string,
  modelId: string,
  installedStatus:
    | "ready"
    | "not_installed"
    | "unauthenticated"
    | "unknown" = "ready",
) {
  if (request.command.type === "provider.list_models") {
    return {
      ok: true as const,
      result: {
        models: [availableModelFixture({ model: modelId })],
        selectedOnlyModels: [],
      },
    };
  }
  if (request.command.type === "provider.health") {
    return {
      ok: true as const,
      result: {
        supported: true as const,
        health: {
          status:
            request.command.providerId === installedProviderId
              ? installedStatus
              : ("not_installed" as const),
          statusMessage: null,
          accountEmail: null,
          planLabel: null,
          installedVersion: null,
          minimumSupportedVersion: null,
          canInstall: false,
          canUpdate: false,
          loginCommand: null,
        },
      },
    };
  }
  throw new Error(`Unexpected RPC command ${request.command.type}`);
}

async function providerIds(response: Response): Promise<string[]> {
  const body = systemProviderInfoSchema.array().parse(await readJson(response));
  return body.map((provider) => provider.id);
}

describe("system provider host routing", () => {
  it("separates provider discovery by explicit host and environment host while preserving primary fallback", async () => {
    await withTestHarness({}, async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-provider-primary",
      });
      const remote = seedHostSession(harness.deps, {
        id: "host-provider-remote",
      });
      const remoteModelCommands: Extract<
        HostDaemonOnlineRpcRequestMessage["command"],
        { type: "provider.list_models" }
      >[] = [];
      seedPrimaryHost(harness.deps, primary.host.id);

      registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: (request) =>
          providerHostResponse(request, "acp-opencode", "primary-model"),
      });
      registerHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        handle: (request) => {
          if (request.command.type === "provider.list_models") {
            remoteModelCommands.push(request.command);
          }
          return providerHostResponse(request, "acp-omp", "remote-model");
        },
      });

      const { project } = seedProjectWithSource(harness.deps, {
        hostId: remote.host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remote.host.id,
        projectId: project.id,
      });

      const primaryIds = await providerIds(
        await harness.app.request("/api/v1/system/providers"),
      );
      expect(primaryIds).toContain("acp-opencode");
      expect(primaryIds).not.toContain("acp-omp");

      const explicitRemoteIds = await providerIds(
        await harness.app.request(
          `/api/v1/system/providers?hostId=${remote.host.id}`,
        ),
      );
      expect(explicitRemoteIds).toContain("acp-omp");
      expect(explicitRemoteIds).not.toContain("acp-opencode");

      const environmentIds = await providerIds(
        await harness.app.request(
          `/api/v1/system/providers?environmentId=${environment.id}`,
        ),
      );
      expect(environmentIds).toContain("acp-omp");
      expect(environmentIds).not.toContain("acp-opencode");

      const primaryModels = systemExecutionOptionsResponseSchema.parse(
        await readJson(
          await harness.app.request(
            "/api/v1/system/execution-options?providerId=codex",
          ),
        ),
      );
      expect(primaryModels.models.map((model) => model.model)).toEqual([
        "primary-model",
      ]);

      const explicitModels = systemExecutionOptionsResponseSchema.parse(
        await readJson(
          await harness.app.request(
            `/api/v1/system/execution-options?hostId=${remote.host.id}&providerId=codex`,
          ),
        ),
      );
      expect(explicitModels.models.map((model) => model.model)).toEqual([
        "remote-model",
      ]);

      const environmentModels = systemExecutionOptionsResponseSchema.parse(
        await readJson(
          await harness.app.request(
            `/api/v1/system/execution-options?environmentId=${environment.id}&providerId=codex`,
          ),
        ),
      );
      expect(environmentModels.models.map((model) => model.model)).toEqual([
        "remote-model",
      ]);
      expect(
        remoteModelCommands.map(({ bridgeLaunch: _ignored, ...rest }) => rest),
      ).toEqual([{ type: "provider.list_models", providerId: "codex" }]);
    });
  });

  it("reports the routed machine's permission ceiling", async () => {
    await withTestHarness({}, async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-ceiling-primary",
      });
      const capped = seedHostSession(harness.deps, {
        id: "host-ceiling-capped",
      });
      seedPrimaryHost(harness.deps, primary.host.id);
      updateHost(harness.db, harness.hub, capped.host.id, {
        maxPermissionMode: "accept-edits",
      });
      for (const target of [primary, capped]) {
        registerHostRpcResponder(harness, {
          hostId: target.host.id,
          sessionId: target.session.id,
          handle: (request) =>
            providerHostResponse(request, "acp-opencode", "model"),
        });
      }

      const uncapped = systemExecutionOptionsResponseSchema.parse(
        await readJson(
          await harness.app.request(
            "/api/v1/system/execution-options?providerId=codex",
          ),
        ),
      );
      expect(uncapped.permissionCeiling).toBe("full");

      const cappedOptions = systemExecutionOptionsResponseSchema.parse(
        await readJson(
          await harness.app.request(
            `/api/v1/system/execution-options?hostId=${capped.host.id}&providerId=codex`,
          ),
        ),
      );
      expect(cappedOptions.permissionCeiling).toBe("accept-edits");
    });
  });

  it.each(["providers", "execution-options"])(
    "rejects simultaneous host and environment selectors for %s",
    async (route) => {
      await withTestHarness({}, async (harness) => {
        const response = await harness.app.request(
          `/api/v1/system/${route}?hostId=host-one&environmentId=env-one`,
        );
        expect(response.status).toBe(400);
        expect(await readJson(response)).toMatchObject({
          code: "invalid_request",
          message: expect.stringContaining(
            "hostId and environmentId are mutually exclusive",
          ),
        });
      });
    },
  );
});

describe("GET /api/v1/system/providers", () => {
  it("serves the maintenance facts under `maintenance` and no alias key", async () => {
    await withTestHarness({}, async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-provider-shape-primary",
      });
      seedPrimaryHost(harness.deps, primary.host.id);
      registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: (request) =>
          providerHostResponse(request, "acp-opencode", "model"),
      });

      const response = await harness.app.request("/api/v1/system/providers");
      expect(response.status).toBe(200);
      const raw = await readJson(response);

      const rows = z.array(z.record(z.string(), z.unknown())).parse(raw);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(
          Object.keys(row).filter((key) =>
            key.startsWith("experimental_provider"),
          ),
        ).toEqual([]);
      }
      for (const provider of systemProviderInfoSchema.array().parse(raw)) {
        expect(provider.maintenance).toEqual({
          health: expect.any(Boolean),
          usage: expect.any(Boolean),
          installation: expect.any(Boolean),
        });
      }
    });
  });
});

async function saveProviderOrder(harness: TestAppHarness, order: string[]) {
  const response = await harness.app.request("/api/v1/settings/general", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...defaultAppSettings, providerOrder: order }),
  });
  expect(response.status).toBe(200);
  expect(getAppSettings(harness.db).providerOrder).toEqual(order);
  const config = systemConfigResponseSchema.parse(
    await readJson(await harness.app.request("/api/v1/system/config")),
  );
  expect(config.generalSettings.providerOrder).toEqual(order);
}

const interleavedProviderOrder = [
  "acp-omp",
  "claude-code",
  "acp-opencode",
  "codex",
  "pi",
  "acp-cursor",
];

describe("persisted provider ordering", () => {
  it("preserves interleaved order after saving with warm probes and after invalidation", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const installed = new Set(["acp-omp", "acp-opencode"]);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) =>
          providerHostResponse(
            request,
            request.command.type === "provider.health" &&
              installed.has(request.command.providerId)
              ? request.command.providerId
              : "",
            "model",
          ),
      });
      const read = async () =>
        providerIds(await harness.app.request("/api/v1/system/providers"));
      await read();
      const probeCount = responder.requests.length;
      expect(probeCount).toBeGreaterThan(0);
      await saveProviderOrder(harness, interleavedProviderOrder);
      expect(await read()).toEqual(interleavedProviderOrder);
      const reversed = [...interleavedProviderOrder].reverse();
      await saveProviderOrder(harness, reversed);
      expect(await read()).toEqual(reversed);
      expect(responder.requests).toHaveLength(probeCount);
      installed.delete("acp-omp");
      expect(await read()).toEqual(reversed);
      harness.deps.providerRegistry.forgetAllInstalled();
      expect(await read()).toEqual(reversed.filter((id) => id !== "acp-omp"));
      expect(responder.requests).toHaveLength(probeCount * 2);
      const options = systemExecutionOptionsResponseSchema.parse(
        await readJson(
          await harness.app.request(
            "/api/v1/system/execution-options?providerId=codex",
          ),
        ),
      );
      expect(options.providers.map((provider) => provider.id)).toEqual(
        reversed.filter((id) => id !== "acp-omp"),
      );
      expect(options.models.map((model) => model.model)).toEqual(["model"]);
    });
  });

  it.each([
    "ready",
    "unauthenticated",
    "unknown",
    "not_installed",
    "unsupported",
    "failed",
  ] as const)(
    "keeps visibility semantics and saved order when a probe is %s",
    async (status) => {
      await withTestHarness({}, async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        seedPrimaryHost(harness.deps, host.id);
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            if (
              request.command.type === "provider.health" &&
              request.command.providerId === "acp-omp"
            ) {
              if (status === "failed")
                return {
                  ok: false,
                  errorCode: "host_unavailable",
                  errorMessage: "Fixture probe failed",
                };
              if (status === "unsupported")
                return { ok: true, result: { supported: false } };
              return providerHostResponse(request, "acp-omp", "model", status);
            }
            return providerHostResponse(request, "acp-opencode", "model");
          },
        });
        await saveProviderOrder(harness, interleavedProviderOrder);
        const hidden = ["not_installed", "unsupported", "failed"].includes(
          status,
        );
        expect(
          await providerIds(
            await harness.app.request("/api/v1/system/providers"),
          ),
        ).toEqual(
          interleavedProviderOrder.filter((id) => !hidden || id !== "acp-omp"),
        );
      });
    },
  );

  it("preserves configured order with an offline host", async () => {
    await withTestHarness({}, async (harness) => {
      await saveProviderOrder(harness, interleavedProviderOrder);
      expect(
        await providerIds(
          await harness.app.request("/api/v1/system/providers"),
        ),
      ).toEqual(["claude-code", "codex", "pi", "acp-cursor"]);
    });
  });

  it.each(["usage", "installation"] as const)(
    "preserves order and probe selection for %s capability",
    async (capability) => {
      await withTestHarness({}, async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        seedPrimaryHost(harness.deps, host.id);
        const registry = createProviderRegistryService({
          readUserProviderPreferences: () => getAppSettings(harness.db),
        });
        for (const registration of harness.deps.providerRegistry.list()) {
          registry.register({
            ...registration,
            info:
              registration.info.id === "acp-opencode"
                ? {
                    ...registration.info,
                    maintenance: {
                      health: true,
                      usage: true,
                      installation: true,
                    },
                  }
                : registration.info,
          });
        }
        registry.markRegistrationsSettled();
        harness.deps.providerRegistry = registry;
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) =>
            providerHostResponse(request, "acp-opencode", "model"),
        });
        await saveProviderOrder(harness, interleavedProviderOrder);
        const registrations = harness.deps.providerRegistry.list();
        const expected = registrations.filter(
          (entry) =>
            entry.info.maintenance[capability] &&
            (entry.visibility === "always" || entry.info.id === "acp-opencode"),
        );
        const result = await listSystemProviderInfos(harness.deps, {
          capability,
        });
        expect(result).toEqual(expected.map((entry) => entry.info));
        expect(result.map((provider) => provider.id)).toContain("acp-opencode");
        if (capability === "usage") {
          expect(
            await providerIds(
              await harness.app.request(
                "/api/v1/system/providers?capability=usage",
              ),
            ),
          ).toEqual(result.map((provider) => provider.id));
        }
        expect(
          responder.requests
            .map((request) => {
              expect(request.command.type).toBe("provider.health");
              return "providerId" in request.command
                ? request.command.providerId
                : null;
            })
            .sort(),
        ).toEqual(
          registrations
            .filter(
              (entry) =>
                entry.visibility === "installed" &&
                entry.info.maintenance[capability],
            )
            .map((entry) => entry.info.id)
            .sort(),
        );
      });
    },
  );

  it.each(["always", "installed"] as const)(
    "preserves order with only the %s group registered",
    async (visibility) => {
      await withTestHarness({}, async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        seedPrimaryHost(harness.deps, host.id);
        const registrations = harness.deps.providerRegistry
          .list()
          .filter((entry) => entry.visibility === visibility);
        const registry = createProviderRegistryService({
          readUserProviderPreferences: () => getAppSettings(harness.db),
        });
        for (const registration of registrations)
          registry.register(registration);
        registry.markRegistrationsSettled();
        harness.deps.providerRegistry = registry;
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) =>
            providerHostResponse(
              request,
              "providerId" in request.command ? request.command.providerId : "",
              "model",
            ),
        });
        const order = registrations.map((entry) => entry.info.id).reverse();
        await saveProviderOrder(harness, order);
        expect(
          await providerIds(
            await harness.app.request("/api/v1/system/providers"),
          ),
        ).toEqual(order);
      });
    },
  );
});
