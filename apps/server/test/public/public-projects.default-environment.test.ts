import {
  createEnvironment,
  createProjectSource,
  listThreadsWithPendingInteractionStateForProjects,
  setProjectGitRemoteUrlIfMissing,
  updateHost,
} from "@bb/db";
import {
  gitBranchSelectionSchema,
  PERSONAL_PROJECT_ID,
  threadSchema,
} from "@bb/domain";
import {
  validatePluginEnvironmentProviderDeclaration,
  validatePluginMachineProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../../src/services/environments/environment-provider-ids.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentCompositionRecord,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { resolveCreateThreadEnvironment } from "../../src/services/threads/thread-default-policy.js";
import { getThreadProvisionContext } from "../../src/services/threads/thread-startup-store.js";
import { checkoutProviderInputsSchema } from "../helpers/environment-provider.js";
import { readJson } from "../helpers/json.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import { providerOperations } from "../helpers/provider-decisions.js";
import {
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const SANDBOX = "test-sandbox";
const worktreeInputsSchema = z.object({
  branch: gitBranchSelectionSchema.default({ kind: "default" }),
});
const SANDBOX_MACHINE = "test-machine";

function providerRecord(
  id: string,
  displayName: string,
  requires: { projectCheckout: boolean; gitCheckout: boolean },
  inputs: z.ZodType,
): PluginEnvironmentProviderRecord {
  return {
    pluginId: `environment-${id}`,
    provider: validatePluginEnvironmentProviderDeclaration({
      id,
      displayName,
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
      requires,
      inputs,
      ...providerOperations(() => ({ action: "wait", reason: "Preparing" })),
    }),
  };
}

const sandboxComposition: PluginEnvironmentCompositionRecord = {
  pluginId: "sandbox",
  composition: {
    id: SANDBOX,
    displayName: "Sandbox",
    description: "A new sandbox for each thread.",
    icon: "Cloud",
    machineProviderId: SANDBOX_MACHINE,
    environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
  },
};

function installProviders(
  options: {
    compositions?: PluginEnvironmentCompositionRecord[];
    worktreeInputs?: z.ZodType;
  } = {},
): void {
  const records = [
    providerRecord(
      DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
      "Project checkout",
      { projectCheckout: true, gitCheckout: false },
      checkoutProviderInputsSchema,
    ),
    providerRecord(
      DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
      "Worktree",
      { projectCheckout: true, gitCheckout: true },
      options.worktreeInputs ?? worktreeInputsSchema,
    ),
  ];
  const compositions = options.compositions ?? [sandboxComposition];
  setPluginEnvironmentProviderBridge({
    listEnvironmentCompositions: () => compositions,
    listEnvironmentProviders: () => records,
    getEnvironmentProvider: (id) =>
      records.find((record) => record.provider.id === id),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  const machine = {
    pluginId: "sandbox",
    provider: validatePluginMachineProviderDeclaration({
      id: SANDBOX_MACHINE,
      displayName: "Sandbox machine",
      description: "Provision a sandbox.",
      icon: "Cloud",
      create: async () => ({
        status: "failed" as const,
        message: "Not provisioned in tests",
      }),
      reconcileCleanup: async () => ({ status: "removed" as const }),
      remove: async () => ({ status: "removed" as const }),
    }),
  };
  setPluginMachineProviderBridge({
    listMachineProviders: () => [machine],
    getMachineProvider: (id) =>
      id === machine.provider.id ? machine : undefined,
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  onTestFinished(() => {
    setPluginEnvironmentProviderBridge(undefined);
    setPluginMachineProviderBridge(undefined);
  });
}

function seedTwoMachineProject(harness: TestAppHarness) {
  const { host: primary } = seedHostSession(harness.deps, {
    id: "host-primary",
    name: "server",
  });
  seedPrimaryHost(harness.deps, primary.id);
  const { host: laptop } = seedHostSession(harness.deps, {
    id: "host-laptop",
    name: "laptop",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: primary.id,
    name: "Shop",
    path: "/tmp/shop-primary",
  });
  createProjectSource(harness.db, harness.hub, {
    projectId: project.id,
    type: "local_path",
    hostId: laptop.id,
    path: "/tmp/shop-laptop",
  });
  setProjectGitRemoteUrlIfMissing(
    harness.db,
    harness.hub,
    project.id,
    "https://example.test/shop.git",
  );
  return { laptop, primary, project };
}

async function patchProject(
  harness: TestAppHarness,
  projectId: string,
  body: unknown,
): Promise<Response> {
  return harness.app.request(`/api/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getProject(
  harness: TestAppHarness,
  projectId: string,
): Promise<Record<string, unknown>> {
  const response = await harness.app.request(`/api/v1/projects/${projectId}`);
  expect(response.status).toBe(200);
  return (await readJson(response)) as Record<string, unknown>;
}

async function createProjectDefaultThread(
  harness: TestAppHarness,
  projectId: string,
): Promise<Response> {
  return harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "plugin",
      originPluginId: "automations",
      projectId,
      providerId: "codex",
      model: "requested-model",
      input: [{ type: "text", text: "Run the sweep" }],
      environment: { type: "project-default" },
    }),
  });
}

async function createdThreadId(response: Response) {
  const body = await readJson(response);
  expect(response.status, JSON.stringify(body)).toBe(201);
  return threadSchema.parse(body).id;
}

describe("project default environment setting", () => {
  it("sets, keeps and resets a default that creates a new machine", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seedTwoMachineProject(harness);

      const set = await patchProject(harness, project.id, {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: SANDBOX,
        },
      });

      expect(set.status).toBe(200);
      const expected = {
        type: "provider",
        environmentProviderId: SANDBOX,
        machine: {
          type: "new",
          machineProviderId: SANDBOX_MACHINE,
          inputs: null,
        },
        inputs: {},
      };
      expect(await readJson(set)).toMatchObject({
        defaultEnvironment: expected,
        defaultEnvironmentProblem: null,
      });

      const renamed = await patchProject(harness, project.id, {
        name: "Shop app",
      });
      expect(await readJson(renamed)).toMatchObject({
        name: "Shop app",
        defaultEnvironment: expected,
      });

      const reset = await patchProject(harness, project.id, {
        defaultEnvironment: null,
      });
      expect(await readJson(reset)).toMatchObject({
        defaultEnvironment: null,
        defaultEnvironmentProblem: null,
      });
      expect(await getProject(harness, project.id)).toMatchObject({
        name: "Shop app",
        defaultEnvironment: null,
      });
    });
  });

  it("stores a provider on an existing machine", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);

      const response = await patchProject(harness, project.id, {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
          machine: { type: "existing", hostId: laptop.id },
          inputs: {},
        },
      });

      expect(response.status).toBe(200);
      expect(await getProject(harness, project.id)).toMatchObject({
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
          machine: { type: "existing", hostId: laptop.id },
          inputs: {},
        },
        defaultEnvironmentProblem: null,
      });
    });
  });

  it.each([
    {
      name: "an unknown provider",
      environment: { environmentProviderId: "missing-provider" },
      message:
        '"missing-provider" cannot be the default environment of Shop: the "missing-provider" environment provider is not registered',
    },
    {
      name: "a provider without its machine",
      environment: {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
      },
      message:
        '"git-worktree" cannot be the default environment of Shop: choose the existing machine it runs on',
    },
    {
      name: "environment inputs",
      environment: {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: "host-laptop" },
        inputs: { branch: { kind: "named", name: "dev" } },
      },
      message:
        '"git-worktree" cannot be the default environment of Shop: a project default cannot carry environment inputs; choose them for each thread',
    },
    {
      name: "a chosen machine for a composition",
      environment: {
        environmentProviderId: SANDBOX,
        machine: { type: "existing", hostId: "host-laptop" },
      },
      message: `"${SANDBOX}" cannot be the default environment of Shop: it creates a new machine with provider "${SANDBOX_MACHINE}", so the machine cannot be chosen`,
    },
  ])("refuses $name", async ({ environment, message }) => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seedTwoMachineProject(harness);

      const response = await patchProject(harness, project.id, {
        defaultEnvironment: { type: "provider", ...environment },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ message });
      expect(await getProject(harness, project.id)).toMatchObject({
        defaultEnvironment: null,
      });
    });
  });

  it.each([
    {
      name: "a temporary machine",
      prepare: (harness: TestAppHarness, hostId: string) =>
        updateHost(harness.db, harness.hub, hostId, { type: "ephemeral" }),
      reason: "machine_not_persistent",
    },
    {
      name: "a machine being removed",
      prepare: (harness: TestAppHarness, hostId: string) =>
        updateHost(harness.db, harness.hub, hostId, { phase: "removing" }),
      reason: "machine_removing",
    },
  ])("refuses $name", async ({ prepare, reason }) => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);
      prepare(harness, laptop.id);

      const response = await patchProject(harness, project.id, {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
          machine: { type: "existing", hostId: laptop.id },
        },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ details: { reason } });
    });
  });

  it("refuses a machine without a checkout of the project", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seedTwoMachineProject(harness);
      const { host: other } = seedHostSession(harness.deps, {
        id: "host-other",
        name: "other",
      });

      const response = await patchProject(harness, project.id, {
        defaultEnvironment: {
          type: "provider",
          environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
          machine: { type: "existing", hostId: other.id },
        },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        message:
          '"project-checkout" cannot be the default environment of Shop: other has no checkout of Shop',
        details: { reason: "project_source_missing" },
      });
    });
  });

  it("refuses a new-machine default for a project without a Git remote", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { host } = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Notes",
      });

      const response = await patchProject(harness, project.id, {
        defaultEnvironment: { type: "provider", environmentProviderId: SANDBOX },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        details: { reason: "git_remote_missing" },
      });
    });
  });

  it("has no default environment for the Personal project", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      seedTwoMachineProject(harness);

      const response = await patchProject(harness, PERSONAL_PROJECT_ID, {
        defaultEnvironment: { type: "provider", environmentProviderId: SANDBOX },
      });

      expect(response.status).toBe(404);
    });
  });
});

describe("project-default threads with a project default", () => {
  async function setDefault(
    harness: TestAppHarness,
    projectId: string,
    environment: Record<string, unknown>,
  ) {
    const response = await patchProject(harness, projectId, {
      defaultEnvironment: { type: "provider", ...environment },
    });
    expect(response.status).toBe(200);
  }

  it("starts a root thread on the composition the project defaults to", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, { environmentProviderId: SANDBOX });

      const threadId = await createdThreadId(
        await createProjectDefaultThread(harness, project.id),
      );

      expect(
        getThreadProvisionContext(harness.db, threadId)?.request
          .environmentIntent,
      ).toMatchObject({
        type: "provider",
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        machine: { type: "new", machineProviderId: SANDBOX_MACHINE },
      });
    });
  });

  it("gives background threads their own worktree instead of a checkout default", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        machine: { type: "existing", hostId: laptop.id },
      });

      const threadId = await createdThreadId(
        await createProjectDefaultThread(harness, project.id),
      );

      expect(
        getThreadProvisionContext(harness.db, threadId)?.request
          .environmentIntent,
      ).toEqual({
        type: "provider",
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
        inputs: { branch: { kind: "named", name: "origin/main" } },
        selectionResolved: true,
      });
    });
  });

  it("starts background threads in a Worktree default as the worktree provider resolves it", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
      });

      const threadId = await createdThreadId(
        await createProjectDefaultThread(harness, project.id),
      );

      expect(
        getThreadProvisionContext(harness.db, threadId)?.request
          .environmentIntent,
      ).toMatchObject({
        type: "provider",
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
        inputs: { branch: { kind: "default" } },
      });
    });
  });

  it("wakes a suspended default machine instead of failing", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        machine: { type: "existing", hostId: laptop.id },
      });
      const resume = vi.fn(async () => ({ resource: { id: "restored" } }));
      installMachineProvider({
        resume,
        suspend: async () => ({ resource: { id: "saved" } }),
      });
      updateHost(harness.db, harness.hub, laptop.id, {
        machineProviderId: "test-machine",
        phase: "suspended",
        resource: { id: "saved" },
        suspendedAt: 1,
      });

      const threadId = await createdThreadId(
        await createProjectDefaultThread(harness, project.id),
      );

      expect(resume).toHaveBeenCalledOnce();
      expect(
        getThreadProvisionContext(harness.db, threadId)?.request
          .environmentIntent,
      ).toMatchObject({
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
      });
    });
  });

  it("keeps a child on its live parent's machine", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { primary, project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, { environmentProviderId: SANDBOX });
      const parentEnvironment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: primary.id,
        path: "/tmp/shop-parent",
        providerOwnsPath: true,
        status: "ready",
        environmentProvider: null,
      });

      await expect(
        resolveCreateThreadEnvironment(harness.deps, {
          parentThread: {
            archivedAt: null,
            deletedAt: null,
            environmentId: parentEnvironment.id,
            id: "thr-parent",
            parentThreadId: null,
            projectId: project.id,
          },
          projectId: project.id,
          requestedEnvironment: { type: "project-default" },
        }),
      ).resolves.toEqual({
        type: "provider",
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: primary.id },
        inputs: { branch: { kind: "default" } },
      });
    });
  });

  it("fails before creating a thread when the default's provider is gone", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, { environmentProviderId: SANDBOX });
      installProviders({ compositions: [] });

      const response = await createProjectDefaultThread(harness, project.id);

      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "project_default_environment_unavailable",
        message: `Shop starts new threads in "${SANDBOX}", which is unavailable: the "${SANDBOX}" environment provider is not registered. Change or reset the default in Project settings → Thread defaults (bb project default-environment set|reset ${project.id}), or choose an environment for this thread.`,
        details: {
          projectId: project.id,
          environmentProviderId: SANDBOX,
          reason: "environment_provider_missing",
        },
      });
      expect(await getProject(harness, project.id)).toMatchObject({
        defaultEnvironment: { environmentProviderId: SANDBOX },
        defaultEnvironmentProblem: {
          reason: "environment_provider_missing",
        },
      });
      expect(
        listThreadsWithPendingInteractionStateForProjects(harness.db, {
          archived: false,
          projectIds: [project.id],
        }),
      ).toEqual([]);
    });
  });

  it("reports and refuses a default whose provider now needs inputs", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
      });
      installProviders({
        worktreeInputs: z.object({ branch: gitBranchSelectionSchema }),
      });

      expect(await getProject(harness, project.id)).toMatchObject({
        defaultEnvironmentProblem: { reason: "inputs_invalid" },
      });
      const response = await createProjectDefaultThread(harness, project.id);
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        details: { reason: "inputs_invalid" },
      });
    });
  });

  it("fails when the default machine was removed", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { laptop, project } = seedTwoMachineProject(harness);
      await setDefault(harness, project.id, {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
      });
      updateHost(harness.db, harness.hub, laptop.id, {
        destroyedAt: Date.now(),
      });

      const response = await createProjectDefaultThread(harness, project.id);

      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "project_default_environment_unavailable",
        details: { reason: "machine_missing" },
      });
    });
  });

  it("fails instead of moving the thread when the default machine is offline", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const laptop = seedHost(harness.deps, { id: "host-laptop" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: primary.id,
        name: "Shop",
      });
      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: laptop.id,
        path: "/tmp/shop-laptop",
      });
      await setDefault(harness, project.id, {
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
        machine: { type: "existing", hostId: laptop.id },
      });

      const response = await createProjectDefaultThread(harness, project.id);

      expect(response.status).toBe(502);
      expect(await readJson(response)).toMatchObject({
        code: "host_unavailable",
      });
    });
  });
});
