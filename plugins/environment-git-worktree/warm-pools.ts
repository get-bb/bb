import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { WARM_POOLS_CHANGED_CHANNEL } from "./channels.js";
import {
  MAX_POOL_SIZE,
  type RemoteBase,
  worktreeHostContract,
  worktreeHostSignals,
} from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const CONFIGURATION_KEY = "warm-pools";
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;
const STARTUP_DELAY_MS = 5_000;
const AFTER_HANDOFF_DELAY_MS = 10_000;
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const MEMBER_TTL_MS = 8 * 60 * 60 * 1000;
const RESERVATION_TTL_MS = 10 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;
const HANDOFF_CHECK_TIMEOUT_MS = 15_000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const LIST_PAGE_SIZE = 500;
const SETTLE_POLL_MS = 2_000;

const MAX_POOL_FOLDERS = 64;
const poolSizeSchema = z.number().int().min(0).max(MAX_POOL_SIZE);
const poolFoldersSchema = z.array(z.string().min(1)).max(MAX_POOL_FOLDERS);
const configurationSchema = z.array(
  z
    .object({
      projectId: z.string().min(1),
      size: poolSizeSchema,
      hosts: z.record(z.string().min(1), poolSizeSchema).default({}),
      folders: z.record(z.string().min(1), poolFoldersSchema).default({}),
    })
    .strict(),
);

