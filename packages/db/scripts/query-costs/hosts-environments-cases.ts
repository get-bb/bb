import {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  recordProvisionedEnvironmentWorkspace,
} from "../../src/data/environment-lifecycle.js";
import {
  acknowledgeInterruptedEnvironmentHookOperation,
  finishEnvironmentHookOperation,
  forgetFinishedEnvironmentHookOperations,
  getEnvironmentHookOperation,
  hasEnvironmentHookOperation,
  insertEnvironmentHookOperation,
  listUnfinishedEnvironmentHookOperationIdsOnHost,
  restartEnvironmentHookOperation,
} from "../../src/data/environment-hook-operations.js";
import {
  adoptHeldEnvironment,
  bindEnvironmentPath,
  claimEnvironmentPath,
  createEnvironment,
  environmentHasLiveThreads,
  environmentHasOtherStartingOrActiveThread,
  findEnvironmentPathClaim,
  findForeignManagedEnvironmentAtHostPath,
  findOtherLiveThreadAtEnvironmentPath,
  findProjectEnvironmentByHostPath,
  insertHeldEnvironment,
  findProviderEnvironmentContainingPath,
  getEnvironment,
  getFailedTeardownEnvironmentOnHost,
  getPreparingEnvironment,
  getStartingLiveEnvironmentThread,
  listEnvironments,
  listEnvironmentThreads,
  listHostEnvironmentRemovalStates,
  listLiveThreadHosts,
  listProviderLifecycleEnvironments,
  listProvisioningEnvironmentIdsOnHost,
  listReadyEnvironmentWatchTargets,
  listRetiredLoadedEnvironmentIdsOnHost,
  listStartingLiveEnvironmentThreadIds,
  listStoppingLiveEnvironmentThreads,
  listUndeletedEnvironmentThreads,
  markHostEnvironmentsDestroyed,
  recordEnvironmentCurrentBranch,
  recordEnvironmentTeardownFailure,
  releaseEnvironmentHolds,
  releaseFinishedEnvironmentPreparationOwners,
  reserveEnvironment,
  retryFailedEnvironmentTeardownsOnHost,
  setEnvironmentColumns,
  updateEnvironmentMetadata,
  updatePreparingEnvironment,
  type EnvironmentRow,
} from "../../src/data/environments.js";
import {
  getHost,
  getLatestHostAttemptForLaunchKey,
  getNonDestroyedHost,
  getNonDestroyedHostByLaunchKey,
  insertHost,
  listHosts,
  listHostsByIds,
  listNonDestroyedHostsByIds,
  listPublicHosts,
  markHostSeen,
  setHostColumns,
  updateHost,
  upsertHost,
} from "../../src/data/hosts.js";
import {
  hostHasRunningTurnThread,
  listProviderMachines,
  listRunningTurnThreadsOnHost,
  machineHasLiveThreadLaunch,
  machineHasLiveThreads,
  machineHasPendingThreads,
  machineHasProvisioningEnvironment,
  machineHasStartingThreadLaunch,
} from "../../src/data/machines.js";
import {
  ensureProjectAttachmentBackfill,
  nextProjectAttachmentBackfill,
  readAttachmentBackfillInput,
  updateAttachmentBackfill,
  type AttachmentBackfill,
} from "../../src/data/project-attachment-backfill.js";
import {
  acquireProjectAttachmentOwnership,
  claimProjectAttachments,
  copyProjectAttachmentOwnership,
  getProjectAttachment,
  recordProjectAttachment,
} from "../../src/data/project-attachments.js";
import {
  getProjectExecutionDefaults,
  listProjectExecutionDefaultsByProjectIds,
  upsertProjectExecutionDefaults,
} from "../../src/data/project-execution-defaults.js";
import {
  countProjectSources,
  createProjectSource,
  deleteProjectSource,
  getProjectSourceByHost,
  getProjectSourceForProject,
  getProjectSourceOnPersistentHost,
  listProjectSourcesByHost,
  listProjectSourcesByProjectIds,
  projectSourceOwnsPath,
  updateProjectSource,
} from "../../src/data/project-sources.js";
import {
  createProjectSourceFolder,
  deleteProjectSourceFolder,
  listProjectFolderPathsForHost,
  listProjectSourceFolders,
  updateProjectSourceFolderPath,
} from "../../src/data/project-source-folders.js";
import {
  createProject,
  deleteProject,
  ensurePersonalProject,
  findOrCreateProjectByLocalPathSource,
  getPersonalProject,
  getProject,
  getPublicProjectByLocalPathSource,
  listPublicProjects,
  markProjectDeleted,
  reorderProject,
  setProjectGitRemoteUrlIfMissing,
  updateProject,
} from "../../src/data/projects.js";
import {
  listPathInstalledPluginSources,
  rerootServerOwnedPluginPaths,
  swapServerHostRoles,
} from "../../src/data/server-move.js";
import {
  closeSession,
  getLatestSessionForHost,
  getSessionById,
  heartbeatSession,
  listActiveSessionIdsForHost,
  listLatestClosedSessionsForHosts,
  openSession,
  recordSessionRoute,
} from "../../src/data/sessions.js";
import {
  deleteHostServerAccessGrant,
  getHostServerAccessGrant,
  listHostServerAccessGrants,
  upsertHostServerAccessGrant,
} from "../../src/data/host-server-access-grants.js";
import {
  countTerminalSessions,
  createTerminalSession,
  getTerminalSession,
  listOpenTerminalSessionIdsOnHost,
  listTerminalSessions,
  pruneExitedTerminalSessions,
  updateTerminalSession,
  updateTerminalSessions,
} from "../../src/data/terminal-sessions.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";
import {
  HOSTS_ENVIRONMENTS_BLOCKED_TEARDOWN_MESSAGE,
  seedHostsEnvironments,
  type HostsEnvironmentsSeed,
} from "./hosts-environments-seed.js";

