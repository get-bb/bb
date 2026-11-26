import {
  deleteHostServerAccessGrant,
  getAppSettings,
  getExperiments,
  getHost,
  getHostServerAccessGrant,
  getInstalledPlugin,
  getOrCreateServerId,
  getServerAccessOrigins,
  setHostColumns,
  setServerAccessOrigins,
  listHostServerAccessGrants,
  upsertHostServerAccessGrant,
} from "@bb/db";
import {
  LOCAL_NETWORK_SERVER_ACCESS_PROVIDER_ID,
  MANUAL_SERVER_ACCESS_PROVIDER_ID,
  type ServerAccessOrigin,
  type ServerRouteKind,
} from "@bb/domain";
import type {
  HostDaemonServerRoute,
  HostDaemonServerRoutes,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import type { ServerAccessGrant } from "@get-bb/plugin-sdk";
import type {
  ServerAccessAvailability,
  ServerAccessStatus,
  ServerRoute,
} from "@bb/server-contract";
import { decideWithinBox } from "../threads/dispatch-hooks.js";
import type { WorkSessionDeps } from "../../types.js";
import {
  admittedServerAccessOrigins,
  invokeServerAccessProvider,
  listServerAccessProviders,
  setAdmittedServerAccessOrigins,
  type ServerAccessProviderRecord,
} from "../plugins/plugin-server-access-registry.js";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";
import { localNetworkState } from "../server-routes/local-network.js";

type Dependencies = Pick<WorkSessionDeps, "db" | "hub" | "logger">;

const AVAILABILITY_TIMEOUT_MS = 5_000;
const ROUTE_KIND_RANK: Record<ServerRouteKind, number> = {
  "local-network": 0,
  "private-overlay": 1,
  relay: 2,
  custom: 3,
};

const reachableUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
const grantSchema: z.ZodType<ServerAccessGrant> = z
  .object({
    id: z.string().min(1),
    serverUrl: reachableUrlSchema,
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const acquireResultSchema = z.union([
  grantSchema,
  z
    .object({ status: z.literal("failed"), message: z.string().min(1) })
    .strict(),
]);
const availabilitySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    serverUrl: reachableUrlSchema.optional(),
  }),
  z.object({ status: z.literal("setup-required"), message: z.string() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

interface ServerAccessProviderEntry {
  id: string;
  displayName: string;
  description: string;
  pluginId: string | null;
  routeKind: ServerRouteKind;
  record: ServerAccessProviderRecord | null;
}

interface ProviderAvailability {
  availability: ServerAccessAvailability;
  urls: string[];
  answered: boolean;
}

export function machineServerUrl(deps: Pick<Dependencies, "db">) {
  const configured = getAppSettings(deps.db).machineServerUrl;
  const raw = configured ?? process.env.BB_EXTERNAL_URL ?? null;
  const parsed = reachableUrlSchema.safeParse(raw);
  return {
    url: parsed.success ? parsed.data.replace(/\/$/u, "") : null,
    source:
      configured !== null
        ? ("setting" as const)
        : raw !== null
          ? ("BB_EXTERNAL_URL" as const)
          : null,
  };
}

const LOCAL_NETWORK_PROVIDER = {
  id: LOCAL_NETWORK_SERVER_ACCESS_PROVIDER_ID,
  displayName: "Local network",
  description:
    "Devices on this network reach bb directly. Anyone on the network can use bb, so only turn this on for a network you trust.",
  pluginId: null,
  routeKind: "local-network",
  record: null,
} satisfies ServerAccessProviderEntry;

const MANUAL_PROVIDER = {
  id: MANUAL_SERVER_ACCESS_PROVIDER_ID,
  displayName: "Manual",
  description: "Use your own domain or network address.",
  pluginId: null,
  routeKind: "custom",
  record: null,
} satisfies ServerAccessProviderEntry;

export function serverRoutesEnabled(deps: Pick<Dependencies, "db">): boolean {
  return getExperiments(deps.db).serverRoutes;
}

export function orderedServerAccessProviders(
  deps: Pick<Dependencies, "db">,
): ServerAccessProviderEntry[] {
  const routesEnabled = serverRoutesEnabled(deps);
  const registered: ServerAccessProviderEntry[] = [
    ...(routesEnabled ? [LOCAL_NETWORK_PROVIDER] : []),
    ...listServerAccessProviders().map((record) => ({
      id: record.provider.id,
      displayName: record.provider.displayName,
      description: record.provider.description,
      pluginId: record.pluginId,
      routeKind: record.provider.routeKind,
      record,
    })),
    MANUAL_PROVIDER,
  ];
  const userOrder = getAppSettings(deps.db).serverAccessOrder;
  const position = (id: string) => {
    const index = userOrder.indexOf(id);
    return index === -1 ? userOrder.length : index;
  };
  const kindRank = (entry: ServerAccessProviderEntry) =>
    routesEnabled ? ROUTE_KIND_RANK[entry.routeKind] : 0;
  return registered
    .map((entry, registration) => ({ entry, registration }))
    .sort(
      (left, right) =>
        position(left.entry.id) - position(right.entry.id) ||
        kindRank(left.entry) - kindRank(right.entry) ||
        left.registration - right.registration,
    )
    .map(({ entry }) => entry);
}

export function isLocalNetworkOn(deps: Pick<Dependencies, "db">): boolean {
  return (
    serverRoutesEnabled(deps) &&
    getAppSettings(deps.db).localNetworkEnabled &&
    getExperiments(deps.db).requireSignIn
  );
}

async function providerAvailability(
  deps: Pick<Dependencies, "db">,
  entry: ServerAccessProviderEntry,
): Promise<ProviderAvailability> {
  if (entry.id === LOCAL_NETWORK_SERVER_ACCESS_PROVIDER_ID) {
    const state = localNetworkState();
    if (!isLocalNetworkOn(deps)) {
      return {
        availability: {
          status: "setup-required",
          message: getAppSettings(deps.db).localNetworkEnabled
            ? "Turn on Require sign-in in Settings → Devices (or run `bb access require-sign-in on`) so bb opens to this network only for signed-in devices"
            : "Add it to let devices on this network reach bb",
        },
        urls: [],
        answered: true,
      };
    }
    const first = state.urls[0];
    if (first === undefined) {
      return {
        availability: {
          status: "unavailable",
          message:
            state.listenerError ??
            "This computer has no private local network address",
        },
        urls: [],
        answered: true,
      };
    }
    return {
      availability: { status: "available", serverUrl: first },
      urls: state.urls,
      answered: true,
    };
  }
  if (entry.record === null) {
    const { url } = machineServerUrl(deps);
    return url === null
      ? {
          availability: {
            status: "setup-required",
            message: "Set a server URL reachable by machines",
          },
          urls: [],
          answered: true,
        }
      : {
          availability: { status: "available", serverUrl: url },
          urls: [url],
          answered: true,
        };
  }
  const record = entry.record;
  const result = await decideWithinBox(
    () =>
      invokeServerAccessProvider(record, async () =>
        record.provider.availability(),
      ),
    AVAILABILITY_TIMEOUT_MS,
  );
  const parsed = result.ok ? availabilitySchema.safeParse(result.value) : null;
  if (!parsed?.success) {
    return {
      availability: {
        status: "unavailable",
        message:
          "Could not check machine access. Try again or check the provider's configuration.",
      },
      urls: [],
      answered: false,
    };
  }
  const availability = parsed.data;
  return {
    availability,
    urls:
      availability.status === "available" &&
      availability.serverUrl !== undefined
        ? [availability.serverUrl.replace(/\/$/u, "")]
        : [],
    answered: true,
  };
}

export interface ServerAccessOverview {
  serverId: string;
  routes: ServerRoute[];
  status: ServerAccessStatus;
}

let latestOverviewRun = 0;
let appliedOverviewRun = 0;

export async function serverAccessOverview(
  deps: Dependencies,
): Promise<ServerAccessOverview> {
  const run = ++latestOverviewRun;
  const entries = orderedServerAccessProviders(deps);
  const checked = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      ...(await providerAvailability(deps, entry)),
    })),
  );
  const advertising = serverRoutesEnabled(deps);
  const routes = checked.flatMap(({ entry, availability, urls }) =>
    advertising && availability.status === "available"
      ? urls.map((url) => ({
          providerId: entry.id,
          kind: entry.routeKind,
          displayName: entry.displayName,
          url,
        }))
      : [],
  );
  if (run > appliedOverviewRun) {
    appliedOverviewRun = run;
    admitRouteOrigins(deps, advertising, checked);
  }
  const direct = machineServerUrl(deps);
  const local = localNetworkState();
  return {
    serverId: getOrCreateServerId(deps.db),
    routes,
    status: {
      providers: checked.map(({ entry, availability, urls }) => ({
        id: entry.id,
        displayName: entry.displayName,
        description: entry.description,
        pluginId: entry.pluginId,
        routeKind: entry.routeKind,
        availability,
        urls,
      })),
      effectiveUrl: direct.url,
      urlSource: direct.source,
      localNetwork: {
        bindHost: local.bindHost,
        addresses: local.addresses,
        listenerError: local.listenerError,
      },
    },
  };
}

