import { environments, getEnvironment, getThread } from "@bb/db";
import { listEvents } from "@bb/db/testing";
import type { GitCheckoutRef } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import type {
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderRenameBranchContext,
  PluginEnvironmentProviderRenameBranchResult,
} from "@get-bb/plugin-sdk/environment-provider";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRANCH_RENAME_OPERATION } from "../../src/services/environments/environment-branch-rename.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { clearAllThreadProvisionSchedules } from "../../src/services/threads/thread-startup-store.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import {
  listQueuedCommands,
  registerTestHostRpcCapture,
  reportNextEnvironmentAttachSuccess,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PROVIDER_ID = "renaming-worktree";
const WORKSPACE_PATH = "/tmp/branch-rename-worktree";
const PROMPT = "Fix the login redirect loop on the settings page";

interface Fixture {
  creates: string[];
  renames: PluginEnvironmentProviderRenameBranchContext[];
  attachQueuedAtRename: boolean[];
  finishCreate: (result?: PluginEnvironmentProviderCreateResult) => void;
  resolveTitle: (title: string) => void;
  rejectTitle: (error: Error) => void;
  detachHead: () => void;
}

function setUp(
  harness: TestAppHarness,
  options: {
    holdCreate: boolean;
    checkedOutBranch?: string;
    renameResult?: PluginEnvironmentProviderRenameBranchResult;
  },
): Fixture & { hostId: string; projectId: string } {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-branch-rename",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/branch-rename-project",
  });
  const onBranch = (branchName: string): GitCheckoutRef => ({
    kind: "branch",
    branchName,
    headSha: "abc123",
  });
  const inspection: { checkout: GitCheckoutRef } = {
    checkout: onBranch("pending"),
  };
  registerTestHostRpcCapture(harness, {
    hostId: host.id,
    sessionId: session.id,
    gitCheckoutInspectionResult: inspection,
  });
  const title = createDeferredPromise<string>();
  registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    pluginId: "provider-codex",
    builtin: true,
    complete: () => title.promise,
  });
  const create = createDeferredPromise<PluginEnvironmentProviderCreateResult>();
  const created: PluginEnvironmentProviderCreateResult = {
    status: "created",
    path: WORKSPACE_PATH,
    ownsPath: true,
    resource: { branch: "placeholder" },
  };
  if (!options.holdCreate) create.resolve(created);
  const fixture: Fixture = {
    creates: [],
    renames: [],
    attachQueuedAtRename: [],
    finishCreate: (result = created) => create.resolve(result),
    resolveTitle: (value) => title.resolve(value),
    rejectTitle: (error) => title.reject(error),
    detachHead: () => {
      inspection.checkout = { kind: "detached", headSha: "abc123" };
    },
  };
  const record = {
    pluginId: "renaming-plugin",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: PROVIDER_ID,
      displayName: "Renaming worktree",
      description: "Creates worktrees before titles exist.",
      icon: "Folder",
      requires: { projectCheckout: true },
      create: async (context) => {
        fixture.creates.push(context.suggestedBranchName);
        inspection.checkout = onBranch(
          options.checkedOutBranch ?? context.suggestedBranchName,
        );
        return create.promise;
      },
      remove: async () => ({ status: "removed" }),
      renameBranch: async (context) => {
        fixture.renames.push(context);
        fixture.attachQueuedAtRename.push(
          listQueuedCommands(harness, "environment.attach").length > 0,
        );
        inspection.checkout = onBranch(context.to);
        return (
          options.renameResult ?? {
            status: "renamed",
            resource: { branch: context.to },
          }
        );
      },
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) => (id === PROVIDER_ID ? record : undefined),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return { ...fixture, hostId: host.id, projectId: project.id };
}

