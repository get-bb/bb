import type { DbConnection } from "../../src/connection.js";
import {
  createEnvironment,
  reserveEnvironment,
  updatePreparingEnvironment,
  type EnvironmentRow,
} from "../../src/data/environments.js";
import { updateHost, upsertHost } from "../../src/data/hosts.js";
import {
  ensureProjectAttachmentBackfill,
  updateAttachmentBackfill,
} from "../../src/data/project-attachment-backfill.js";
import {
  acquireProjectAttachmentOwnership,
  recordProjectAttachment,
} from "../../src/data/project-attachments.js";
import { upsertProjectExecutionDefaults } from "../../src/data/project-execution-defaults.js";
import {
  createProjectSource,
  getProjectSourceByHost,
} from "../../src/data/project-sources.js";
import {
  createProject,
  ensurePersonalProject,
  markProjectDeleted,
} from "../../src/data/projects.js";
import { closeSession, openSession } from "../../src/data/sessions.js";
import {
  createTerminalSession,
  updateTerminalSession,
} from "../../src/data/terminal-sessions.js";
import {
  archiveThread,
  createThread,
  markThreadDeleted,
  updateThread,
} from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { scaled } from "./case.js";

const DAY_MS = 24 * 60 * 60_000;
const PROVIDER_ID = "provider-a";
const WORKTREE_PROVIDER = "git-worktree";
const WORKTREE_PLUGIN = "environment-git-worktree";
const CHECKOUT_PROVIDER = "project-checkout";
const CHECKOUT_PLUGIN = "environment-project-checkout";
const PERSONAL_PROVIDER = "personal-workspace";
const PERSONAL_PLUGIN = "environment-personal-workspace";
const MACHINE_PROVIDER = "modal-sandbox";
export const HOSTS_ENVIRONMENTS_BLOCKED_TEARDOWN_MESSAGE =
  "The environment provider belongs to a different plugin or has no recorded owner. Automatic removal is blocked.";

export interface HostsEnvironmentsSeed {
  busyHostId: string;
  machineHostId: string;
  manualHostId: string;
  allHostIds: string[];
  connectedHostIds: string[];
  disconnectedActiveHostIds: string[];
  machineLaunchKey: string;
  machineActiveSessionId: string;
  projectIds: string[];
  otherProjectId: string;
  deletingProjectId: string;
  freeSourceHostId: string;
  busyDefaultSourceId: string;
  busyExtraSourceId: string;
  busySourcePath: string;
  readyEnvironmentId: string;
  readyEnvironmentPath: string;
  bindTargetPath: string;
  sharedEnvironmentId: string;
  ownedEnvironmentThreadId: string;
  loadedEnvironmentIds: string[];
  fixtureAttachmentPaths: string[];
  unownedAttachmentPaths: string[];
  exitedTerminalId: string;
  hostPathCwd: string;
}

interface SeedHost {
  id: string;
  live: boolean;
  idle: boolean;
}

interface EnvironmentPlan {
  projectId: string;
  hostId: string;
  path: string | null;
  status: EnvironmentRow["status"];
  providerId: string | null;
  pluginId: string | null;
  providerOwnsPath: boolean;
  retireAt: number | null;
  teardownStatus: EnvironmentRow["teardownStatus"];
  teardownMessage: string | null;
  createdAt: number;
  thread: "none" | "archived" | "live" | "deleted";
  owned: boolean;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new Error("Expected a non-empty list");
  return item;
}