function admitRouteOrigins(
  deps: Dependencies,
  advertising: boolean,
  checked: ReadonlyArray<
    ProviderAvailability & {
      entry: ServerAccessProviderEntry;
    }
  >,
): void {
  const previous = admittedServerAccessOrigins();
  const next: ServerAccessOrigin[] = [];
  for (const { entry, availability, urls, answered } of checked) {
    if (!advertising && entry.record === null) continue;
    if (!answered) {
      next.push(...previous.filter((origin) => origin.providerId === entry.id));
      continue;
    }
    if (availability.status !== "available") continue;
    for (const url of urls) {
      const origin = new URL(url).origin;
      if (next.some((admitted) => admitted.origin === origin)) continue;
      next.push({ providerId: entry.id, pluginId: entry.pluginId, origin });
    }
  }
  for (const admitted of previous) {
    if (checked.some(({ entry }) => entry.id === admitted.providerId)) {
      continue;
    }
    if (
      admitted.pluginId !== null &&
      getInstalledPlugin(deps.db, admitted.pluginId)?.enabled === true
    ) {
      next.push(admitted);
    }
  }
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  setAdmittedServerAccessOrigins(next);
  setServerAccessOrigins(deps.db, next);
}

export function restoreServerAccessOrigins(deps: Pick<Dependencies, "db">) {
  setAdmittedServerAccessOrigins(getServerAccessOrigins(deps.db));
}