const ENVIRONMENTS = "packages/db/src/data/environments.ts";
const ENVIRONMENT_LIFECYCLE = "packages/db/src/data/environment-lifecycle.ts";
const ENVIRONMENT_HOOKS = "packages/db/src/data/environment-hook-operations.ts";
const HOSTS = "packages/db/src/data/hosts.ts";
const MACHINES = "packages/db/src/data/machines.ts";
const BACKFILL = "packages/db/src/data/project-attachment-backfill.ts";
const ATTACHMENTS = "packages/db/src/data/project-attachments.ts";
const DEFAULTS = "packages/db/src/data/project-execution-defaults.ts";
const SOURCES = "packages/db/src/data/project-sources.ts";
const FOLDERS = "packages/db/src/data/project-source-folders.ts";
const PROJECTS = "packages/db/src/data/projects.ts";
const SERVER_MOVE = "packages/db/src/data/server-move.ts";
const SESSIONS = "packages/db/src/data/sessions.ts";
const GRANTS = "packages/db/src/data/host-server-access-grants.ts";
const TERMINALS = "packages/db/src/data/terminal-sessions.ts";
const EXITED_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const TERMINAL_PRUNE_BATCH = 1_000;

type Case = QueryCostCase<HostsEnvironmentsSeed>;

let preparedEnvironment: EnvironmentRow | null = null;
let preparedHeldEnvironment: EnvironmentRow | null = null;
let preparedBackfill: AttachmentBackfill | null = null;
let reorderTarget: { projectId: string; nextProjectId: string } | null = null;

function requirePreparedEnvironment(): EnvironmentRow {
  if (preparedEnvironment === null) {
    throw new Error("Expected a prepared environment");
  }
  return preparedEnvironment;
}

function reserveFixtureEnvironment(
  db: DbConnection,
  fixture: HistoryFixture,
  seed: HostsEnvironmentsSeed,
): EnvironmentRow {
  return reserveEnvironment(db, {
    projectId: fixture.projectId,
    hostId: seed.busyHostId,
    ownerThreadId: fixture.threadId,
    attempt: 1,
    status: "creating",
    environmentProviderId: "project-checkout",
    environmentProviderPluginId: "environment-project-checkout",
    environmentProviderInstanceKey: () => `${fixture.threadId}-1`,
    providerOwnsPath: false,
    statusMessage: "Preparing project checkout…",
  });
}

function insertPluginHeldEnvironment(
  db: DbConnection,
  fixture: HistoryFixture,
  seed: HostsEnvironmentsSeed,
): EnvironmentRow {
  return insertHeldEnvironment(db, {
    projectId: fixture.projectId,
    hostId: seed.busyHostId,
    heldBy: "plugin:environment-git-worktree",
    attempt: 1,
    status: "ready",
    environmentProviderId: "git-worktree",
    environmentProviderPluginId: "environment-git-worktree",
    environmentProviderInstanceKey: (id) => `${id}-1`,
    providerOwnsPath: true,
    statusMessage: null,
  });
}

function middleRequestSequence(fixture: HistoryFixture): number {
  const turn = fixture.turns[Math.floor(fixture.turns.length / 2)];
  if (turn === undefined) throw new Error("Expected history turns");
  return turn.requestSequence;
}

function firstNeighborThreadId(fixture: HistoryFixture): string {
  const threadId = fixture.neighborThreadIds[0];
  if (threadId === undefined) throw new Error("Expected a neighbor thread");
  return threadId;
}