function seedHosts(db: DbConnection, fixture: HistoryFixture, scale: number) {
  const now = Date.now();
  const make = (name: string): string =>
    upsertHost(db, noopNotifier, { name }).id;
  const machineHostId = make("modal-persistent-1");
  const machineLaunchKey = "launch-modal-persistent-1";
  updateHost(db, noopNotifier, machineHostId, {
    machineProviderId: MACHINE_PROVIDER,
    launchKey: machineLaunchKey,
    resource: { sandboxId: "sb-persistent-1" },
  });
  const manualHostIds: string[] = [];
  for (let index = 0; index < scaled(2, scale); index += 1) {
    const id = make(`manual-${index}`);
    updateHost(db, noopNotifier, id, { machineProviderId: "manual" });
    manualHostIds.push(id);
  }
  const remoteHostIds: string[] = [];
  for (let index = 0; index < scaled(5, scale); index += 1) {
    remoteHostIds.push(make(`remote-${index}`));
  }
  const suspendedHostIds: string[] = [];
  for (let index = 0; index < scaled(5, scale); index += 1) {
    const id = make(`modal-suspended-${index}`);
    updateHost(db, noopNotifier, id, {
      type: "ephemeral",
      machineProviderId: MACHINE_PROVIDER,
      launchKey: `launch-suspended-${index}`,
      phase: "suspended",
      suspendedAt: now - index * DAY_MS,
    });
    suspendedHostIds.push(id);
  }
  const destroyedHostIds: string[] = [];
  for (let index = 0; index < scaled(26, scale); index += 1) {
    const id = make(`modal-ephemeral-${index}`);
    updateHost(db, noopNotifier, id, {
      type: "ephemeral",
      machineProviderId: MACHINE_PROVIDER,
      launchKey: `launch-ephemeral-${index}`,
      phase: "destroyed",
      teardownStatus: "removed",
      destroyedAt: now - index * DAY_MS,
    });
    destroyedHostIds.push(id);
  }
  for (let index = 0; index < scaled(10, scale); index += 1) {
    const id = make(`retired-${index}`);
    updateHost(db, noopNotifier, id, {
      machineProviderId: index % 2 === 0 ? "manual" : MACHINE_PROVIDER,
      phase: "destroyed",
      destroyedAt: now - (index + 30) * DAY_MS,
    });
    destroyedHostIds.push(id);
  }
  const busyHostId = fixture.hostId;
  const manualHostId = pick(manualHostIds, 0);
  const otherHosts: SeedHost[] = [
    ...manualHostIds.map((id) => ({ id, live: true, idle: false })),
    ...remoteHostIds.map((id) => ({ id, live: true, idle: false })),
    ...suspendedHostIds.map((id) => ({ id, live: true, idle: false })),
    ...destroyedHostIds.map((id) => ({ id, live: false, idle: true })),
  ];
  return {
    busyHostId,
    machineHostId,
    machineLaunchKey,
    manualHostId,
    manualHostIds,
    remoteHostIds,
    suspendedHostIds,
    destroyedHostIds,
    otherHosts,
    allHostIds: [busyHostId, machineHostId, ...otherHosts.map((h) => h.id)],
  };
}

type SeededHosts = ReturnType<typeof seedHosts>;

function seedProjects(
  db: DbConnection,
  fixture: HistoryFixture,
  hosts: SeededHosts,
  scale: number,
) {
  const personalProjectId = ensurePersonalProject(db).id;
  const projectIds = [fixture.projectId];
  for (let index = 1; index < scaled(10, scale) - 1; index += 1) {
    projectIds.push(
      createProject(db, noopNotifier, {
        name: `project-${index}`,
        source: {
          type: "local_path",
          hostId: hosts.busyHostId,
          path: `/Users/dev/code/project-${index}`,
        },
      }).project.id,
    );
  }
  const sourceHosts = [
    hosts.machineHostId,
    ...hosts.manualHostIds,
    ...hosts.remoteHostIds.slice(0, -1),
  ];
  let busyExtraSourceId = "";
  projectIds.forEach((projectId, projectIndex) => {
    sourceHosts.forEach((hostId, hostIndex) => {
      if (projectIndex !== 0 && hostIndex > 2) return;
      const source = createProjectSource(db, noopNotifier, {
        projectId,
        type: "local_path",
        hostId,
        path: `/home/dev/code/project-${projectIndex}`,
        ownsPath: hostId === hosts.machineHostId,
      });
      if (projectIndex === 0 && hostIndex === 0) busyExtraSourceId = source.id;
    });
  });
  const deletingProjectId = createProject(db, noopNotifier, {
    name: "deleting",
    source: {
      type: "local_path",
      hostId: hosts.busyHostId,
      path: "/Users/dev/code/deleting",
    },
  }).project.id;
  return {
    projectIds,
    personalProjectId,
    deletingProjectId,
    busyExtraSourceId,
    freeSourceHostId: hosts.remoteHostIds.at(-1) ?? hosts.busyHostId,
  };
}

