import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { WARM_POOLS_CHANGED_CHANNEL } from "./channels.js";
import {
  MAX_POOL_SIZE,
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
const HANDOFF_TIMEOUT_MS = 15_000;

const poolSizeSchema = z.number().int().min(0).max(MAX_POOL_SIZE);
const configurationSchema = z.array(
  z.object({ projectId: z.string().min(1), size: poolSizeSchema }).strict(),
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

export interface WarmHandOff {
  path: string;
  baseBranch: string;
  branchName: string;
}

export interface WarmPools {
  sizeFor(projectId: string): number;
  status(): Promise<WarmPoolStatus>;
  setSize(projectId: string, size: number): Promise<void>;
  handOff(args: {
    environmentId: string;
    projectId: string;
    hostId: string;
    sourcePath: string;
    branchName(): Promise<string>;
    adopt(environmentId: string): Promise<void>;
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
  const sizes = new Map(
    (stored.success ? stored.data : []).map((entry) => [
      entry.projectId,
      entry.size,
    ]),
  );
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

  function enabled(): boolean {
    return hadMembers || [...sizes.values()].some((size) => size > 0);
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
      [...sizes]
        .map(([projectId, size]) => ({ projectId, size }))
        .sort((left, right) => left.projectId.localeCompare(right.projectId)),
    );
  }

  function listMembers(filter: {
    projectId?: string;
    hostId?: string;
  }): Promise<Environment[]> {
    return bb.sdk.environments.list({
      ...filter,
      heldBy: holder,
      environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
      signal: lifetime.signal,
    });
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
    for (const [projectId, size] of sizes) {
      if (size === 0) continue;
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
        desired.push({
          projectId,
          hostId: source.hostId,
          sourcePath: source.path,
          size,
        });
      }
    }
    return { desired, unreachable };
  }

  async function refill(checkout: Checkout): Promise<void> {
    const key = checkoutKey(checkout.hostId, checkout.sourcePath);
    if (refilling.has(checkout.hostId)) return;
    refilling.add(checkout.hostId);
    try {
      await bb.sdk.environments.experimental_create({
        projectId: checkout.projectId,
        hostId: checkout.hostId,
        provider: {
          id: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
          inputs: { branch: { kind: "default" } },
        },
        hold: "plugin",
      });
    } catch (error) {
      if (lifetime.signal.aborted) return;
      const state = checkouts.get(key);
      if (state !== undefined) {
        state.lastError = errorMessage(error);
        state.retryAt = Date.now() + FAILURE_BACKOFF_MS;
      }
      bb.log.warn(
        `Warm worktree for ${checkout.sourcePath} on ${checkout.hostId} failed: ${errorMessage(error)}`,
      );
    } finally {
      refilling.delete(checkout.hostId);
    }
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
      state.lastError = `Could not fetch the default base: ${errorMessage(error)}`;
      return;
    }
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
    const discards: Array<[Environment, string]> = [];
    for (const member of own.filter((entry) => entry.status === "error")) {
      state.lastError = member.statusMessage ?? "Warm worktree setup failed";
      state.retryAt = now + FAILURE_BACKOFF_MS;
      discards.push([member, "its setup failed"]);
    }
    const current: Environment[] = [];
    for (const member of ready) {
      if (repaired.has(member.id))
        discards.push([member, "its checkout left the placeholder branch"]);
      else if (now - member.createdAt > MEMBER_TTL_MS)
        discards.push([member, "it outlived its time to live"]);
      else if (observed.get(member.path ?? "")?.head !== refreshed.commit)
        discards.push([member, `it is behind ${refreshed.ref ?? "the base"}`]);
      else current.push(member);
    }
    const live = [...current, ...own.filter(isPreparing)].sort(
      (left, right) => right.createdAt - left.createdAt,
    );
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
          !tried.has(candidate.id),
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
    for (;;) {
      const member = await serialFor(request)(() => reserve(request, tried));
      if (member === null || member.path === null || member.branchName === null)
        break;
      tried.add(member.id);
      let result;
      let toBranch;
      try {
        toBranch = await request.branchName();
        result = await host.call(
          "handOff",
          {
            sourcePath: request.sourcePath,
            path: member.path,
            fromBranch: member.branchName,
            toBranch,
          },
          {
            hostId: request.hostId,
            signal: request.signal,
            timeoutMs: HANDOFF_TIMEOUT_MS,
          },
        );
      } catch (error) {
        reserved.delete(member.id);
        if (request.signal.aborted) throw error;
        bb.log.warn(
          `Warm worktree ${member.id} could not be handed off: ${errorMessage(error)}`,
        );
        break;
      }
      if (result.status !== "handed-off") {
        reserved.delete(member.id);
        if (result.status === "busy") break;
        const reason = result.reason;
        await serialFor(request)(() =>
          discard(member, `it cannot be handed off: ${reason}`),
        );
        continue;
      }
      try {
        await request.adopt(member.id);
      } catch (error) {
        reserved.delete(member.id);
        await host
          .call(
            "restorePoolMember",
            {
              sourcePath: request.sourcePath,
              path: member.path,
              placeholder: member.branchName,
            },
            { hostId: request.hostId, timeoutMs: HANDOFF_TIMEOUT_MS },
          )
          .catch(() => undefined);
        if (request.signal.aborted) throw error;
        bb.log.warn(
          `Warm worktree ${member.id} could not be adopted: ${errorMessage(error)}`,
        );
        continue;
      }
      countersFor(request.projectId).handedOff += 1;
      return {
        path: member.path,
        baseBranch: result.baseBranch,
        branchName: toBranch,
      };
    }
    countersFor(request.projectId).missed += 1;
    return null;
  }

  return {
    sizeFor(projectId) {
      return sizes.get(projectId) ?? 0;
    },
    status,
    async setSize(projectId, size) {
      const parsed = poolSizeSchema.parse(size);
      await bb.sdk.projects.get({ projectId });
      if (parsed === 0) sizes.delete(projectId);
      else sizes.set(projectId, parsed);
      for (const state of checkouts.values()) state.retryAt = 0;
      await saveConfiguration();
      await reconcile();
    },
    async handOff(request) {
      if ((sizes.get(request.projectId) ?? 0) === 0) return null;
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