export const warmPoolStatusSchema = z
  .object({
    pools: z.array(
      z
        .object({
          projectId: z.string().min(1),
          projectName: z.string(),
          size: poolSizeSchema,
          handedOff: z.number().int().min(0),
          missed: z.number().int().min(0),
          checkouts: z.array(
            z
              .object({
                hostId: z.string().min(1),
                hostName: z.string(),
                path: z.string().min(1),
                size: poolSizeSchema,
                hostSize: poolSizeSchema.nullable(),
                folders: poolFoldersSchema,
                ready: z.number().int().min(0),
                preparing: z.number().int().min(0),
                base: z.string().nullable(),
                lastError: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type WarmPoolStatus = z.infer<typeof warmPoolStatusSchema>;

type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["list"]>
>[number];

type WorktreeHostClient = ExperimentalHostClient<
  typeof worktreeHostContract,
  typeof worktreeHostSignals
>;

interface Checkout {
  projectId: string;
  hostId: string;
  sourcePath: string;
  size: number;
  folders: string[];
}

interface CheckoutState {
  base: string | null;
  lastError: string | null;
  retryAt: number;
}

interface Counters {
  handedOff: number;
  missed: number;
}

export interface WarmFolderWorktree {
  sourcePath: string;
  path: string;
  baseBranch: string | null;
}

export interface HandedFolderWorktree extends WarmFolderWorktree {
  baseCommit: string;
  memberCommit: string;
}

export interface WarmHandOff {
  path: string;
  baseBranch: string;
  baseCommit: string;
  memberCommit: string;
  offline: boolean;
  placeholder: string;
  folders: HandedFolderWorktree[];
}

export interface WarmPools {
  status(): Promise<WarmPoolStatus>;
  setSize(projectId: string, size: number): Promise<void>;
  setHostSize(
    projectId: string,
    hostId: string,
    size: number | null,
  ): Promise<void>;
  setFolders(
    projectId: string,
    hostId: string,
    folders: readonly string[],
  ): Promise<void>;
  handOff(args: {
    environmentId: string;
    projectId: string;
    hostId: string;
    sourcePath: string;
    folders: readonly string[];
    adopt(environmentId: string, handOff: WarmHandOff): Promise<void>;
    signal: AbortSignal;
  }): Promise<WarmHandOff | null>;
  dispose(): void;
}

function checkoutKey(hostId: string, sourcePath: string): string {
  return `${hostId}\0${sourcePath}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "status" in error && error.status === 404;
}

function trimTrailingSeparators(folderPath: string): string {
  return folderPath.replace(/(?<=.)[\\/]+$/u, "");
}

function samePath(left: string, right: string): boolean {
  return trimTrailingSeparators(left) === trimTrailingSeparators(right);
}

function sameFolderSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((folder) => right.some((other) => samePath(folder, other)))
  );
}

function memberFolders(member: Environment): WarmFolderWorktree[] {
  return member.additionalPaths.flatMap((entry) =>
    entry.replaces === null
      ? []
      : [{ sourcePath: entry.replaces, path: entry.path, baseBranch: null }],
  );
}

function isPreparing(member: Environment): boolean {
  return member.status === "creating" || member.status === "provisioning";
}

function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

export async function createWarmPools(args: {
  bb: BbPluginApi;
  host: WorktreeHostClient;
}): Promise<WarmPools> {
  const { bb, host } = args;
  const holder = `plugin:${bb.pluginId}` as const;
  const stored = configurationSchema.safeParse(
    await bb.storage.kv.get<unknown>(CONFIGURATION_KEY),
  );
  const configuration = stored.success ? stored.data : [];
  const sizes = new Map(
    configuration
      .filter((entry) => entry.size > 0)
      .map((entry) => [entry.projectId, entry.size]),
  );
  const hostSizes = new Map(
    configuration
      .filter((entry) => Object.keys(entry.hosts).length > 0)
      .map((entry) => [entry.projectId, new Map(Object.entries(entry.hosts))]),
  );
  const hostFolders = new Map(
    configuration
      .filter((entry) => Object.keys(entry.folders).length > 0)
      .map((entry) => [
        entry.projectId,
        new Map(Object.entries(entry.folders)),
      ]),
  );

  function foldersOn(projectId: string, hostId: string): string[] {
    return hostFolders.get(projectId)?.get(hostId) ?? [];
  }
  const checkouts = new Map<string, CheckoutState>();
  const counters = new Map<string, Counters>();
  const reserved = new Map<string, number>();
  const refilling = new Set<string>();
  const queues = new Map<string, ReturnType<typeof createSerialQueue>>();
  const lifetime = new AbortController();
  let reconciling: Promise<void> | null = null;
  let reconcileAgain = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  let hadMembers = false;

  function sizeOn(projectId: string, hostId: string): number {
    return hostSizes.get(projectId)?.get(hostId) ?? sizes.get(projectId) ?? 0;
  }

  function configuredProjects(): string[] {
    return [
      ...new Set([...sizes.keys(), ...hostSizes.keys(), ...hostFolders.keys()]),
    ];
  }

  function enabled(): boolean {
    return (
      hadMembers ||
      sizes.size > 0 ||
      [...hostSizes.values()].some((hosts) =>
        [...hosts.values()].some((size) => size > 0),
      )
    );
  }

  function serialFor(target: { projectId: string; hostId: string }) {
    const key = `${target.projectId}\0${target.hostId}`;
    let queue = queues.get(key);
    if (queue === undefined) {
      queue = createSerialQueue();
      queues.set(key, queue);
    }
    return queue;
  }

  function countersFor(projectId: string): Counters {
    let entry = counters.get(projectId);
    if (entry === undefined) {
      entry = { handedOff: 0, missed: 0 };
      counters.set(projectId, entry);
    }
    return entry;
  }

  function stateFor(checkout: Pick<Checkout, "hostId" | "sourcePath">) {
    const key = checkoutKey(checkout.hostId, checkout.sourcePath);
    let state = checkouts.get(key);
    if (state === undefined) {
      state = { base: null, lastError: null, retryAt: 0 };
      checkouts.set(key, state);
    }
    return state;
  }

  async function saveConfiguration(): Promise<void> {
    await bb.storage.kv.set(
      CONFIGURATION_KEY,
      configuredProjects()
        .sort((left, right) => left.localeCompare(right))
        .map((projectId) => ({
          projectId,
          size: sizes.get(projectId) ?? 0,
          hosts: Object.fromEntries(
            [...(hostSizes.get(projectId) ?? [])].sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
          folders: Object.fromEntries(
            [...(hostFolders.get(projectId) ?? [])].sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        })),
    );
  }

  async function listMembers(filter: {
    projectId?: string;
    hostId?: string;
  }): Promise<Environment[]> {
    const members: Environment[] = [];
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const page = await bb.sdk.environments.list({
        ...filter,
        heldBy: holder,
        environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
        limit: LIST_PAGE_SIZE,
        offset,
        signal: lifetime.signal,
      });
      members.push(...page);
      if (page.length < LIST_PAGE_SIZE) return members;
    }
  }

  async function discard(member: Environment, why: string): Promise<void> {
    if (reserved.has(member.id)) return;
    try {
      await bb.sdk.environments.delete({ environmentId: member.id });
      bb.log.info(`Discarded warm worktree ${member.id}: ${why}`);
    } catch (error) {
      if (!isNotFound(error))
        bb.log.warn(
          `Could not discard warm worktree ${member.id}: ${errorMessage(error)}`,
        );
    }
  }

  async function desiredCheckouts(): Promise<{
    desired: Checkout[];
    unreachable: Set<string>;
  }> {
    const desired: Checkout[] = [];
    const unreachable = new Set<string>();
    for (const projectId of configuredProjects()) {
      let project;
      try {
        project = await bb.sdk.projects.get({
          projectId,
          signal: lifetime.signal,
        });
      } catch (error) {
        if (lifetime.signal.aborted) throw error;
        if (isNotFound(error)) {
          sizes.delete(projectId);
          hostSizes.delete(projectId);
          hostFolders.delete(projectId);
          await saveConfiguration();
        } else {
          unreachable.add(projectId);
          bb.log.warn(
            `Warm worktrees skipped project ${projectId}: ${errorMessage(error)}`,
          );
        }
        continue;
      }
      for (const source of project.sources) {
        if (source.type !== "local_path") continue;
        const size = sizeOn(projectId, source.hostId);
        if (size === 0) continue;
        const configuredFolders = foldersOn(projectId, source.hostId);
        let folders: string[] = [];
        if (configuredFolders.length > 0) {
          try {
            const sourceFolders =
              await bb.sdk.projects.sources.experimental_folders.list({
                projectId,
                sourceId: source.id,
                signal: lifetime.signal,
              });
            folders = configuredFolders.flatMap((folder) => {
              const match = sourceFolders.find((entry) =>
                samePath(entry.path, folder),
              );
              return match === undefined ? [] : [match.path];
            });
          } catch (error) {
            if (lifetime.signal.aborted) throw error;
            unreachable.add(projectId);
            bb.log.warn(
              `Warm worktrees skipped project ${projectId}: ${errorMessage(error)}`,
            );
            continue;
          }
        }
        desired.push({
          projectId,
          hostId: source.hostId,
          sourcePath: source.path,
          size,
          folders,
        });
      }
    }
    return { desired, unreachable };
  }

  async function refill(checkout: Checkout): Promise<void> {
    const key = checkoutKey(checkout.hostId, checkout.sourcePath);
    if (refilling.has(checkout.hostId)) return;
    refilling.add(checkout.hostId);
    let created: Environment;
    try {
      created = await bb.sdk.environments.experimental_create({
        projectId: checkout.projectId,
        hostId: checkout.hostId,
        provider: {
          id: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
          inputs: { branch: { kind: "default" }, folders: checkout.folders },
        },
        hold: "plugin",
      });
    } catch (error) {
      if (lifetime.signal.aborted) return;
      const state = checkouts.get(key);
      if (state !== undefined) {
        state.lastError = `Could not create a warm worktree, trying again in 10 minutes: ${errorMessage(error)}`;
        state.retryAt = Date.now() + FAILURE_BACKOFF_MS;
      }
      bb.log.warn(
        `Warm worktree for ${checkout.sourcePath} on ${checkout.hostId} failed: ${errorMessage(error)}`,
      );
      return;
    } finally {
      refilling.delete(checkout.hostId);
    }
    bb.realtime.publish(WARM_POOLS_CHANGED_CHANNEL, {});
    await untilSettled(created);
  }

  async function untilSettled(member: Environment): Promise<void> {
    let current = member;
    while (isPreparing(current)) {
      try {
        await delay(SETTLE_POLL_MS, undefined, { signal: lifetime.signal });
        current = await bb.sdk.environments.get({
          environmentId: member.id,
          signal: lifetime.signal,
        });
      } catch (error) {
        if (lifetime.signal.aborted || isNotFound(error)) return;
        bb.log.warn(
          `Could not check warm worktree ${member.id}: ${errorMessage(error)}`,
        );
        return;
      }
    }
  }

  async function folderStaleness(
    checkout: Checkout,
    ready: readonly Environment[],
    state: CheckoutState,
  ): Promise<Map<string, string>> {
    const problems = new Map<string, string>();
    for (const member of ready) {
      const folders = memberFolders(member).map((folder) => folder.sourcePath);
      if (!sameFolderSet(folders, checkout.folders))
        problems.set(member.id, "its folders differ from the pool's");
    }
    for (const folder of checkout.folders) {
      const worktrees = ready.flatMap((member) => {
        if (problems.has(member.id)) return [];
        const worktree = memberFolders(member).find((entry) =>
          samePath(entry.sourcePath, folder),
        );
        return worktree === undefined ? [] : [{ member, path: worktree.path }];
      });
      if (worktrees.length === 0) continue;
      let refreshed;
      try {
        refreshed = await host.call(
          "refreshPoolBase",
          {
            sourcePath: folder,
            memberPaths: worktrees.map((worktree) => worktree.path),
          },
          {
            hostId: checkout.hostId,
            signal: lifetime.signal,
            timeoutMs: REFRESH_TIMEOUT_MS,
          },
        );
      } catch (error) {
        if (lifetime.signal.aborted) throw error;
        state.lastError = `Could not check ${folder} for updates, trying again in 2 minutes.`;
        continue;
      }
      if (refreshed.status === "no-repository") {
        state.lastError = `The project folder ${folder} is missing or is not a git repository.`;
        continue;
      }
      const observed = new Map(
        refreshed.members.map((member) => [member.path, member]),
      );
      for (const { member, path } of worktrees) {
        const seen = observed.get(path);
        if (seen === undefined || seen.branch !== member.branchName)
          problems.set(
            member.id,
            `its worktree of ${folder} left the placeholder branch`,
          );
        else if (!seen.onBase)
          problems.set(
            member.id,
            `its worktree of ${folder} is not on ${refreshed.ref ?? "the base"}`,
          );
      }
    }
    return problems;
  }

  async function reconcileCheckout(
    checkout: Checkout,
    own: Environment[],
    now: number,
  ): Promise<void> {
    const state = stateFor(checkout);
    const ready = own.filter(
      (member) => member.status === "ready" && member.path !== null,
    );
    let refreshed;
    try {
      refreshed = await host.call(
        "refreshPoolBase",
        {
          sourcePath: checkout.sourcePath,
          memberPaths: ready.flatMap((member) =>
            member.path === null ? [] : [member.path],
          ),
        },
        {
          hostId: checkout.hostId,
          signal: lifetime.signal,
          timeoutMs: REFRESH_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (lifetime.signal.aborted) throw error;
      bb.log.warn(
        `Could not check ${checkout.sourcePath} on ${checkout.hostId} for updates: ${errorMessage(error)}`,
      );
      state.lastError =
        "Could not check the default branch for updates, trying again in 2 minutes.";
      return;
    }
    if (refreshed.status === "no-repository") {
      state.lastError = `The project folder ${checkout.sourcePath} is missing or is not a git repository.`;
      return;
    }
    if (state.retryAt <= now) state.lastError = null;
    state.base = refreshed.ref;
    const observed = new Map(
      refreshed.members.map((member) => [member.path, member]),
    );
    const repaired = await serialFor(checkout)(async () => {
      const used = new Set<string>();
      for (const member of ready) {
        const seen = observed.get(member.path ?? "");
        if (
          seen === undefined ||
          member.path === null ||
          member.branchName === null ||
          seen.branch === member.branchName ||
          reserved.has(member.id)
        )
          continue;
        try {
          const restored = await host.call(
            "restorePoolMember",
            {
              sourcePath: checkout.sourcePath,
              path: member.path,
              placeholder: member.branchName,
            },
            {
              hostId: checkout.hostId,
              signal: lifetime.signal,
              timeoutMs: REFRESH_TIMEOUT_MS,
            },
          );
          if (restored.status === "used") used.add(member.id);
        } catch (error) {
          if (lifetime.signal.aborted) throw error;
          used.add(member.id);
        }
      }
      return used;
    });
    const staleFolders = await folderStaleness(checkout, ready, state);
    const discards: Array<[Environment, string]> = [];
    for (const member of own.filter((entry) => entry.status === "error")) {
      state.lastError =
        member.statusMessage === null
          ? "Setup failed in a warm worktree, trying again in 10 minutes."
          : `Setup failed in a warm worktree, trying again in 10 minutes: ${member.statusMessage}`;
      state.retryAt = now + FAILURE_BACKOFF_MS;
      discards.push([member, "its setup failed"]);
    }
    const current: Environment[] = [];
    for (const member of ready) {
      const folderProblem = staleFolders.get(member.id);
      if (repaired.has(member.id))
        discards.push([member, "its checkout left the placeholder branch"]);
      else if (folderProblem !== undefined)
        discards.push([member, folderProblem]);
      else if (now - member.createdAt > MEMBER_TTL_MS)
        discards.push([member, "it outlived its time to live"]);
      else if (observed.get(member.path ?? "")?.onBase !== true)
        discards.push([member, `it is not on ${refreshed.ref ?? "the base"}`]);
      else current.push(member);
    }
    const live = [
      ...current,
      ...own.filter(
        (member) =>
          isPreparing(member) &&
          sameFolderSet(
            memberFolders(member).map((folder) => folder.sourcePath),
            checkout.folders,
          ),
      ),
    ].sort((left, right) => right.createdAt - left.createdAt);
    for (const member of live.slice(checkout.size))
      discards.push([member, "the pool shrank"]);
    await serialFor(checkout)(async () => {
      for (const [member, why] of discards) await discard(member, why);
    });
    if (
      live.length < checkout.size &&
      !own.some(isPreparing) &&
      state.retryAt <= now
    ) {
      void refill(checkout).finally(() => schedule(0));
    }
  }

  async function reconcileOnce(): Promise<void> {
    const now = Date.now();
    const members = (await listMembers({})).filter(
      (member) => member.lifecycle.phase === "active",
    );
    hadMembers = members.length > 0;
    const memberIds = new Set(members.map((member) => member.id));
    for (const [id, at] of reserved) {
      if (!memberIds.has(id) || now - at > RESERVATION_TTL_MS)
        reserved.delete(id);
    }
    const { desired, unreachable } = await desiredCheckouts();
    const connected = new Set(
      (await bb.sdk.hosts.list({ signal: lifetime.signal }))
        .filter((entry) => entry.status === "connected")
        .map((entry) => entry.id),
    );
    const wanted = new Set(
      desired.map((checkout) => `${checkout.projectId}\0${checkout.hostId}`),
    );
    for (const member of members) {
      if (
        !unreachable.has(member.projectId) &&
        !wanted.has(`${member.projectId}\0${member.hostId}`)
      )
        await serialFor(member)(() =>
          discard(member, "its pool was turned off"),
        );
    }
    for (const checkout of desired) {
      if (!connected.has(checkout.hostId)) continue;
      const own = members.filter(
        (member) =>
          member.projectId === checkout.projectId &&
          member.hostId === checkout.hostId &&
          !reserved.has(member.id),
      );
      await reconcileCheckout(checkout, own, now);
    }
    for (const key of checkouts.keys()) {
      if (
        !desired.some(
          (checkout) =>
            checkoutKey(checkout.hostId, checkout.sourcePath) === key,
        )
      )
        checkouts.delete(key);
    }
    bb.realtime.publish(WARM_POOLS_CHANGED_CHANNEL, {});
  }

  function reconcile(): Promise<void> {
    if (reconciling !== null) {
      reconcileAgain = true;
      return reconciling;
    }
    reconciling = (async () => {
      do {
        reconcileAgain = false;
        try {
          await reconcileOnce();
        } catch (error) {
          if (lifetime.signal.aborted) return;
          bb.log.warn(`Warm worktree reconcile failed: ${errorMessage(error)}`);
        }
      } while (reconcileAgain && !lifetime.signal.aborted);
    })().finally(() => {
      reconciling = null;
    });
    return reconciling;
  }

  function schedule(delayMs: number): void {
    if (lifetime.signal.aborted || pendingTimer !== null) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void reconcile();
    }, delayMs);
    pendingTimer.unref?.();
  }

  const interval = setInterval(() => {
    if (enabled()) void reconcile();
  }, RECONCILE_INTERVAL_MS);
  interval.unref?.();
  schedule(STARTUP_DELAY_MS);

  async function status(): Promise<WarmPoolStatus> {
    const [hosts, projects, members] = await Promise.all([
      bb.sdk.hosts.list(),
      bb.sdk.projects.list(),
      listMembers({}),
    ]);
    const hostNames = new Map(hosts.map((entry) => [entry.id, entry.name]));
    return {
      pools: projects.map((project) => {
        const own = members.filter(
          (member) =>
            member.projectId === project.id &&
            member.lifecycle.phase === "active",
        );
        return {
          projectId: project.id,
          projectName: project.name,
          size: sizes.get(project.id) ?? 0,
          ...(counters.get(project.id) ?? { handedOff: 0, missed: 0 }),
          checkouts: project.sources
            .filter((source) => source.type === "local_path")
            .map((source) => {
              const state = checkouts.get(
                checkoutKey(source.hostId, source.path),
              );
              const onHost = own.filter(
                (member) => member.hostId === source.hostId,
              );
              return {
                hostId: source.hostId,
                hostName: hostNames.get(source.hostId) ?? source.hostId,
                path: source.path,
                size: sizeOn(project.id, source.hostId),
                hostSize: hostSizes.get(project.id)?.get(source.hostId) ?? null,
                folders: foldersOn(project.id, source.hostId),
                ready: onHost.filter((member) => member.status === "ready")
                  .length,
                preparing: onHost.filter(isPreparing).length,
                base: state?.base ?? null,
                lastError: state?.lastError ?? null,
              };
            }),
        };
      }),
    };
  }

  async function reserve(
    request: Parameters<WarmPools["handOff"]>[0],
    tried: ReadonlySet<string>,
  ): Promise<Environment | null> {
    const own = await listMembers({
      projectId: request.projectId,
      hostId: request.hostId,
    });
    const member = own
      .filter(
        (candidate) =>
          candidate.status === "ready" &&
          candidate.lifecycle.phase === "active" &&
          candidate.path !== null &&
          candidate.branchName !== null &&
          !reserved.has(candidate.id) &&
          !tried.has(candidate.id) &&
          sameFolderSet(
            memberFolders(candidate).map((folder) => folder.sourcePath),
            request.folders,
          ),
      )
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (member === undefined) return null;
    reserved.set(member.id, Date.now());
    return member;
  }

  async function handOff(
    request: Parameters<WarmPools["handOff"]>[0],
  ): Promise<WarmHandOff | null> {
    const creating = await bb.sdk.environments.get({
      environmentId: request.environmentId,
      signal: request.signal,
    });
    if (creating.heldBy !== null) return null;
    const tried = new Set<string>();
    let base: RemoteBase | null = null;
    const folderBases = new Map<string, RemoteBase>();
    const claim = (target: {
      sourcePath: string;
      path: string;
      placeholder: string;
      base: RemoteBase | null;
    }) =>
      host.call(
        "claimPoolMember",
        { ...target, checkTimeoutMs: HANDOFF_CHECK_TIMEOUT_MS },
        {
          hostId: request.hostId,
          signal: request.signal,
          timeoutMs: CLAIM_TIMEOUT_MS,
        },
      );
    const claimFailed = async (
      member: Environment,
      error: unknown,
    ): Promise<void> => {
      reserved.delete(member.id);
      await serialFor(request)(() =>
        discard(member, "its claim failed and it may have moved"),
      );
      if (request.signal.aborted) throw error;
      bb.log.warn(
        `Warm worktree ${member.id} could not be handed off: ${errorMessage(error)}`,
      );
    };
    const checkTimedOut = `its check took longer than ${HANDOFF_CHECK_TIMEOUT_MS / 1000} s`;
    for (;;) {
      const member = await serialFor(request)(() => reserve(request, tried));
      if (member === null || member.path === null || member.branchName === null)
        break;
      tried.add(member.id);
      const placeholder = member.branchName;
      let claimed;
      try {
        claimed = await claim({
          sourcePath: request.sourcePath,
          path: member.path,
          placeholder,
          base,
        });
      } catch (error) {
        await claimFailed(member, error);
        break;
      }
      if (claimed.status === "no-base") {
        reserved.delete(member.id);
        break;
      }
      if (
        claimed.status === "timed-out" ||
        claimed.status === "base-unavailable"
      ) {
        reserved.delete(member.id);
        bb.log.warn(
          `Warm worktree ${member.id} could not be handed off: ${claimed.status === "timed-out" ? checkTimedOut : claimed.reason}`,
        );
        break;
      }
      base = claimed.base;
      if (claimed.status !== "usable") {
        reserved.delete(member.id);
        if (claimed.status === "busy") break;
        const reason = claimed.reason;
        await serialFor(request)(() =>
          discard(member, `it cannot be handed off: ${reason}`),
        );
        continue;
      }
      const settled = await Promise.allSettled(
        memberFolders(member).map(async (folder) => ({
          folder,
          claimed: await claim({
            sourcePath: folder.sourcePath,
            path: folder.path,
            placeholder,
            base: folderBases.get(folder.sourcePath) ?? null,
          }),
        })),
      );
      const failure = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected",
      );
      if (failure !== undefined) {
        await claimFailed(member, failure.reason);
        break;
      }
      let moved = claimed.head !== claimed.base.commit;
      const folders: HandedFolderWorktree[] = [];
      let folderProblem: { discard: string | null } | null = null;
      for (const entry of settled) {
        if (entry.status === "rejected") continue;
        const { folder, claimed: folderClaimed } = entry.value;
        if (
          folderClaimed.status === "usable" ||
          folderClaimed.status === "refused" ||
          folderClaimed.status === "busy"
        )
          folderBases.set(folder.sourcePath, folderClaimed.base);
        if (folderClaimed.status === "usable") {
          if (folderClaimed.head !== folderClaimed.base.commit) moved = true;
          folders.push({
            ...folder,
            baseBranch: folderClaimed.base.ref,
            baseCommit: folderClaimed.base.commit,
            memberCommit: folderClaimed.head,
          });
          continue;
        }
        if (folderProblem !== null) continue;
        if (folderClaimed.status === "refused") {
          folderProblem = {
            discard: `its worktree of ${folder.sourcePath} cannot be handed off: ${folderClaimed.reason}`,
          };
          continue;
        }
        if (
          folderClaimed.status === "timed-out" ||
          folderClaimed.status === "base-unavailable"
        )
          bb.log.warn(
            `Warm worktree ${member.id} could not be handed off: its worktree of ${folder.sourcePath}: ${folderClaimed.status === "timed-out" ? checkTimedOut : folderClaimed.reason}`,
          );
        folderProblem = { discard: null };
      }
      if (folderProblem !== null) {
        reserved.delete(member.id);
        const reason =
          folderProblem.discard ??
          (moved ? "it moved to a new base but was not handed off" : null);
        if (reason !== null)
          await serialFor(request)(() => discard(member, reason));
        if (folderProblem.discard === null) break;
        continue;
      }
      const handed: WarmHandOff = {
        path: member.path,
        baseBranch: claimed.base.ref,
        baseCommit: claimed.base.commit,
        memberCommit: claimed.head,
        offline: claimed.base.offline,
        placeholder,
        folders,
      };
      try {
        await request.adopt(member.id, handed);
      } catch (error) {
        reserved.delete(member.id);
        if (moved)
          await serialFor(request)(() =>
            discard(member, "it moved to a new base but was not adopted"),
          );
        if (request.signal.aborted) throw error;
        bb.log.warn(
          `Warm worktree ${member.id} could not be adopted: ${errorMessage(error)}`,
        );
        continue;
      }
      countersFor(request.projectId).handedOff += 1;
      return handed;
    }
    countersFor(request.projectId).missed += 1;
    return null;
  }

  async function saveAndReconcile(): Promise<void> {
    for (const state of checkouts.values()) state.retryAt = 0;
    await saveConfiguration();
    void reconcile();
  }

  return {
    status,
    async setSize(projectId, size) {
      const parsed = poolSizeSchema.parse(size);
      await bb.sdk.projects.get({ projectId });
      if (parsed === 0) sizes.delete(projectId);
      else sizes.set(projectId, parsed);
      await saveAndReconcile();
    },
    async setHostSize(projectId, hostId, size) {
      const parsed = poolSizeSchema.nullable().parse(size);
      const project = await bb.sdk.projects.get({ projectId });
      if (
        !project.sources.some(
          (source) => source.type === "local_path" && source.hostId === hostId,
        )
      )
        throw new Error(
          `Project ${projectId} has no checkout on machine ${hostId}`,
        );
      const hosts = hostSizes.get(projectId) ?? new Map<string, number>();
      if (parsed === null) hosts.delete(hostId);
      else hosts.set(hostId, parsed);
      if (hosts.size === 0) hostSizes.delete(projectId);
      else hostSizes.set(projectId, hosts);
      await saveAndReconcile();
    },
    async setFolders(projectId, hostId, folders) {
      const requested = poolFoldersSchema.parse([...folders]);
      const project = await bb.sdk.projects.get({ projectId });
      const source = project.sources.find(
        (candidate) =>
          candidate.type === "local_path" && candidate.hostId === hostId,
      );
      if (source === undefined)
        throw new Error(
          `Project ${projectId} has no checkout on machine ${hostId}`,
        );
      const known = (
        await bb.sdk.projects.sources.experimental_folders.list({
          projectId,
          sourceId: source.id,
        })
      ).map((entry) => entry.path);
      const chosen: string[] = [];
      for (const folder of requested) {
        const match = known.find((entry) => samePath(entry, folder));
        if (match === undefined)
          throw new Error(
            `${folder} is not one of this project's folders on machine ${hostId}. List them with \`bb project folder list ${projectId} --machine ${hostId}\`.`,
          );
        if (!chosen.some((entry) => samePath(entry, match))) chosen.push(match);
      }
      const hosts = hostFolders.get(projectId) ?? new Map<string, string[]>();
      if (chosen.length === 0) hosts.delete(hostId);
      else hosts.set(hostId, chosen);
      if (hosts.size === 0) hostFolders.delete(projectId);
      else hostFolders.set(projectId, hosts);
      await saveAndReconcile();
    },
    async handOff(request) {
      if (sizeOn(request.projectId, request.hostId) === 0) return null;
      try {
        return await handOff(request);
      } catch (error) {
        if (request.signal.aborted) throw error;
        bb.log.warn(`Warm worktree handoff failed: ${errorMessage(error)}`);
        return null;
      } finally {
        schedule(AFTER_HANDOFF_DELAY_MS);
      }
    },
    dispose() {
      lifetime.abort();
      clearInterval(interval);
      if (pendingTimer !== null) clearTimeout(pendingTimer);
    },
  };
}