let originRefresh: Promise<void> | null = null;
let originRefreshRequested = false;

export function refreshServerAccessOrigins(deps: Dependencies): void {
  if (originRefresh !== null) {
    originRefreshRequested = true;
    return;
  }
  originRefresh = serverAccessOverview(deps)
    .then(
      () => undefined,
      (error: unknown) => {
        deps.logger.warn(
          { err: error },
          "Could not refresh the server access route addresses",
        );
      },
    )
    .finally(() => {
      originRefresh = null;
      if (!originRefreshRequested) return;
      originRefreshRequested = false;
      refreshServerAccessOrigins(deps);
    });
}

export async function serverAccessStatus(
  deps: Dependencies,
): Promise<ServerAccessStatus> {
  return (await serverAccessOverview(deps)).status;
}

function acquisitionKey(
  host: NonNullable<ReturnType<typeof getHost>>,
  fallback: string,
): string {
  const owner =
    host.machineProviderId === null
      ? null
      : (getMachineProvider(host.machineProviderId)?.pluginId ?? null);
  return owner !== null && host.launchKey !== null
    ? JSON.stringify([owner, host.launchKey])
    : fallback;
}

function abortable<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  let onAbort: (() => void) | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }),
  ]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

async function acquireGrant(
  deps: Dependencies,
  args: {
    entry: ServerAccessProviderEntry;
    key: string;
    hostId: string;
    signal: AbortSignal;
    recordFailure: boolean;
  },
): Promise<ServerAccessGrant> {
  const { entry } = args;
  args.signal.throwIfAborted();
  const host = getHost(deps.db, args.hostId);
  if (!host || host.destroyedAt !== null)
    throw new Error("Machine identity is unavailable");
  const previous = getHostServerAccessGrant(deps.db, {
    hostId: args.hostId,
    providerId: entry.id,
  });
  let grant: ServerAccessGrant;
  if (entry.record === null) {
    const { availability } = await providerAvailability(deps, entry);
    if (availability.status !== "available")
      throw new Error(availability.message);
    if (availability.serverUrl === undefined)
      throw new Error("Server access provider is unavailable");
    grant = { id: args.hostId, serverUrl: availability.serverUrl };
  } else {
    const record = entry.record;
    let availability: z.infer<typeof availabilitySchema>;
    try {
      availability = availabilitySchema.parse(
        await abortable(
          args.signal,
          invokeServerAccessProvider(record, async () =>
            record.provider.availability(),
          ),
        ),
      );
    } catch {
      args.signal.throwIfAborted();
      throw new Error("Server access provider is unavailable");
    }
    args.signal.throwIfAborted();
    if (availability.status !== "available") {
      throw new Error(availability.message);
    }
    if (previous === null) {
      upsertHostServerAccessGrant(deps.db, {
        hostId: args.hostId,
        providerId: entry.id,
        grantId: null,
      });
    }
    try {
      const result = await invokeServerAccessProvider(record, () =>
        record.provider.acquire({
          key: acquisitionKey(host, args.key),
          hostId: args.hostId,
          signal: args.signal,
        }),
      );
      const parsed = acquireResultSchema.safeParse(result);
      if (!parsed.success)
        throw new Error("Server access provider returned an invalid grant");
      if ("status" in parsed.data) throw new Error(parsed.data.message);
      grant = parsed.data;
    } catch (error) {
      if (args.recordFailure) {
        setHostColumns(deps.db, args.hostId, {
          statusMessage: error instanceof Error ? error.message : String(error),
        });
        deps.hub.notifyHost(args.hostId, ["host-connected"]);
      }
      throw error;
    }
  }
  if (
    previous !== null &&
    previous.grantId !== null &&
    previous.grantId !== grant.id
  ) {
    throw new Error("Server access provider changed its grant identity");
  }
  upsertHostServerAccessGrant(deps.db, {
    hostId: args.hostId,
    providerId: entry.id,
    grantId: grant.id,
  });
  args.signal.throwIfAborted();
  return grant;
}