function withClock<T>(at: number, run: () => T): T {
  const realNow = Date.now;
  Date.now = () => at;
  try {
    return run();
  } finally {
    Date.now = realNow;
  }
}

function seedSessions(db: DbConnection, hosts: SeededHosts, scale: number) {
  const now = Date.now();
  const span = 180 * DAY_MS;
  const total = scaled(1_000, scale);
  const recentHosts = [
    ...hosts.manualHostIds,
    ...hosts.remoteHostIds.slice(0, 2),
  ];
  const staleHosts = [
    ...hosts.remoteHostIds.slice(2),
    ...hosts.suspendedHostIds,
  ];
  const assignments = Array.from({ length: total }, (_, index) => {
    const progress = index / total;
    const bucket = index % 20;
    if (bucket < 11) return hosts.busyHostId;
    if (bucket < 14) return hosts.machineHostId;
    if (bucket < 16) return pick(recentHosts, index);
    if (bucket < 18 && progress < 0.7) return pick(staleHosts, index);
    if (progress < 0.4) return pick(hosts.destroyedHostIds, index);
    return hosts.busyHostId;
  });
  const lastIndexByHost = new Map<string, number>();
  assignments.forEach((hostId, index) => lastIndexByHost.set(hostId, index));
  const connected = new Set([hosts.machineHostId, ...recentHosts]);
  const latestByHost = new Map<string, string>();
  assignments.forEach((hostId, index) => {
    const openedAt = now - span + Math.floor((index / total) * span);
    const session = withClock(openedAt, () =>
      openSession(db, {
        hostId,
        instanceId: `instance-${hostId}-${Math.floor(index / 40)}`,
        hostName: hostId,
        dataDir: "/Users/dev/.bb",
        protocolVersion: 60,
        heartbeatIntervalMs: 10_000,
        leaseTimeoutMs: 30_000,
      }),
    );
    latestByHost.set(hostId, session.id);
    if (lastIndexByHost.get(hostId) === index && !connected.has(hostId)) {
      withClock(openedAt + 60 * 60_000, () =>
        closeSession(db, noopNotifier, session.id, "daemon-disconnect"),
      );
    }
  });
  const machineActiveSessionId = latestByHost.get(hosts.machineHostId);
  const busyLatestSessionId = latestByHost.get(hosts.busyHostId);
  if (
    machineActiveSessionId === undefined ||
    busyLatestSessionId === undefined
  ) {
    throw new Error("Expected daemon sessions for the busy and machine hosts");
  }
  return {
    machineActiveSessionId,
    busyLatestSessionId,
    connectedHostIds: [...connected],
  };
}