function createThread(
  harness: TestAppHarness,
  args: { hostId: string; projectId: string; title?: string },
) {
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "provider",
      environmentProviderId: PROVIDER_ID,
      machine: { type: "existing", hostId: args.hostId },
      inputs: null,
    },
    input: textInput(PROMPT),
    origin: "app",
    projectId: args.projectId,
    providerId: "codex",
    ...(args.title === undefined ? {} : { title: args.title }),
    startedOnBehalfOf: null,
  });
}

function environmentOf(harness: TestAppHarness, threadId: string) {
  const environmentId = getThread(harness.db, threadId)?.environmentId;
  return environmentId ? getEnvironment(harness.db, environmentId) : null;
}

function renameOperations(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) =>
      event.type === "system/operation" &&
      JSON.parse(event.data).operation === BRANCH_RENAME_OPERATION,
  );
}

afterEach(() => {
  clearAllThreadProvisionSchedules();
  setPluginEnvironmentProviderBridge(undefined);
});

describe("branch rename after parallel title generation", () => {
  it("creates with the thread-id branch and renames before setup when the title lands first", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, { holdCreate: true });
      const thread = await createThread(harness, fixture);

      await vi.waitFor(() =>
        expect(fixture.creates).toEqual([`bb/${thread.id}`]),
      );
      fixture.resolveTitle("Fix Login Redirect");
      await vi.waitFor(() =>
        expect(getThread(harness.db, thread.id)?.title).toBe(
          "Fix Login Redirect",
        ),
      );
      expect(fixture.renames).toEqual([]);
      fixture.finishCreate();

      await reportNextEnvironmentAttachSuccess(harness, thread.id);
      expect(
        fixture.renames.map(({ from, to, resource }) => ({
          from,
          to,
          resource,
        })),
      ).toEqual([
        {
          from: `bb/${thread.id}`,
          to: `bb/fix-login-redirect-${thread.id}`,
          resource: { branch: "placeholder" },
        },
      ]);
      expect(fixture.attachQueuedAtRename).toEqual([false]);
      expect(environmentOf(harness, thread.id)).toMatchObject({
        pendingBranchRename: null,
        resource: { branch: `bb/fix-login-redirect-${thread.id}` },
      });
      expect(renameOperations(harness, thread.id)).toEqual([]);
    });
  });

  it("starts setup without the title and renames once it lands, recording the branch from git", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, { holdCreate: false });
      const thread = await createThread(harness, fixture);

      await reportNextEnvironmentAttachSuccess(harness, thread.id);
      expect(fixture.renames).toEqual([]);
      expect(environmentOf(harness, thread.id)?.pendingBranchRename).toEqual({
        threadId: thread.id,
      });

      fixture.resolveTitle("Fix Login Redirect");
      await vi.waitFor(() =>
        expect(environmentOf(harness, thread.id)?.branchName).toBe(
          `bb/fix-login-redirect-${thread.id}`,
        ),
      );
      expect(fixture.renames).toHaveLength(1);
      expect(environmentOf(harness, thread.id)?.pendingBranchRename).toBeNull();
      expect(
        renameOperations(harness, thread.id).map((event) =>
          JSON.parse(event.data),
        ),
      ).toEqual([
        expect.objectContaining({
          status: "completed",
          metadata: {
            from: `bb/${thread.id}`,
            to: `bb/fix-login-redirect-${thread.id}`,
          },
        }),
      ]);
    });
  });

  it("renames to the fallback title when title generation fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, { holdCreate: false });
      const thread = await createThread(harness, fixture);
      await reportNextEnvironmentAttachSuccess(harness, thread.id);

      fixture.rejectTitle(new Error("title service down"));

      await vi.waitFor(() => expect(fixture.renames).toHaveLength(1));
      expect(fixture.renames[0]?.to).toBe(
        `bb/fix-the-login-redirect-loop-on-the-settings-page-${thread.id}`,
      );
    });
  });

  it("drops the rename when the environment is retiring before the title lands", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, { holdCreate: false });
      const thread = await createThread(harness, fixture);
      await reportNextEnvironmentAttachSuccess(harness, thread.id);
      const environmentId = environmentOf(harness, thread.id)?.id ?? "";
      harness.db
        .update(environments)
        .set({ teardownStatus: "running" })
        .where(eq(environments.id, environmentId))
        .run();

      fixture.resolveTitle("Fix Login Redirect");

      await vi.waitFor(() =>
        expect(
          getEnvironment(harness.db, environmentId)?.pendingBranchRename,
        ).toBeNull(),
      );
      expect(fixture.renames).toEqual([]);
    });
  });

  it("clears the owed rename when the provider keeps the branch", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, {
        holdCreate: false,
        renameResult: { status: "kept", reason: "Already pushed." },
      });
      const thread = await createThread(harness, fixture);
      await reportNextEnvironmentAttachSuccess(harness, thread.id);

      fixture.resolveTitle("Fix Login Redirect");

      await vi.waitFor(() =>
        expect(
          environmentOf(harness, thread.id)?.pendingBranchRename,
        ).toBeNull(),
      );
      expect(fixture.renames).toHaveLength(1);
      expect(environmentOf(harness, thread.id)?.resource).toEqual({
        branch: "placeholder",
      });
      expect(renameOperations(harness, thread.id)).toEqual([]);
    });
  });

  it("renames the adopted environment's checked-out branch when create lands on an existing row", async () => {
    await withTestHarness(async (harness) => {
      const adoptedBranch = "bb/earlier-task-thr_earlier";
      const fixture = setUp(harness, {
        holdCreate: true,
        checkedOutBranch: adoptedBranch,
      });
      const existing = seedEnvironment(harness.deps, {
        hostId: fixture.hostId,
        projectId: fixture.projectId,
        path: WORKSPACE_PATH,
        environmentProviderId: PROVIDER_ID,
        environmentProviderPluginId: "renaming-plugin",
        providerOwnsPath: true,
        branchName: adoptedBranch,
      });
      const thread = await createThread(harness, fixture);
      await vi.waitFor(() =>
        expect(fixture.creates).toEqual([`bb/${thread.id}`]),
      );
      fixture.resolveTitle("Fix Login Redirect");
      await vi.waitFor(() =>
        expect(getThread(harness.db, thread.id)?.title).toBe(
          "Fix Login Redirect",
        ),
      );

      fixture.finishCreate();

      await vi.waitFor(() => expect(fixture.renames).toHaveLength(1));
      expect(fixture.renames[0]).toMatchObject({
        environment: { id: existing.id },
        from: adoptedBranch,
        to: `bb/fix-login-redirect-${thread.id}`,
      });
      await vi.waitFor(() =>
        expect(getThread(harness.db, thread.id)?.environmentId).toBe(
          existing.id,
        ),
      );
      expect(
        harness.db
          .select({ pendingBranchRename: environments.pendingBranchRename })
          .from(environments)
          .all()
          .filter((row) => row.pendingBranchRename !== null),
      ).toEqual([]);
    });
  });

  it("drops the rename when the checkout is on no branch", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, { holdCreate: false });
      const thread = await createThread(harness, fixture);
      await reportNextEnvironmentAttachSuccess(harness, thread.id);
      fixture.detachHead();

      fixture.resolveTitle("Fix Login Redirect");

      await vi.waitFor(() =>
        expect(
          environmentOf(harness, thread.id)?.pendingBranchRename,
        ).toBeNull(),
      );
      expect(fixture.renames).toEqual([]);
    });
  });

  it("names the branch from a provided title and never renames", async () => {
    await withTestHarness(async (harness) => {
      const fixture = setUp(harness, { holdCreate: false });
      const thread = await createThread(harness, {
        ...fixture,
        title: "Provided Title",
      });

      await reportNextEnvironmentAttachSuccess(harness, thread.id);
      expect(fixture.creates).toEqual([`bb/provided-title-${thread.id}`]);
      expect(environmentOf(harness, thread.id)?.pendingBranchRename).toBeNull();
      expect(fixture.renames).toEqual([]);
    });
  });
});
