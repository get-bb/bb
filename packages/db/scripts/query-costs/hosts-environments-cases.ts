import {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  bindEnvironmentPath,
  claimEnvironmentPath,
  createEnvironment,
  environmentHasLiveThreads,
  findEnvironmentPathClaim,
  findForeignManagedEnvironmentAtHostPath,
  findProjectEnvironmentByHostPath,
  findProviderEnvironmentContainingPath,
  getEnvironment,
  getPreparingEnvironment,
  listEnvironments,
  listProviderLifecycleEnvironments,
  listRetiredLoadedEnvironmentIdsOnHost,
  markHostEnvironmentsDestroyed,
  recordEnvironmentCurrentBranch,
  recordProvisionedEnvironmentWorkspace,
  releaseFinishedEnvironmentPreparationOwners,
  reserveEnvironment,
  updateEnvironmentMetadata,
  updatePreparingEnvironment,
  type EnvironmentRow,
} from "../../src/data/environments.js";
import {
  getHost,
  getNonDestroyedHost,
  getNonDestroyedHostByLaunchKey,
  listHosts,
  listHostsByIds,
  listNonDestroyedHostsByIds,
  listPublicHosts,
  markHostSeen,
  updateHost,
  upsertHost,
} from "../../src/data/hosts.js";
import {
  listProviderMachines,
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
  listLatestClosedSessionsForHosts,
  openSession,
} from "../../src/data/sessions.js";
import {
  countTerminalSessions,
  createTerminalSession,
  getTerminalSession,
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
const HOSTS = "packages/db/src/data/hosts.ts";
const MACHINES = "packages/db/src/data/machines.ts";
const BACKFILL = "packages/db/src/data/project-attachment-backfill.ts";
const ATTACHMENTS = "packages/db/src/data/project-attachments.ts";
const DEFAULTS = "packages/db/src/data/project-execution-defaults.ts";
const SOURCES = "packages/db/src/data/project-sources.ts";
const PROJECTS = "packages/db/src/data/projects.ts";
const SERVER_MOVE = "packages/db/src/data/server-move.ts";
const SESSIONS = "packages/db/src/data/sessions.ts";
const TERMINALS = "packages/db/src/data/terminal-sessions.ts";
const EXITED_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const TERMINAL_PRUNE_BATCH = 1_000;

type Case = QueryCostCase<HostsEnvironmentsSeed>;

let preparedEnvironment: EnvironmentRow | null = null;
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
    environmentProviderInstanceKey: `${fixture.threadId}-1`,
    providerOwnsPath: false,
    statusMessage: "Preparing project checkout…",
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
    name: `${ENVIRONMENTS}#updateEnvironmentMetadata`,
    run: (db, _fixture, seed) =>
      updateEnvironmentMetadata(db, noopNotifier, seed.readyEnvironmentId, {
        name: "Fix flaky deploy",
        mergeBaseBranch: "release",
      }),
  },
  {
    name: `${ENVIRONMENTS}#recordEnvironmentCurrentBranch`,
    run: (db, _fixture, seed) =>
      recordEnvironmentCurrentBranch(
        db,
        noopNotifier,
        seed.readyEnvironmentId,
        { branchName: "bb/fix-flaky-deploy" },
      ),
  },
  {
    name: `${ENVIRONMENTS}#recordProvisionedEnvironmentWorkspace`,
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
    name: `${ENVIRONMENTS}#applyEnvironmentLifecycleEvent`,
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
    name: `${ENVIRONMENTS}#getEnvironment`,
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
    name: `${ENVIRONMENTS}#listEnvironments`,
    run: (db, _fixture, seed) =>
      listEnvironments(db, { hostId: seed.busyHostId }),
  },
  {
    name: `${ENVIRONMENTS}#markHostEnvironmentsDestroyed`,
    run: (db, _fixture, seed) =>
      markHostEnvironmentsDestroyed(db, noopNotifier, seed.machineHostId),
  },
  {
    name: `${ENVIRONMENTS}#listRetiredLoadedEnvironmentIdsOnHost`,
    run: (db, _fixture, seed) =>
      listRetiredLoadedEnvironmentIdsOnHost(db, {
        hostId: seed.busyHostId,
        environmentIds: seed.loadedEnvironmentIds,
      }),
  },
  {
    name: `${ENVIRONMENTS}#applyEnvironmentLifecycleEventInTransaction`,
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
      ),
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
    run: (db, _fixture, seed) =>
      updateHost(db, noopNotifier, seed.busyHostId, {
        destroyedAt: Date.now(),
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
        providerId: "claude-code",
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
];

export const HOSTS_ENVIRONMENTS_COST_GROUP = registerCostGroup({
  name: "hosts-environments",
  seed: seedHostsEnvironments,
  cases: [
    ...ENVIRONMENT_CASES,
    ...HOST_CASES,
    ...MACHINE_CASES,
    ...BACKFILL_CASES,
    ...ATTACHMENT_CASES,
    ...DEFAULTS_CASES,
    ...SOURCE_CASES,
    ...PROJECT_CASES,
    ...SERVER_MOVE_CASES,
    ...SESSION_CASES,
    ...TERMINAL_CASES,
  ],
});