function planEnvironment(
  index: number,
  roll: number,
  projectId: string,
  host: SeedHost,
  createdAt: number,
  deleting: boolean,
): EnvironmentPlan {
  const worktreePath = `/Users/dev/.bb/worktrees/${projectId}/env-${index}`;
  const base: EnvironmentPlan = {
    projectId,
    hostId: host.id,
    path: null,
    status: "destroyed",
    providerId: WORKTREE_PROVIDER,
    pluginId: WORKTREE_PLUGIN,
    providerOwnsPath: true,
    retireAt: null,
    teardownStatus: "removed",
    teardownMessage: null,
    createdAt,
    thread: deleting ? "none" : index % 2 === 0 ? "archived" : "none",
    owned: false,
  };
  if (!host.live) {
    return roll < 0.9
      ? base
      : {
          ...base,
          providerId: PERSONAL_PROVIDER,
          pluginId: PERSONAL_PLUGIN,
          providerOwnsPath: false,
          thread: "none",
        };
  }
  if (roll < 0.7) return base;
  const threadKind = deleting ? "none" : "archived";
  if (roll < 0.73) {
    return {
      ...base,
      thread: deleting ? "none" : index % 4 === 0 ? "deleted" : "archived",
      owned: !deleting,
    };
  }
  if (roll < 0.79) {
    return {
      ...base,
      path: worktreePath,
      status: "ready",
      teardownStatus: null,
      thread: deleting ? "none" : host.idle ? "archived" : "live",
      owned: !deleting && index % 3 === 0,
    };
  }
  if (roll < 0.82) {
    return {
      ...base,
      path: worktreePath,
      status: "ready",
      teardownStatus: null,
      retireAt: createdAt + 3 * DAY_MS,
      thread: threadKind,
    };
  }
  if (roll < 0.84) {
    return {
      ...base,
      path: worktreePath,
      status: "ready",
      teardownStatus: "running",
      retireAt: createdAt + DAY_MS,
      thread: threadKind,
    };
  }
  if (roll < 0.86) {
    return {
      ...base,
      path: worktreePath,
      status: "error",
      teardownStatus: "failed",
      teardownMessage: "git worktree remove failed: directory not empty",
      thread: threadKind,
    };
  }
  if (roll < 0.87) {
    return {
      ...base,
      path: worktreePath,
      status: "error",
      teardownStatus: "failed",
      teardownMessage: HOSTS_ENVIRONMENTS_BLOCKED_TEARDOWN_MESSAGE,
      pluginId: "environment-legacy-worktree",
      thread: "none",
    };
  }
  if (roll < 0.92) {
    return {
      ...base,
      path: `/Users/dev/code/checkouts/${projectId}/${index}`,
      status: "ready",
      providerId: null,
      pluginId: null,
      providerOwnsPath: false,
      teardownStatus: null,
      thread: "none",
    };
  }
  if (roll < 0.96) {
    const ready = roll < 0.94;
    return {
      ...base,
      path: ready ? `/Users/dev/.bb/checkouts/${projectId}/${index}` : null,
      status: ready ? "ready" : "destroyed",
      providerId: CHECKOUT_PROVIDER,
      pluginId: CHECKOUT_PLUGIN,
      providerOwnsPath: false,
      teardownStatus: ready ? null : "removed",
      thread: "none",
    };
  }
  return {
    ...base,
    providerId: PERSONAL_PROVIDER,
    pluginId: PERSONAL_PLUGIN,
    providerOwnsPath: false,
    thread: "none",
  };
}

function finishThread(
  db: DbConnection,
  threadId: string,
  kind: EnvironmentPlan["thread"],
): void {
  if (kind === "archived" || kind === "deleted") {
    archiveThread(db, noopNotifier, threadId);
  }
  if (kind === "deleted") {
    markThreadDeleted(db, noopNotifier, { threadId });
  }
}

function insertEnvironment(
  db: DbConnection,
  plan: EnvironmentPlan,
): { environment: EnvironmentRow; threadId: string | null } {
  const fields = {
    projectId: plan.projectId,
    hostId: plan.hostId,
    path: plan.path,
    status: plan.status,
    environmentProviderId: plan.providerId,
    environmentProviderPluginId: plan.pluginId,
    providerOwnsPath: plan.providerOwnsPath,
    retireAt: plan.retireAt,
    teardownStatus: plan.teardownStatus,
    teardownMessage: plan.teardownMessage,
    isGitRepo: true,
    isWorktree: plan.providerId === WORKTREE_PROVIDER,
    branchName: plan.path === null ? null : "bb/feature",
    defaultBranch: "main",
  };
  if (plan.owned) {
    const thread = createThread(db, noopNotifier, {
      projectId: plan.projectId,
      providerId: PROVIDER_ID,
      status: "idle",
    });
    const environment = reserveEnvironment(db, {
      ...fields,
      ownerThreadId: thread.id,
      attempt: 1,
      environmentProviderInstanceKey: `${thread.id}-1`,
    });
    updateThread(db, noopNotifier, thread.id, {
      environmentId: environment.id,
    });
    finishThread(db, thread.id, plan.thread);
    return { environment, threadId: thread.id };
  }
  const created = createEnvironment(db, noopNotifier, {
    projectId: plan.projectId,
    hostId: plan.hostId,
    path: plan.path,
    providerOwnsPath: plan.providerOwnsPath,
    status: plan.status,
  });
  const environment = {
    ...created,
    ...fields,
    environmentProviderInstanceKey:
      plan.providerId === null ? null : created.id,
    createdAt: plan.createdAt,
  };
  updatePreparingEnvironment(db, environment);
  if (plan.thread === "none") return { environment, threadId: null };
  const thread = createThread(db, noopNotifier, {
    projectId: plan.projectId,
    environmentId: environment.id,
    providerId: PROVIDER_ID,
    status: "idle",
  });
  finishThread(db, thread.id, plan.thread);
  return { environment, threadId: thread.id };
}