const ENVIRONMENT_CASES: readonly Case[] = [
  {
    name: `${ENVIRONMENT_LIFECYCLE}#updateEnvironmentMetadata`,
    run: (db, _fixture, seed) =>
      updateEnvironmentMetadata(db, noopNotifier, seed.readyEnvironmentId, {
        name: "Fix flaky deploy",
        mergeBaseBranch: "release",
      }),
  },
  {
    name: `${ENVIRONMENT_LIFECYCLE}#recordEnvironmentCurrentBranch`,
    run: (db, _fixture, seed) =>
      recordEnvironmentCurrentBranch(
        db,
        noopNotifier,
        seed.readyEnvironmentId,
        { branchName: "bb/fix-flaky-deploy" },
      ),
  },
  {
    name: `${ENVIRONMENT_LIFECYCLE}#recordProvisionedEnvironmentWorkspace`,
    prepare: (db, fixture, seed) => {
      preparedEnvironment = reserveFixtureEnvironment(db, fixture, seed);
    },
    run: (db) =>
      recordProvisionedEnvironmentWorkspace(
        db,
        noopNotifier,
        requirePreparedEnvironment().id,
        {
          path: "/Users/dev/.bb/checkouts/provisioned",
          isGitRepo: true,
          isWorktree: false,
          branchName: "main",
          defaultBranch: "main",
          baseBranch: "main",
        },
      ),
  },
  {
    name: `${ENVIRONMENT_LIFECYCLE}#applyEnvironmentLifecycleEvent`,
    run: (db, _fixture, seed) =>
      applyEnvironmentLifecycleEvent(db, noopNotifier, {
        environmentId: seed.readyEnvironmentId,
        event: { type: "destroy.recorded" },
      }),
  },
  {
    name: `${ENVIRONMENTS}#claimEnvironmentPath`,
    prepare: (db, fixture, seed) => {
      preparedEnvironment = reserveFixtureEnvironment(db, fixture, seed);
    },
    run: (db) =>
      claimEnvironmentPath(
        db,
        requirePreparedEnvironment(),
        "/Users/dev/.bb/checkouts/claimed",
      ),
  },
  {
    name: `${ENVIRONMENTS}#createEnvironment`,
    run: (db, fixture, seed) =>
      createEnvironment(db, noopNotifier, {
        projectId: fixture.projectId,
        hostId: seed.busyHostId,
        path: "/Users/dev/code/new-checkout",
        providerOwnsPath: false,
        status: "ready",
      }),
  },
  {
    name: `${ENVIRONMENT_LIFECYCLE}#getEnvironment`,
    run: (db, _fixture, seed) => getEnvironment(db, seed.readyEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#findProjectEnvironmentByHostPath`,
    run: (db, fixture, seed) =>
      findProjectEnvironmentByHostPath(
        db,
        fixture.projectId,
        seed.busyHostId,
        seed.readyEnvironmentPath,
      ),
  },
  {
    name: `${ENVIRONMENTS}#findProviderEnvironmentContainingPath`,
    run: (db) =>
      findProviderEnvironmentContainingPath(
        db,
        "/Users/dev/.bb/plugins/github-pr-status",
      ),
  },
  {
    name: `${ENVIRONMENTS}#findForeignManagedEnvironmentAtHostPath`,
    run: (db, fixture, seed) =>
      findForeignManagedEnvironmentAtHostPath(db, {
        hostId: seed.busyHostId,
        path: "/Users/dev/code/scratch",
        projectId: fixture.projectId,
      }),
  },
  {
    name: `${ENVIRONMENTS}#insertHeldEnvironment`,
    run: (db, fixture, seed) =>
      insertHeldEnvironment(db, {
        projectId: fixture.projectId,
        hostId: seed.busyHostId,
        heldBy: "user",
        attempt: 1,
        status: "creating",
        environmentProviderId: "git-worktree",
        environmentProviderPluginId: "environment-git-worktree",
        environmentProviderInstanceKey: (id) => `${id}-1`,
        providerOwnsPath: false,
        statusMessage: "Preparing Worktree…",
      }),
  },
  {
    name: `${ENVIRONMENTS}#adoptHeldEnvironment`,
    prepare: (db, fixture, seed) => {
      preparedEnvironment = reserveFixtureEnvironment(db, fixture, seed);
      preparedHeldEnvironment = insertPluginHeldEnvironment(db, fixture, seed);
    },
    run: (db) => {
      if (preparedHeldEnvironment === null)
        throw new Error("Expected a held environment");
      return adoptHeldEnvironment(
        db,
        requirePreparedEnvironment(),
        preparedHeldEnvironment.id,
        "plugin:environment-git-worktree",
        { ownedBranch: { name: "bb/adopted" } },
      );
    },
  },
  {
    name: `${ENVIRONMENTS}#releaseEnvironmentHolds`,
    prepare: (db, fixture, seed) => {
      insertPluginHeldEnvironment(db, fixture, seed);
    },
    run: (db) => releaseEnvironmentHolds(db, "plugin:environment-git-worktree"),
  },
  {
    name: `${ENVIRONMENTS}#findOtherLiveThreadAtEnvironmentPath`,
    run: (db, fixture, seed) =>
      findOtherLiveThreadAtEnvironmentPath(db, {
        hostId: seed.busyHostId,
        path: seed.readyEnvironmentPath,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${ENVIRONMENTS}#listEnvironments`,
    growsWith: {
      history:
        "Lists every environment on the busy host, and the seed grows its environments",
    },
    run: (db, _fixture, seed) =>
      listEnvironments(db, { hostId: seed.busyHostId }),
  },
  {
    name: `${ENVIRONMENTS}#markHostEnvironmentsDestroyed`,
    growsWith: {
      history:
        "Marks every environment on the host destroyed, and the seed grows its environments",
    },
    run: (db, _fixture, seed) =>
      markHostEnvironmentsDestroyed(db, noopNotifier, seed.machineHostId),
  },
  {
    name: `${ENVIRONMENTS}#listRetiredLoadedEnvironmentIdsOnHost`,
    growsWith: {
      history:
        "Looks up every loaded environment id the case passes, and the seed grows the host's loaded environments",
    },
    run: (db, _fixture, seed) =>
      listRetiredLoadedEnvironmentIdsOnHost(db, {
        hostId: seed.busyHostId,
        environmentIds: seed.loadedEnvironmentIds,
      }),
  },
  {
    name: `${ENVIRONMENT_LIFECYCLE}#applyEnvironmentLifecycleEventInTransaction`,
    run: (db, _fixture, seed) =>
      db.transaction((tx) =>
        applyEnvironmentLifecycleEventInTransaction(tx, {
          environmentId: seed.readyEnvironmentId,
          event: { type: "destroy.recorded" },
        }),
      ),
  },
  {
    name: `${ENVIRONMENTS}#getPreparingEnvironment`,
    run: (db, _fixture, seed) =>
      getPreparingEnvironment(db, seed.ownedEnvironmentThreadId),
  },
  {
    name: `${ENVIRONMENTS}#reserveEnvironment`,
    run: (db, fixture, seed) => reserveFixtureEnvironment(db, fixture, seed),
  },
  {
    name: `${ENVIRONMENTS}#updatePreparingEnvironment`,
    prepare: (db, _fixture, seed) => {
      preparedEnvironment = getPreparingEnvironment(
        db,
        seed.ownedEnvironmentThreadId,
      );
    },
    run: (db) =>
      updatePreparingEnvironment(db, {
        ...requirePreparedEnvironment(),
        statusMessage: "Restoring Git worktree…",
      }),
  },
  {
    name: `${ENVIRONMENTS}#listProviderLifecycleEnvironments`,
    growsWith: {
      history:
        "Returns every lifecycle environment of the provider, and the seed grows them",
    },
    run: (db) =>
      listProviderLifecycleEnvironments(db, "git-worktree", {
        pluginId: "environment-git-worktree",
        teardownMessage: HOSTS_ENVIRONMENTS_BLOCKED_TEARDOWN_MESSAGE,
      }),
  },
  {
    name: `${ENVIRONMENTS}#environmentHasLiveThreads`,
    run: (db, _fixture, seed) =>
      environmentHasLiveThreads(db, seed.sharedEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#releaseFinishedEnvironmentPreparationOwners`,
    run: (db) => releaseFinishedEnvironmentPreparationOwners(db),
  },
  {
    name: `${ENVIRONMENTS}#findEnvironmentPathClaim`,
    prepare: (db, fixture, seed) => {
      preparedEnvironment = reserveFixtureEnvironment(db, fixture, seed);
    },
    run: (db, _fixture, seed) =>
      findEnvironmentPathClaim(
        db,
        seed.busyHostId,
        seed.bindTargetPath,
        requirePreparedEnvironment(),
      ),
  },
  {
    name: `${ENVIRONMENTS}#bindEnvironmentPath`,
    prepare: (db, fixture, seed) => {
      preparedEnvironment = reserveFixtureEnvironment(db, fixture, seed);
    },
    run: (db, _fixture, seed) =>
      bindEnvironmentPath(
        db,
        requirePreparedEnvironment(),
        seed.bindTargetPath,
        seed.sharedEnvironmentId,
      ),
  },
  {
    name: `${ENVIRONMENTS}#setEnvironmentColumns`,
    run: (db, _fixture, seed) =>
      setEnvironmentColumns(db, seed.readyEnvironmentId, {
        retireAt: Date.now(),
        teardownStatus: "running",
      }),
  },
  {
    name: `${ENVIRONMENTS}#recordEnvironmentTeardownFailure`,
    run: (db, _fixture, seed) =>
      recordEnvironmentTeardownFailure(db, seed.readyEnvironmentId, {
        teardownMessage: "Workspace is still in use",
        retireAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      }),
  },
  {
    name: `${ENVIRONMENTS}#listProvisioningEnvironmentIdsOnHost`,
    run: (db, _fixture, seed) =>
      listProvisioningEnvironmentIdsOnHost(db, seed.busyHostId),
  },
  {
    name: `${ENVIRONMENTS}#listHostEnvironmentRemovalStates`,
    growsWith: {
      history:
        "Lists every environment on the host while it is forgotten, and the seed grows the busy host's environments",
    },
    run: (db, _fixture, seed) =>
      listHostEnvironmentRemovalStates(db, seed.busyHostId),
  },
  {
    name: `${ENVIRONMENTS}#listUndeletedEnvironmentThreads`,
    run: (db, _fixture, seed) =>
      listUndeletedEnvironmentThreads(db, seed.readyEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#listStoppingLiveEnvironmentThreads`,
    run: (db, _fixture, seed) =>
      listStoppingLiveEnvironmentThreads(db, seed.sharedEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#listEnvironmentThreads`,
    run: (db, _fixture, seed) =>
      listEnvironmentThreads(db, seed.readyEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#getStartingLiveEnvironmentThread`,
    run: (db, _fixture, seed) =>
      getStartingLiveEnvironmentThread(db, seed.sharedEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#listStartingLiveEnvironmentThreadIds`,
    run: (db, _fixture, seed) =>
      listStartingLiveEnvironmentThreadIds(db, seed.sharedEnvironmentId),
  },
  {
    name: `${ENVIRONMENTS}#environmentHasOtherStartingOrActiveThread`,
    run: (db, fixture, seed) =>
      environmentHasOtherStartingOrActiveThread(db, {
        environmentId: seed.sharedEnvironmentId,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${ENVIRONMENTS}#retryFailedEnvironmentTeardownsOnHost`,
    run: (db, _fixture, seed) =>
      retryFailedEnvironmentTeardownsOnHost(db, seed.machineHostId, Date.now()),
  },
  {
    name: `${ENVIRONMENTS}#getFailedTeardownEnvironmentOnHost`,
    run: (db, _fixture, seed) =>
      getFailedTeardownEnvironmentOnHost(db, seed.machineHostId),
  },
  {
    name: `${ENVIRONMENTS}#listReadyEnvironmentWatchTargets`,
    run: (db, _fixture, seed) =>
      listReadyEnvironmentWatchTargets(db, seed.loadedEnvironmentIds),
  },
  {
    name: `${ENVIRONMENTS}#listLiveThreadHosts`,
    run: (db, fixture, seed) =>
      listLiveThreadHosts(db, [
        fixture.threadId,
        ...fixture.neighborThreadIds,
        seed.ownedEnvironmentThreadId,
      ]),
  },
];

const ENVIRONMENT_HOOK_CASES: readonly Case[] = [
  {
    name: `${ENVIRONMENT_HOOKS}#getEnvironmentHookOperation`,
    run: (db, _fixture, seed) =>
      getEnvironmentHookOperation(db, seed.readyEnvironmentSetupOperationId),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#hasEnvironmentHookOperation`,
    run: (db, _fixture, seed) =>
      hasEnvironmentHookOperation(db, seed.readyEnvironmentSetupOperationId),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#insertEnvironmentHookOperation`,
    run: (db, _fixture, seed) =>
      insertEnvironmentHookOperation(db, {
        id: `environment:${seed.readyEnvironmentId}:query-cost:teardown`,
        hostId: seed.busyHostId,
        path: seed.readyEnvironmentPath,
        kind: "teardown",
        startedAt: Date.now(),
      }),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#restartEnvironmentHookOperation`,
    run: (db, _fixture, seed) =>
      restartEnvironmentHookOperation(
        db,
        seed.readyEnvironmentSetupOperationId,
        Date.now(),
      ),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#finishEnvironmentHookOperation`,
    run: (db, _fixture, seed) =>
      finishEnvironmentHookOperation(
        db,
        seed.readyEnvironmentSetupOperationId,
        {
          finishedAt: Date.now(),
          error: "Environment hook cancelled",
        },
      ),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#forgetFinishedEnvironmentHookOperations`,
    run: (db, _fixture, seed) =>
      forgetFinishedEnvironmentHookOperations(db, [
        seed.readyEnvironmentSetupOperationId,
      ]),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#acknowledgeInterruptedEnvironmentHookOperation`,
    run: (db, _fixture, seed) =>
      acknowledgeInterruptedEnvironmentHookOperation(db, {
        id: seed.readyEnvironmentSetupOperationId,
        hostId: seed.busyHostId,
        path: seed.readyEnvironmentPath,
        kind: "setup",
        finishedAt: Date.now(),
        error: "Interrupted hook acknowledged by explicit cleanup recovery",
      }),
  },
  {
    name: `${ENVIRONMENT_HOOKS}#listUnfinishedEnvironmentHookOperationIdsOnHost`,
    growsWith: {
      history:
        "No index covers environment_hook_operations.host_id, so it reads every hook operation, and the seed grows them with the environments",
    },
    run: (db, _fixture, seed) =>
      listUnfinishedEnvironmentHookOperationIdsOnHost(db, seed.machineHostId),
  },
];

const HOST_CASES: readonly Case[] = [
  {
    name: `${HOSTS}#upsertHost`,
    run: (db, _fixture, seed) =>
      upsertHost(db, noopNotifier, {
        id: seed.busyHostId,
        name: "query-costs",
        connectMachineId: "connect-machine-1",
      }),
  },
  {
    name: `${HOSTS}#markHostSeen`,
    run: (db, _fixture, seed) => markHostSeen(db, seed.busyHostId),
  },
  {
    name: `${HOSTS}#getHost`,
    run: (db, _fixture, seed) => getHost(db, seed.busyHostId),
  },
  {
    name: `${HOSTS}#getNonDestroyedHost`,
    run: (db, _fixture, seed) => getNonDestroyedHost(db, seed.busyHostId),
  },
  {
    name: `${HOSTS}#getNonDestroyedHostByLaunchKey`,
    run: (db, _fixture, seed) =>
      getNonDestroyedHostByLaunchKey(db, seed.machineLaunchKey),
  },
  {
    name: `${HOSTS}#listHosts`,
    run: (db) => listHosts(db),
  },
  {
    name: `${HOSTS}#listPublicHosts`,
    run: (db) => listPublicHosts(db),
  },
  {
    name: `${HOSTS}#listHostsByIds`,
    run: (db, _fixture, seed) => listHostsByIds(db, seed.allHostIds),
  },
  {
    name: `${HOSTS}#listNonDestroyedHostsByIds`,
    run: (db, _fixture, seed) =>
      listNonDestroyedHostsByIds(db, seed.connectedHostIds),
  },
  {
    name: `${HOSTS}#updateHost`,
    growsWith: {
      history:
        "Destroying the host notifies every environment on it, and the seed grows the host's environments",
    },
    run: (db, _fixture, seed) =>
      updateHost(db, noopNotifier, seed.busyHostId, {
        destroyedAt: Date.now(),
      }),
  },
  {
    name: `${HOSTS}#setHostColumns`,
    run: (db, _fixture, seed) =>
      setHostColumns(db, seed.machineHostId, {
        serverAccessProviderId: "direct",
        serverAccessGrantId: "grant-1",
        statusMessage: null,
      }),
  },
  {
    name: `${HOSTS}#getLatestHostAttemptForLaunchKey`,
    run: (db, _fixture, seed) =>
      getLatestHostAttemptForLaunchKey(db, seed.machineLaunchKey),
  },
  {
    name: `${HOSTS}#insertHost`,
    run: (db) =>
      insertHost(db, {
        id: "host_query_cost_insert",
        name: "Modal Sandbox abc123",
        type: "persistent",
        machineProviderId: "modal-sandbox",
        machineOperationId: "environment-modal-sandbox:op-1",
        launchKey: "launch-query-cost-insert",
        inputs: {},
        attempt: 1,
        phase: "creating",
        resource: null,
        statusMessage: "Creating Modal Sandbox…",
        pendingLog: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  },
];

const MACHINE_CASES: readonly Case[] = [
  {
    name: `${MACHINES}#machineHasLiveThreadLaunch`,
    run: (db, _fixture, seed) =>
      machineHasLiveThreadLaunch(db, seed.machineHostId),
  },
  {
    name: `${MACHINES}#machineHasStartingThreadLaunch`,
    run: (db, _fixture, seed) =>
      machineHasStartingThreadLaunch(db, seed.machineHostId),
  },
  {
    name: `${MACHINES}#listProviderMachines`,
    run: (db) => listProviderMachines(db, "modal-sandbox"),
  },
  {
    name: `${MACHINES}#machineHasLiveThreads`,
    run: (db, _fixture, seed) => machineHasLiveThreads(db, seed.machineHostId),
  },
  {
    name: `${MACHINES}#machineHasPendingThreads`,
    run: (db, _fixture, seed) =>
      machineHasPendingThreads(db, seed.machineHostId),
  },
  {
    name: `${MACHINES}#machineHasProvisioningEnvironment`,
    run: (db, _fixture, seed) =>
      machineHasProvisioningEnvironment(db, seed.machineHostId),
  },
  {
    name: `${MACHINES}#listRunningTurnThreadsOnHost`,
    run: (db, _fixture, seed) =>
      listRunningTurnThreadsOnHost(db, seed.machineHostId),
  },
  {
    name: `${MACHINES}#hostHasRunningTurnThread`,
    run: (db, _fixture, seed) =>
      hostHasRunningTurnThread(db, seed.machineHostId),
  },
];

const BACKFILL_CASES: readonly Case[] = [
  {
    name: `${BACKFILL}#ensureProjectAttachmentBackfill`,
    run: (db, fixture) =>
      ensureProjectAttachmentBackfill(db, fixture.projectId),
  },
  {
    name: `${BACKFILL}#nextProjectAttachmentBackfill`,
    run: (db) =>
      nextProjectAttachmentBackfill(db, { excludedProjectIds: new Set() }),
  },
  {
    name: `${BACKFILL}#updateAttachmentBackfill`,
    prepare: (db, fixture) => {
      preparedBackfill = ensureProjectAttachmentBackfill(db, fixture.projectId);
    },
    run: (db, fixture) => {
      if (preparedBackfill === null) {
        throw new Error("Expected a prepared backfill");
      }
      updateAttachmentBackfill(db, {
        ...preparedBackfill,
        phase: "events",
        threadCursor: fixture.threadId,
        inputCursor: middleRequestSequence(fixture),
        attemptedAt: Date.now(),
      });
    },
  },
  {
    name: `${BACKFILL}#readAttachmentBackfillInput`,
    run: (db, fixture) =>
      readAttachmentBackfillInput(db, {
        projectId: fixture.projectId,
        phase: "events",
        threadCursor: fixture.threadId,
        inputCursor: middleRequestSequence(fixture),
        inputId: "",
        inputSequence: 0,
        attemptedAt: Date.now(),
        error: null,
      }),
  },
];

const ATTACHMENT_CASES: readonly Case[] = [
  {
    name: `${ATTACHMENTS}#getProjectAttachment`,
    run: (db, fixture, seed) =>
      getProjectAttachment(
        db,
        fixture.projectId,
        seed.fixtureAttachmentPaths[0] ?? "",
      ),
  },
  {
    name: `${ATTACHMENTS}#recordProjectAttachment`,
    run: (db, fixture) => {
      const now = Date.now();
      return recordProjectAttachment(db, {
        projectId: fixture.projectId,
        storedPath: `.bb/attachments/${fixture.projectId}/new/screenshot.png`,
        originalName: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 240_000,
        createdAt: now,
        readyAt: now,
      });
    },
  },
  {
    name: `${ATTACHMENTS}#acquireProjectAttachmentOwnership`,
    run: (db, fixture, seed) =>
      acquireProjectAttachmentOwnership(
        db,
        firstNeighborThreadId(fixture),
        seed.unownedAttachmentPaths.slice(0, 5),
      ),
  },
  {
    name: `${ATTACHMENTS}#copyProjectAttachmentOwnership`,
    run: (db, fixture) =>
      copyProjectAttachmentOwnership(
        db,
        fixture.threadId,
        firstNeighborThreadId(fixture),
      ),
  },
  {
    name: `${ATTACHMENTS}#claimProjectAttachments`,
    run: (db, fixture) =>
      claimProjectAttachments(db, fixture.projectId, Date.now()),
  },
];

const DEFAULTS_CASES: readonly Case[] = [
  {
    name: `${DEFAULTS}#getProjectExecutionDefaults`,
    run: (db, fixture) =>
      getProjectExecutionDefaults(db, { projectId: fixture.projectId }),
  },
  {
    name: `${DEFAULTS}#listProjectExecutionDefaultsByProjectIds`,
    run: (db, _fixture, seed) =>
      listProjectExecutionDefaultsByProjectIds(db, {
        projectIds: seed.projectIds,
      }),
  },
  {
    name: `${DEFAULTS}#upsertProjectExecutionDefaults`,
    run: (db, fixture) =>
      upsertProjectExecutionDefaults(db, {
        projectId: fixture.projectId,
        providerId: "provider-b",
        model: "opus",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      }),
  },
];

const SOURCE_CASES: readonly Case[] = [
  {
    name: `${SOURCES}#createProjectSource`,
    run: (db, fixture, seed) =>
      createProjectSource(db, noopNotifier, {
        projectId: fixture.projectId,
        type: "local_path",
        hostId: seed.freeSourceHostId,
        path: "/home/dev/code/bb",
        isDefault: true,
      }),
  },
  {
    name: `${SOURCES}#listProjectSourcesByProjectIds`,
    run: (db, _fixture, seed) =>
      listProjectSourcesByProjectIds(db, seed.projectIds),
  },
  {
    name: `${SOURCES}#listProjectSourcesByHost`,
    run: (db, _fixture, seed) => listProjectSourcesByHost(db, seed.busyHostId),
  },
  {
    name: `${SOURCES}#getProjectSourceForProject`,
    run: (db, fixture, seed) =>
      getProjectSourceForProject(db, {
        projectId: fixture.projectId,
        sourceId: seed.busyDefaultSourceId,
      }),
  },
  {
    name: `${SOURCES}#countProjectSources`,
    run: (db, fixture) =>
      countProjectSources(db, { projectId: fixture.projectId }),
  },
  {
    name: `${SOURCES}#updateProjectSource`,
    run: (db, _fixture, seed) =>
      updateProjectSource(db, noopNotifier, seed.busyExtraSourceId, {
        isDefault: true,
      }),
  },
  {
    name: `${SOURCES}#getProjectSourceByHost`,
    run: (db, fixture, seed) =>
      getProjectSourceByHost(db, fixture.projectId, seed.busyHostId),
  },
  {
    name: `${SOURCES}#getProjectSourceOnPersistentHost`,
    run: (db, fixture) =>
      getProjectSourceOnPersistentHost(db, fixture.projectId),
  },
  {
    name: `${SOURCES}#deleteProjectSource`,
    run: (db, _fixture, seed) =>
      deleteProjectSource(db, noopNotifier, seed.busyDefaultSourceId),
  },
  {
    name: `${SOURCES}#projectSourceOwnsPath`,
    run: (db, fixture, seed) =>
      projectSourceOwnsPath(
        db,
        fixture.projectId,
        seed.busyHostId,
        seed.busySourcePath,
      ),
  },
];

const FOLDER_CASES: readonly Case[] = [
  {
    name: `${FOLDERS}#listProjectSourceFolders`,
    run: (db, _fixture, seed) =>
      listProjectSourceFolders(db, seed.busyDefaultSourceId),
  },
  {
    name: `${FOLDERS}#listProjectFolderPathsForHost`,
    run: (db, fixture, seed) =>
      listProjectFolderPathsForHost(db, {
        projectId: fixture.projectId,
        hostId: seed.busyHostId,
      }),
  },
  {
    name: `${FOLDERS}#createProjectSourceFolder`,
    run: (db, fixture, seed) =>
      createProjectSourceFolder(db, noopNotifier, {
        projectId: fixture.projectId,
        projectSourceId: seed.busyDefaultSourceId,
        path: "/Users/dev/code/new-folder",
      }),
  },
  {
    name: `${FOLDERS}#updateProjectSourceFolderPath`,
    run: (db, fixture, seed) =>
      updateProjectSourceFolderPath(db, noopNotifier, {
        projectId: fixture.projectId,
        projectSourceId: seed.busyDefaultSourceId,
        folderId: seed.busyFolderId,
        path: "/Users/dev/code/api-renamed",
      }),
  },
  {
    name: `${FOLDERS}#deleteProjectSourceFolder`,
    run: (db, fixture, seed) =>
      deleteProjectSourceFolder(db, noopNotifier, {
        projectId: fixture.projectId,
        projectSourceId: seed.busyDefaultSourceId,
        folderId: seed.busyFolderId,
      }),
  },
];

const PROJECT_CASES: readonly Case[] = [
  {
    name: `${PROJECTS}#getPublicProjectByLocalPathSource`,
    run: (db, _fixture, seed) =>
      getPublicProjectByLocalPathSource(db, {
        type: "local_path",
        hostId: seed.busyHostId,
        path: "/Users/dev/code/new-project",
      }),
  },
  {
    name: `${PROJECTS}#createProject`,
    run: (db, _fixture, seed) =>
      createProject(db, noopNotifier, {
        name: "new-project",
        source: {
          type: "local_path",
          hostId: seed.busyHostId,
          path: "/Users/dev/code/new-project",
        },
      }),
  },
  {
    name: `${PROJECTS}#findOrCreateProjectByLocalPathSource`,
    run: (db, _fixture, seed) =>
      findOrCreateProjectByLocalPathSource(db, noopNotifier, {
        name: "new-project",
        source: {
          type: "local_path",
          hostId: seed.busyHostId,
          path: "/Users/dev/code/new-project",
        },
      }),
  },
  {
    name: `${PROJECTS}#listPublicProjects`,
    run: (db) => listPublicProjects(db),
  },
  {
    name: `${PROJECTS}#getProject`,
    run: (db, fixture) => getProject(db, fixture.projectId),
  },
  {
    name: `${PROJECTS}#getPersonalProject`,
    run: (db) => getPersonalProject(db),
  },
  {
    name: `${PROJECTS}#ensurePersonalProject`,
    run: (db) => ensurePersonalProject(db),
  },
  {
    name: `${PROJECTS}#setProjectGitRemoteUrlIfMissing`,
    run: (db, _fixture, seed) =>
      setProjectGitRemoteUrlIfMissing(
        db,
        noopNotifier,
        seed.otherProjectId,
        "git@github.com:get-bb/bb.git",
      ),
  },
  {
    name: `${PROJECTS}#updateProject`,
    run: (db, fixture) =>
      updateProject(db, noopNotifier, fixture.projectId, { name: "bb" }),
  },
  {
    name: `${PROJECTS}#markProjectDeleted`,
    run: (db, _fixture, seed) =>
      markProjectDeleted(db, noopNotifier, { projectId: seed.otherProjectId }),
  },
  {
    name: `${PROJECTS}#reorderProject`,
    prepare: (db) => {
      const projects = listPublicProjects(db);
      const last = projects.at(-1);
      const first = projects[0];
      if (last === undefined || first === undefined || last.id === first.id) {
        throw new Error("Expected at least two public projects");
      }
      reorderTarget = { projectId: last.id, nextProjectId: first.id };
    },
    run: (db) => {
      if (reorderTarget === null) {
        throw new Error("Expected a project to reorder");
      }
      return reorderProject({
        db,
        notifier: noopNotifier,
        projectId: reorderTarget.projectId,
        previousProjectId: null,
        nextProjectId: reorderTarget.nextProjectId,
      });
    },
  },
  {
    name: `${PROJECTS}#deleteProject`,
    growsWith: {
      history:
        "Deleting the project cascades to its threads and environments, and the seed grows them",
    },
    run: (db, _fixture, seed) =>
      deleteProject(db, noopNotifier, seed.deletingProjectId),
  },
];

const SERVER_MOVE_CASES: readonly Case[] = [
  {
    name: `${SERVER_MOVE}#rerootServerOwnedPluginPaths`,
    run: (db) =>
      rerootServerOwnedPluginPaths(db, {
        fromRoot: "/Users/dev/.bb",
        toRoot: "/Volumes/next/.bb",
      }),
  },
  {
    name: `${SERVER_MOVE}#swapServerHostRoles`,
    run: (db, _fixture, seed) =>
      swapServerHostRoles(db, {
        sourceServerHostId: seed.busyHostId,
        targetHostId: seed.manualHostId,
        now: Date.now(),
      }),
  },
  {
    name: `${SERVER_MOVE}#listPathInstalledPluginSources`,
    run: (db) => listPathInstalledPluginSources(db),
  },
];

const SESSION_CASES: readonly Case[] = [
  {
    name: `${SESSIONS}#openSession`,
    run: (db, _fixture, seed) =>
      openSession(db, {
        hostId: seed.busyHostId,
        instanceId: "instance-reconnected",
        hostName: "query-costs",
        dataDir: "/Users/dev/.bb",
        protocolVersion: 60,
        heartbeatIntervalMs: 10_000,
        leaseTimeoutMs: 30_000,
      }),
  },
  {
    name: `${SESSIONS}#closeSession`,
    run: (db, _fixture, seed) =>
      closeSession(
        db,
        noopNotifier,
        seed.machineActiveSessionId,
        "daemon-disconnect",
      ),
  },
  {
    name: `${SESSIONS}#getLatestSessionForHost`,
    run: (db, _fixture, seed) =>
      getLatestSessionForHost(db, { hostId: seed.busyHostId }),
  },
  {
    name: `${SESSIONS}#listLatestClosedSessionsForHosts`,
    run: (db, _fixture, seed) =>
      listLatestClosedSessionsForHosts(db, {
        hostIds: seed.disconnectedActiveHostIds,
      }),
  },
  {
    name: `${SESSIONS}#getSessionById`,
    run: (db, _fixture, seed) =>
      getSessionById(db, { sessionId: seed.machineActiveSessionId }),
  },
  {
    name: `${SESSIONS}#heartbeatSession`,
    run: (db, _fixture, seed) =>
      heartbeatSession(db, seed.machineActiveSessionId, Date.now() + 30_000),
  },
  {
    name: `${SESSIONS}#listActiveSessionIdsForHost`,
    run: (db, _fixture, seed) =>
      listActiveSessionIdsForHost(db, seed.machineHostId),
  },
  {
    name: `${SESSIONS}#recordSessionRoute`,
    run: (db, _fixture, seed) =>
      recordSessionRoute(db, {
        sessionId: seed.machineActiveSessionId,
        route: { providerId: "connect", kind: "relay" },
      }),
  },
];

const GRANT_CASES: readonly Case[] = [
  {
    name: `${GRANTS}#upsertHostServerAccessGrant`,
    run: (db, _fixture, seed) =>
      upsertHostServerAccessGrant(db, {
        hostId: seed.machineHostId,
        providerId: "connect",
        grantId: "grant-query-cost",
      }),
  },
  {
    name: `${GRANTS}#getHostServerAccessGrant`,
    run: (db, _fixture, seed) =>
      getHostServerAccessGrant(db, {
        hostId: seed.machineHostId,
        providerId: "connect",
      }),
  },
  {
    name: `${GRANTS}#listHostServerAccessGrants`,
    run: (db, _fixture, seed) =>
      listHostServerAccessGrants(db, seed.machineHostId),
  },
  {
    name: `${GRANTS}#deleteHostServerAccessGrant`,
    run: (db, _fixture, seed) =>
      deleteHostServerAccessGrant(db, {
        hostId: seed.machineHostId,
        providerId: "retired-provider",
      }),
  },
];

const TERMINAL_CASES: readonly Case[] = [
  {
    name: `${TERMINALS}#createTerminalSession`,
    run: (db, _fixture, seed) =>
      createTerminalSession(db, {
        cols: 120,
        rows: 40,
        daemonSessionId: seed.machineActiveSessionId,
        environmentId: null,
        hostId: seed.machineHostId,
        initialCwd: seed.hostPathCwd,
        status: "starting",
        threadId: null,
        title: "zsh",
      }),
  },
  {
    name: `${TERMINALS}#listTerminalSessions`,
    run: (db) =>
      listTerminalSessions(db, { scope: { kind: "all" }, visible: true }),
  },
  {
    name: `${TERMINALS}#countTerminalSessions`,
    run: (db, _fixture, seed) =>
      countTerminalSessions(db, {
        scope: {
          kind: "host-path",
          hostId: seed.busyHostId,
          cwd: seed.hostPathCwd,
        },
        visible: true,
      }),
  },
  {
    name: `${TERMINALS}#getTerminalSession`,
    run: (db, _fixture, seed) =>
      getTerminalSession(db, {
        kind: "terminal",
        terminalId: seed.exitedTerminalId,
      }),
  },
  {
    name: `${TERMINALS}#updateTerminalSession`,
    run: (db, _fixture, seed) =>
      updateTerminalSession(db, {
        scope: { kind: "terminal", terminalId: seed.exitedTerminalId },
        update: { kind: "title", title: "pnpm test" },
      }),
  },
  {
    name: `${TERMINALS}#updateTerminalSessions`,
    growsWith: {
      history:
        "Exits every disconnected terminal session on the host, and the seed grows the sessions",
    },
    run: (db, _fixture, seed) =>
      updateTerminalSessions(db, {
        scope: {
          kind: "host",
          hostId: seed.busyHostId,
          statuses: ["disconnected"],
        },
        update: { kind: "exit", closeReason: "daemon-disconnect" },
      }),
  },
  {
    name: `${TERMINALS}#pruneExitedTerminalSessions`,
    run: (db) =>
      pruneExitedTerminalSessions(db, {
        exitedBefore: Date.now() - EXITED_TERMINAL_RETENTION_MS,
        limit: TERMINAL_PRUNE_BATCH,
      }),
  },
  {
    name: `${TERMINALS}#listOpenTerminalSessionIdsOnHost`,
    run: (db, _fixture, seed) =>
      listOpenTerminalSessionIdsOnHost(db, seed.machineHostId),
  },
];

export const HOSTS_ENVIRONMENTS_COST_GROUP = registerCostGroup({
  name: "hosts-environments",
  seed: seedHostsEnvironments,
  cases: [
    ...ENVIRONMENT_CASES,
    ...ENVIRONMENT_HOOK_CASES,
    ...HOST_CASES,
    ...MACHINE_CASES,
    ...BACKFILL_CASES,
    ...ATTACHMENT_CASES,
    ...DEFAULTS_CASES,
    ...SOURCE_CASES,
    ...FOLDER_CASES,
    ...PROJECT_CASES,
    ...SERVER_MOVE_CASES,
    ...SESSION_CASES,
    ...GRANT_CASES,
    ...TERMINAL_CASES,
  ],
});