function anchorCandidates(
  deps: Dependencies,
  host: NonNullable<ReturnType<typeof getHost>>,
): ServerAccessProviderEntry[] {
  const entries = orderedServerAccessProviders(deps);
  const pinned =
    host.serverAccessProviderId === null
      ? undefined
      : entries.find((entry) => entry.id === host.serverAccessProviderId);
  if (pinned !== undefined) return [pinned];
  return [
    ...entries.filter((entry) => entry.routeKind !== "local-network"),
    ...entries.filter((entry) => entry.routeKind === "local-network"),
  ];
}

async function resolve(
  deps: Dependencies,
  args: {
    key: string;
    hostId: string;
    signal: AbortSignal;
  },
): Promise<ServerAccessGrant> {
  args.signal.throwIfAborted();
  const host = getHost(deps.db, args.hostId);
  if (!host || host.destroyedAt !== null)
    throw new Error("Machine identity is unavailable");
  const candidates = anchorCandidates(deps, host);
  let firstError: unknown = null;
  for (const entry of candidates) {
    try {
      const grant = await acquireGrant(deps, {
        entry,
        key: args.key,
        hostId: args.hostId,
        signal: args.signal,
        recordFailure: true,
      });
      setHostColumns(deps.db, args.hostId, {
        serverAccessProviderId: entry.id,
        serverAccessGrantId: grant.id,
        statusMessage: null,
      });
      return grant;
    } catch (error) {
      args.signal.throwIfAborted();
      firstError ??= error;
    }
  }
  throw firstError instanceof Error
    ? firstError
    : new Error("Server access provider is unavailable");
}

async function releaseGrant(
  deps: Dependencies,
  host: NonNullable<ReturnType<typeof getHost>>,
  args: { key: string; providerId: string; grantId: string | null },
  purpose: "remove" | "repair",
): Promise<void> {
  const record = listServerAccessProviders().find(
    (entry) => entry.provider.id === args.providerId,
  );
  const core =
    args.providerId === LOCAL_NETWORK_SERVER_ACCESS_PROVIDER_ID ||
    args.providerId === MANUAL_SERVER_ACCESS_PROVIDER_ID;
  if (!core && !record) {
    if (purpose === "repair")
      throw new Error("Server access provider is unavailable");
    deps.logger.warn(
      { hostId: host.id, providerId: args.providerId },
      "Server access provider is not installed; skipping release during machine removal",
    );
  } else if (record) {
    await invokeServerAccessProvider(record, () =>
      record.provider.release({
        key: acquisitionKey(host, args.key),
        grantId: args.grantId,
        hostId: host.id,
      }),
    );
  }
  deleteHostServerAccessGrant(deps.db, {
    hostId: host.id,
    providerId: args.providerId,
  });
}