function seedEnvironments(
  db: DbConnection,
  fixture: HistoryFixture,
  hosts: SeededHosts,
  projects: ReturnType<typeof seedProjects>,
  scale: number,
) {
  const now = Date.now();
  const roll = random(17);
  const total = scaled(4_000, scale);
  const threadIdsByProject = new Map<string, string[]>();
  const loadedEnvironmentIds: string[] = [];
  let ownedEnvironmentThreadId: string | null = null;
  let readyEnvironment: EnvironmentRow | null = null;
  const otherProjects = projects.projectIds.slice(1);
  for (let index = 0; index < total; index += 1) {
    const projectBucket = roll();
    const deleting = projectBucket >= 0.95;
    const projectId = deleting
      ? projects.deletingProjectId
      : projectBucket < 0.5
        ? fixture.projectId
        : pick(otherProjects, index);
    const hostBucket = roll();
    const host: SeedHost =
      hostBucket < 0.65
        ? { id: hosts.busyHostId, live: true, idle: false }
        : hostBucket < 0.8
          ? { id: hosts.machineHostId, live: true, idle: true }
          : pick(hosts.otherHosts, index);
    const createdAt =
      now - Math.floor(((total - index) / total) * 180 * DAY_MS);
    const plan = planEnvironment(
      index,
      roll(),
      projectId,
      host,
      createdAt,
      deleting,
    );
    const { environment, threadId } = insertEnvironment(db, plan);
    if (threadId !== null) {
      const list = threadIdsByProject.get(projectId) ?? [];
      list.push(threadId);
      threadIdsByProject.set(projectId, list);
    }
    if (host.id === hosts.busyHostId && loadedEnvironmentIds.length < 100) {
      if (environment.status !== "destroyed" || index % 5 === 0) {
        loadedEnvironmentIds.push(environment.id);
      }
    }
    if (
      plan.owned &&
      ownedEnvironmentThreadId === null &&
      plan.thread === "live"
    ) {
      ownedEnvironmentThreadId = threadId;
    }
    if (
      readyEnvironment === null &&
      environment.status === "ready" &&
      environment.teardownStatus === null &&
      host.id === hosts.busyHostId &&
      projectId === fixture.projectId &&
      plan.providerId === WORKTREE_PROVIDER
    ) {
      readyEnvironment = environment;
    }
  }
  const bindTargetPath = "/Users/dev/code/bb-main";
  const shared = createEnvironment(db, noopNotifier, {
    projectId: fixture.projectId,
    hostId: hosts.busyHostId,
    path: bindTargetPath,
    providerOwnsPath: false,
    status: "ready",
    isGitRepo: true,
    branchName: "main",
    defaultBranch: "main",
  });
  for (let index = 0; index < scaled(200, scale); index += 1) {
    const thread = createThread(db, noopNotifier, {
      projectId: fixture.projectId,
      environmentId: shared.id,
      providerId: PROVIDER_ID,
      status: "idle",
    });
    archiveThread(db, noopNotifier, thread.id);
    const list = threadIdsByProject.get(fixture.projectId) ?? [];
    list.push(thread.id);
    threadIdsByProject.set(fixture.projectId, list);
  }
  for (let index = 0; index < 5; index += 1) {
    const thread = createThread(db, noopNotifier, {
      projectId: fixture.projectId,
      providerId: PROVIDER_ID,
      status: "starting",
    });
    reserveEnvironment(db, {
      projectId: fixture.projectId,
      hostId: hosts.busyHostId,
      ownerThreadId: thread.id,
      attempt: 1,
      status: "creating",
      environmentProviderId: WORKTREE_PROVIDER,
      environmentProviderPluginId: WORKTREE_PLUGIN,
      environmentProviderInstanceKey: `${thread.id}-1`,
      providerOwnsPath: true,
      statusMessage: "Preparing Git worktree…",
    });
  }
  if (ownedEnvironmentThreadId === null || readyEnvironment === null) {
    throw new Error("Expected an owned and a ready environment");
  }
  const readyEnvironmentPath = readyEnvironment.path;
  if (readyEnvironmentPath === null) {
    throw new Error("Expected the ready environment to have a path");
  }
  return {
    threadIdsByProject,
    loadedEnvironmentIds,
    ownedEnvironmentThreadId,
    readyEnvironmentId: readyEnvironment.id,
    readyEnvironmentPath,
    bindTargetPath,
    sharedEnvironmentId: shared.id,
  };
}

