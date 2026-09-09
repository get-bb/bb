import { ensurePersonalProject, setProjectGitRemoteUrlIfMissing } from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  validatePluginEnvironmentProviderDeclaration,
  validatePluginMachineProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { systemMachineProvidersResponseSchema } from "@bb/server-contract";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { completeProviderSelection } from "../../src/services/threads/thread-environment-placement.js";
import { resolveMachineProviderAvailability } from "../../src/services/machines/provider-availability.js";
import { createMachine } from "../../src/services/machines/provider-orchestration.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const row = {
  displayName: "Test machine",
  environmentProviderId: "project-checkout",
};

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
  setPluginEnvironmentProviderBridge(undefined);
});

describe("machine checkout picker rows", () => {
  it.each(["git-project", "no-remote", "personal", "unscoped"] as const)(
    "gates only the checkout row for %s",
    async (scope) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, { id: "row-host" });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        ensurePersonalProject(harness.db);
        if (scope === "git-project")
          setProjectGitRemoteUrlIfMissing(
            harness.db,
            harness.hub,
            project.id,
            "https://example.test/repo.git",
          );
        const environmentRecords = [
          { id: "project-checkout", requires: { projectCheckout: true } },
          { id: "personal-workspace", requires: { projectless: true } },
        ].map(({ id, requires }) => ({
          pluginId: "test-environment",
          provider: validatePluginEnvironmentProviderDeclaration({
            id,
            displayName: id,
            requires,
            create: async () => ({
              status: "created",
              path: "/workspace",
              ownsPath: false,
            }),
            remove: async () => ({ status: "removed" }),
          }),
        }));
        setPluginEnvironmentProviderBridge({
          listEnvironmentProviders: () => environmentRecords,
          getEnvironmentProvider: (id) =>
            environmentRecords.find((record) => record.provider.id === id),
          invokeProvider: async (_pluginId, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });
        const machineRecord = {
          pluginId: "test-machine",
          provider: validatePluginMachineProviderDeclaration({
            reconcileCleanup: async () => ({ status: "removed" }),
            id: "test-machine",
            displayName: "Test machine",
            environmentRow: row,
            inputs: z.object({ size: z.string() }),
            create: async () => ({
              status: "created",
              hostId: host.id,
              resource: {},
            }),
            remove: async () => ({ status: "removed" }),
          }),
        };
        const machineRecords = [
          machineRecord,
          {
            ...machineRecord,
            provider: {
              ...machineRecord.provider,
              id: "no-shortcut",
              environmentRow: null,
            },
          },
          {
            ...machineRecord,
            provider: {
              ...machineRecord.provider,
              id: "personal-shortcut",
              environmentRow: {
                displayName: "Personal machine",
                environmentProviderId: "personal-workspace",
              },
            },
          },
        ];
        setPluginMachineProviderBridge({
          listMachineProviders: () => machineRecords,
          getMachineProvider: (id) =>
            machineRecords.find((record) => record.provider.id === id),
          invokeProvider: async (_pluginId, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });
        const projectId =
          scope === "unscoped"
            ? undefined
            : scope === "personal"
              ? PERSONAL_PROJECT_ID
              : project.id;
        const response = await harness.app.request(
          `/api/v1/system/machine-providers${projectId === undefined ? "" : `?projectId=${projectId}`}`,
        );
        expect(response.status).toBe(200);
        const { providers } = systemMachineProvidersResponseSchema.parse(
          await response.json(),
        );
        expect(providers).toHaveLength(3);
        expect(providers[1]).toMatchObject({
          id: "no-shortcut",
          environmentRow: null,
          availability: { status: "available" },
        });
        expect(providers[2]).toMatchObject({
          id: "personal-shortcut",
          environmentRow: { environmentProviderId: "personal-workspace" },
          availability: { status: "available" },
        });
        expect(providers[0]).toMatchObject({
          requires: { gitRemote: false },
          availability: { status: "available" },
          environmentRow: scope === "git-project" ? row : null,
          acceptsEmptyInputs: false,
          inputs: { type: "object", properties: { size: { type: "string" } } },
        });
        if (scope === "personal") {
          const personal = environmentRecords.find(
            (record) => record.provider.id === "personal-workspace",
          );
          if (personal === undefined)
            throw new Error("Missing personal provider");
          const selection = await completeProviderSelection(
            harness.deps,
            personal,
            PERSONAL_PROJECT_ID,
            {
              machine: {
                type: "new",
                machineProviderId: "test-machine",
                inputs: { size: "small" },
              },
              inputs: null,
            },
          );
          expect(selection.machine).toEqual({
            type: "new",
            machineProviderId: "test-machine",
            inputs: { size: "small" },
          });
          expect(
            await createMachine(harness.deps, {
              machineProviderId: "test-machine",
              projectId: PERSONAL_PROJECT_ID,
              inputs: { size: "small" },
            }),
          ).toMatchObject({ id: host.id });
        }
        if (scope === "unscoped") {
          expect(
            await createMachine(harness.deps, {
              machineProviderId: "test-machine",
              projectId: null,
              inputs: { size: "small" },
            }),
          ).toMatchObject({ id: host.id });
        }
      });
    },
  );
});

it("rechecks availability after provider setup changes without restarting the plugin", async () => {
  await withTestHarness(async (harness) => {
    let configured = false;
    const record = {
      pluginId: "test-machine",
      provider: validatePluginMachineProviderDeclaration({
        id: "test-machine",
        displayName: "Test machine",
        availability: () =>
          configured
            ? { status: "available" }
            : { status: "setup-required", message: "Connect your account" },
        create: async () => ({
          status: "created",
          hostId: "test-host",
          resource: {},
        }),
        reconcileCleanup: async () => ({ status: "removed" }),
        remove: async () => ({ status: "removed" }),
      }),
    };
    setPluginMachineProviderBridge({
      listMachineProviders: () => [record],
      getMachineProvider: () => record,
      invokeProvider: async (_pluginId, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 10_000,
    });
    expect(
      await resolveMachineProviderAvailability(harness.deps, record, {}),
    ).toEqual({ status: "setup-required", message: "Connect your account" });
    configured = true;
    expect(
      await resolveMachineProviderAvailability(harness.deps, record, {}),
    ).toEqual({ status: "available" });
  });
});
