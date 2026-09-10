import { getAppSettings, getHost, hosts } from "@bb/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type {
  ServerAccessGrant,
  ServerAccessSelection,
} from "@get-bb/plugin-sdk";
import type { WorkSessionDeps } from "../../types.js";
import {
  invokeServerAccessProvider,
  listServerAccessProviders,
} from "../plugins/plugin-server-access-registry.js";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";

type Dependencies = Pick<WorkSessionDeps, "db" | "hub" | "logger">;

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

export function machineServerUrl(deps: Dependencies) {
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

export async function serverAccessStatus(deps: Dependencies) {
  const direct = machineServerUrl(deps);
  const records = listServerAccessProviders();
  const providers: Array<{
    id: string;
    displayName: string;
    description: string;
    pluginId: string | null;
  }> = records.map((record) => ({
    id: record.provider.id,
    displayName: record.provider.displayName,
    description: record.provider.description,
    pluginId: record.pluginId,
  }));
  providers.push({
    id: "direct",
    displayName: "Manual",
    description: "Use your own domain or network address.",
    pluginId: null,
  });
  const configured = getAppSettings(deps.db).defaultMachineAccess;
  const defaultProviderId = configured ?? records[0]?.provider.id ?? "direct";
  return {
    providers,
    defaultProviderId,
    effectiveUrl: direct.url,
    urlSource: direct.source,
  };
}

async function resolve(
  deps: Dependencies,
  args: {
    key: string;
    hostId: string;
    access?: ServerAccessSelection;
    signal: AbortSignal;
  },
): Promise<ServerAccessGrant> {
  args.signal.throwIfAborted();
  const host = getHost(deps.db, args.hostId);
  if (!host || host.destroyedAt !== null)
    throw new Error("Machine identity is unavailable");
  const status = await serverAccessStatus(deps);
  const providerId =
    host.serverAccessProviderId ??
    args.access?.providerId ??
    status.defaultProviderId;
  if (
    args.access &&
    host.serverAccessProviderId &&
    args.access.providerId !== host.serverAccessProviderId
  ) {
    throw new Error("Machine already has a different server access provider");
  }
  let grant: ServerAccessGrant;
  if (providerId === "direct") {
    const serverUrl = status.effectiveUrl;
    if (serverUrl === null)
      throw new Error("Set a server URL reachable by machines");
    grant = { id: args.hostId, serverUrl };
  } else {
    const record = listServerAccessProviders().find(
      (entry) => entry.provider.id === providerId,
    );
    if (!record) throw new Error("Server access provider is unavailable");
    let availability: z.infer<typeof availabilitySchema>;
    try {
      availability = availabilitySchema.parse(
        await invokeServerAccessProvider(record, async () =>
          record.provider.availability(),
        ),
      );
    } catch {
      throw new Error("Server access provider is unavailable");
    }
    if (availability.status !== "available") {
      throw new Error(availability.message);
    }
    deps.db
      .update(hosts)
      .set({ serverAccessProviderId: providerId })
      .where(eq(hosts.id, args.hostId))
      .run();
    let result: unknown;
    try {
      result = await invokeServerAccessProvider(record, () =>
        record.provider.acquire(args),
      );
      const parsed = acquireResultSchema.safeParse(result);
      if (!parsed.success)
        throw new Error("Server access provider returned an invalid grant");
      if ("status" in parsed.data) throw new Error(parsed.data.message);
      grant = parsed.data;
    } catch (error) {
      deps.db
        .update(hosts)
        .set({
          statusMessage: error instanceof Error ? error.message : String(error),
        })
        .where(eq(hosts.id, args.hostId))
        .run();
      deps.hub.notifyHost(args.hostId, ["host-connected"]);
      throw error;
    }
  }
  if (
    host.serverAccessGrantId !== null &&
    host.serverAccessGrantId !== grant.id
  ) {
    throw new Error("Server access provider changed its grant identity");
  }
  deps.db
    .update(hosts)
    .set({
      serverAccessProviderId: providerId,
      serverAccessGrantId: grant.id,
      statusMessage: null,
    })
    .where(eq(hosts.id, args.hostId))
    .run();
  args.signal.throwIfAborted();
  return grant;
}

async function release(
  deps: Dependencies,
  args: { key: string; hostId: string },
) {
  const host = getHost(deps.db, args.hostId);
  if (!host) return;
  const owner =
    host.machineProviderId === null
      ? null
      : (getMachineProvider(host.machineProviderId)?.pluginId ?? null);
  const acquisitionKey =
    owner !== null && host.launchKey !== null
      ? JSON.stringify([owner, host.launchKey])
      : args.key;
  const providerId = host.serverAccessProviderId;
  const grantId = host.serverAccessGrantId;
  if (providerId === null) return;
  if (providerId !== "direct") {
    const record = listServerAccessProviders().find(
      (entry) => entry.provider.id === providerId,
    );
    if (!record) {
      deps.logger.warn(
        { hostId: args.hostId, providerId },
        "Server access provider is not installed; skipping release during machine removal",
      );
    } else {
      await invokeServerAccessProvider(record, () =>
        record.provider.release({
          key: acquisitionKey,
          grantId,
          hostId: args.hostId,
        }),
      );
    }
  }
  deps.db
    .update(hosts)
    .set({ serverAccessProviderId: null, serverAccessGrantId: null })
    .where(eq(hosts.id, args.hostId))
    .run();
}

export const serverAccess = { resolve, release };