function seedAttachments(
  db: DbConnection,
  fixture: HistoryFixture,
  projectIds: readonly string[],
  deletingProjectId: string,
  threadIdsByProject: ReadonlyMap<string, string[]>,
  scale: number,
) {
  const now = Date.now();
  const total = scaled(1_500, scale);
  const fixtureLinks = scaled(150, scale);
  const otherProjects = projectIds.slice(1);
  const pathsByThread = new Map<string, string[]>();
  const fixtureAttachmentPaths: string[] = [];
  const unownedAttachmentPaths: string[] = [];
  let fixtureCount = 0;
  for (let index = 0; index < total; index += 1) {
    const bucket = index % 20;
    const projectId =
      bucket < 12
        ? fixture.projectId
        : bucket === 19
          ? deletingProjectId
          : pick(otherProjects, index);
    const createdAt = now - Math.floor(((total - index) / total) * 90 * DAY_MS);
    const storedPath = `.bb/attachments/${projectId}/${index}/screenshot-${index}.png`;
    recordProjectAttachment(db, {
      projectId,
      storedPath,
      originalName: `screenshot-${index}.png`,
      mimeType: "image/png",
      sizeBytes: 120_000 + index,
      createdAt,
      readyAt: createdAt + 1_000,
    });
    const threads = threadIdsByProject.get(projectId) ?? [];
    if (index % 7 === 3 || threads.length === 0) {
      if (projectId === fixture.projectId) {
        unownedAttachmentPaths.push(storedPath);
      }
      continue;
    }
    let threadId = pick(threads, index);
    if (projectId === fixture.projectId && fixtureCount < fixtureLinks) {
      threadId = fixture.threadId;
      fixtureCount += 1;
      fixtureAttachmentPaths.push(storedPath);
    }
    const paths = pathsByThread.get(threadId) ?? [];
    paths.push(storedPath);
    pathsByThread.set(threadId, paths);
  }
  for (const [threadId, paths] of pathsByThread) {
    acquireProjectAttachmentOwnership(db, threadId, paths);
  }
  return { fixtureAttachmentPaths, unownedAttachmentPaths };
}

function seedTerminals(
  db: DbConnection,
  fixture: HistoryFixture,
  hosts: SeededHosts,
  sessions: ReturnType<typeof seedSessions>,
  environments: ReturnType<typeof seedEnvironments>,
  scale: number,
) {
  const now = Date.now();
  const total = scaled(15_000, scale);
  const threadIds = [
    fixture.threadId,
    ...(environments.threadIdsByProject.get(fixture.projectId) ?? []).slice(
      0,
      200,
    ),
  ];
  const environmentIds = environments.loadedEnvironmentIds;
  const cwds = Array.from(
    { length: 30 },
    (_, index) => `/Users/dev/code/dir-${index}`,
  );
  const otherHosts = [...hosts.manualHostIds, ...hosts.remoteHostIds];
  let exitedTerminalId = "";
  for (let index = 0; index < total; index += 1) {
    const scopeBucket = index % 100;
    const hostBucket = (index * 7) % 10;
    const hostId =
      hostBucket < 8
        ? hosts.busyHostId
        : hostBucket < 9
          ? hosts.machineHostId
          : pick(otherHosts, index);
    const threadId = scopeBucket < 8 ? pick(threadIds, index) : null;
    const environmentId =
      scopeBucket >= 8 && scopeBucket < 15 ? pick(environmentIds, index) : null;
    const openBucket = index % 97;
    const status =
      openBucket === 0
        ? hostId === hosts.machineHostId
          ? "running"
          : "disconnected"
        : "exited";
    const createdAt = now - Math.floor(((total - index) / total) * 30 * DAY_MS);
    const session = createTerminalSession(db, {
      cols: 120,
      rows: 40,
      daemonSessionId:
        status === "running"
          ? sessions.machineActiveSessionId
          : status === "disconnected"
            ? sessions.busyLatestSessionId
            : null,
      environmentId:
        threadId === null &&
        environmentId !== null &&
        hostId === hosts.busyHostId
          ? environmentId
          : null,
      hostId,
      initialCwd: pick(cwds, index),
      now: createdAt,
      status: status === "exited" ? "running" : status,
      threadId,
      title: `zsh ${index}`,
    });
    if (status === "exited") {
      updateTerminalSession(db, {
        now: createdAt + 60_000,
        scope: { kind: "terminal", terminalId: session.id },
        update: { kind: "exit", closeReason: "user", exitCode: 0 },
      });
      exitedTerminalId = session.id;
    }
  }
  return { exitedTerminalId, hostPathCwd: pick(cwds, 0) };
}