async function release(
  deps: Dependencies,
  args: { key: string; hostId: string },
): Promise<void> {
  const host = getHost(deps.db, args.hostId);
  if (!host) return;
  for (const grant of listHostServerAccessGrants(deps.db, host.id)) {
    await releaseGrant(
      deps,
      host,
      { key: args.key, providerId: grant.providerId, grantId: grant.grantId },
      "remove",
    );
  }
  setHostColumns(deps.db, args.hostId, {
    serverAccessProviderId: null,
    serverAccessGrantId: null,
  });
}

async function repair(
  deps: Dependencies,
  args: { key: string; hostId: string; signal: AbortSignal },
): Promise<ServerAccessGrant> {
  args.signal.throwIfAborted();
  const host = getHost(deps.db, args.hostId);
  if (!host || host.destroyedAt !== null)
    throw new Error("Machine identity is unavailable");
  const providerId = host.serverAccessProviderId;
  const grant =
    providerId === null
      ? null
      : getHostServerAccessGrant(deps.db, { hostId: host.id, providerId });
  if (providerId !== null && grant !== null) {
    await releaseGrant(
      deps,
      host,
      { key: args.key, providerId, grantId: grant.grantId },
      "repair",
    );
  }
  return resolve(deps, args);
}

export interface HostRoutesOptions {
  hostId: string;
  signal: AbortSignal;
  onLateRoutes?: (routes: HostDaemonServerRoutes) => void;
  providerDeadlineMs?: number;
}

export async function routesForHost(
  deps: Dependencies,
  options: HostRoutesOptions,
): Promise<HostDaemonServerRoutes> {
  const serverId = getOrCreateServerId(deps.db);
  if (!serverRoutesEnabled(deps)) return { serverId, routes: [] };
  const entries = orderedServerAccessProviders(deps);
  const perProvider = entries.map(async (entry) => {
    if (entry.record === null) {
      const { availability, urls } = await providerAvailability(deps, entry);
      return availability.status === "available"
        ? urls.map((url): HostDaemonServerRoute => ({
            providerId: entry.id,
            kind: entry.routeKind,
            url,
            headers: {},
          }))
        : [];
    }
    try {
      const grant = await acquireGrant(deps, {
        entry,
        key: options.hostId,
        hostId: options.hostId,
        signal: options.signal,
        recordFailure: false,
      });
      return [
        {
          providerId: entry.id,
          kind: entry.routeKind,
          url: grant.serverUrl.replace(/\/$/u, ""),
          headers: grant.headers ?? {},
        },
      ];
    } catch (error) {
      deps.logger.info(
        {
          hostId: options.hostId,
          providerId: entry.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Server route is unavailable for this machine",
      );
      return [];
    }
  });
  const all = Promise.all(perProvider).then((groups) => ({
    serverId,
    routes: groups.flat(),
  }));
  if (options.providerDeadlineMs === undefined) return all;
  const deadline = options.providerDeadlineMs;
  const settled = await Promise.all(
    perProvider.map((work) =>
      decideWithinBox(() => work, deadline).then((result) =>
        result.ok ? result.value : null,
      ),
    ),
  );
  if (settled.some((group) => group === null)) {
    void all.then(
      (routes) => options.onLateRoutes?.(routes),
      () => undefined,
    );
  }
  return {
    serverId,
    routes: settled.flatMap((group) => group ?? []),
  };
}

export function serverAccessProviderDisplayName(
  providerId: string,
): string | null {
  if (providerId === LOCAL_NETWORK_SERVER_ACCESS_PROVIDER_ID)
    return LOCAL_NETWORK_PROVIDER.displayName;
  if (providerId === MANUAL_SERVER_ACCESS_PROVIDER_ID)
    return MANUAL_PROVIDER.displayName;
  return (
    listServerAccessProviders().find(
      (record) => record.provider.id === providerId,
    )?.provider.displayName ?? null
  );
}

export function serverAccessProviderForKind(
  deps: Pick<Dependencies, "db">,
  kind: ServerRouteKind,
): { providerId: string; kind: ServerRouteKind } | null {
  const entry = orderedServerAccessProviders(deps).find(
    (candidate) =>
      candidate.routeKind === kind &&
      (candidate.id !== LOCAL_NETWORK_SERVER_ACCESS_PROVIDER_ID ||
        isLocalNetworkOn(deps)),
  );
  return entry === undefined ? null : { providerId: entry.id, kind };
}

export const serverAccess = { resolve, release, repair };