export function seedHostsEnvironments(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): HostsEnvironmentsSeed {
  return db.transaction(
    () => {
      const hosts = seedHosts(db, fixture, scale);
      const projects = seedProjects(db, fixture, hosts, scale);
      const sessions = seedSessions(db, hosts, scale);
      const environments = seedEnvironments(
        db,
        fixture,
        hosts,
        projects,
        scale,
      );
      const attachments = seedAttachments(
        db,
        fixture,
        projects.projectIds,
        projects.deletingProjectId,
        environments.threadIdsByProject,
        scale,
      );
      const terminals = seedTerminals(
        db,
        fixture,
        hosts,
        sessions,
        environments,
        scale,
      );
      for (const projectId of [
        ...projects.projectIds,
        projects.deletingProjectId,
      ]) {
        upsertProjectExecutionDefaults(db, {
          projectId,
          providerId: PROVIDER_ID,
          model: "gpt-5",
          reasoningLevel: "high",
          permissionMode: "full",
          serviceTier: "default",
        });
      }
      for (const projectId of [
        projects.personalProjectId,
        ...projects.projectIds,
        projects.deletingProjectId,
      ]) {
        updateAttachmentBackfill(db, {
          ...ensureProjectAttachmentBackfill(db, projectId),
          phase: "done",
        });
      }
      markProjectDeleted(db, noopNotifier, {
        projectId: projects.deletingProjectId,
      });
      const busyDefaultSource = getProjectSourceByHost(
        db,
        fixture.projectId,
        hosts.busyHostId,
      );
      if (busyDefaultSource === null || !busyDefaultSource.isDefault) {
        throw new Error("Expected a default source for the busy project");
      }
      return {
        busyHostId: hosts.busyHostId,
        machineHostId: hosts.machineHostId,
        manualHostId: hosts.manualHostId,
        allHostIds: hosts.allHostIds,
        connectedHostIds: sessions.connectedHostIds,
        disconnectedActiveHostIds: [
          hosts.busyHostId,
          ...hosts.remoteHostIds.slice(2),
          ...hosts.suspendedHostIds,
        ],
        machineLaunchKey: hosts.machineLaunchKey,
        machineActiveSessionId: sessions.machineActiveSessionId,
        projectIds: projects.projectIds,
        otherProjectId: pick(projects.projectIds.slice(1), 0),
        deletingProjectId: projects.deletingProjectId,
        freeSourceHostId: projects.freeSourceHostId,
        busyDefaultSourceId: busyDefaultSource.id,
        busyExtraSourceId: projects.busyExtraSourceId,
        busySourcePath: busyDefaultSource.path,
        readyEnvironmentId: environments.readyEnvironmentId,
        readyEnvironmentPath: environments.readyEnvironmentPath,
        bindTargetPath: environments.bindTargetPath,
        sharedEnvironmentId: environments.sharedEnvironmentId,
        ownedEnvironmentThreadId: environments.ownedEnvironmentThreadId,
        loadedEnvironmentIds: environments.loadedEnvironmentIds,
        fixtureAttachmentPaths: attachments.fixtureAttachmentPaths,
        unownedAttachmentPaths: attachments.unownedAttachmentPaths,
        exitedTerminalId: terminals.exitedTerminalId,
        hostPathCwd: terminals.hostPathCwd,
      };
    },
    { behavior: "immediate" },
  );
}
