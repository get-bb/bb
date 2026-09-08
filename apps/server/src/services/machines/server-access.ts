import { getAppSettings, getHost, hosts, machineEnrollments } from "@bb/db";
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

type Dependencies = Pick<WorkSessionDeps, "db" | "hub">;

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
const availabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available") }),
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
  const providers = await Promise.all(
    listServerAccessProviders().map(async (record) => {
      try {
        const availability = availabilitySchema.parse(
          await invokeServerAccessProvider(record, async () =>
            record.provider.availability(),
          ),
        );
        const attention = record.provider.experimental_attention
          ? await invokeServerAccessProvider(record, async () =>
              record.provider.experimental_attention!(),
            )
              .then((value) => z.string().nullable().parse(value))
              .catch(() => "Access diagnostics are unavailable")
          : null;
        return {
          attention,
          id: record.provider.id,
          displayName: record.provider.displayName,
          availability,
        };
      } catch {
        return {
          attention: null,
          id: record.provider.id,
          displayName: record.provider.displayName,
          availability: {
            status: "unavailable" as const,
            message: "Server access provider is unavailable",
          },
        };
      }
    }),
  );
  providers.push({
    attention: null,
    id: "direct",
    displayName: "Manual",
    availability:
      direct.url === null
        ? {
            status: "setup-required",
            message: "Set a server URL reachable by machines",
          }
        : { status: "available" },
  });
  const configured = getAppSettings(deps.db).defaultMachineAccess;
  const defaultProviderId = configured ?? "connect";
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
  const available = status.providers.find((entry) => entry.id === providerId);
  if (!available || available.availability.status !== "available") {
    throw new Error(
      (available?.availability.status !== "available" &&
        available?.availability.message) ||
        "Configure default machine access in Machines settings",
    );
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
    deps.db
      .update(hosts)
      .set({ serverAccessProviderId: providerId })
      .where(eq(hosts.id, args.hostId))
      .run();
    let result: ServerAccessGrant;
    try {
      result = await invokeServerAccessProvider(record, () =>
        record.provider.acquire(args),
      );
    } catch (error) {
      deps.db
        .update(hosts)
        .set({
          teardownMessage:
            error instanceof Error ? error.message : String(error),
        })
        .where(eq(hosts.id, args.hostId))
        .run();
      deps.hub.notifyHost(args.hostId, ["host-connected"]);
      throw error;
    }
    const parsed = grantSchema.safeParse(result);
    if (!parsed.success)
      throw new Error("Server access provider returned an invalid grant");
    grant = parsed.data;
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
      teardownMessage: null,
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
  const enrollment = deps.db
    .select({ owner: machineEnrollments.owner, key: machineEnrollments.key })
    .from(machineEnrollments)
    .where(eq(machineEnrollments.hostId, args.hostId))
    .get();
  const acquisitionKey = enrollment
    ? JSON.stringify([enrollment.owner, enrollment.key])
    : args.key;
  const host = getHost(deps.db, args.hostId);
  if (!host) return;
  const providerId =
    host.serverAccessProviderId ??
    (host.machineProviderId === "manual" && host.connectMachineId !== null
      ? "connect"
      : null);
  const grantId =
    host.serverAccessGrantId ??
    (host.connectMachineId === null ? null : host.id);
  if (providerId === null) return;
  if (providerId !== "direct") {
    const record = listServerAccessProviders().find(
      (entry) => entry.provider.id === providerId,
    );
    if (!record)
      throw new Error("Server access provider is unavailable for cleanup");
    await invokeServerAccessProvider(record, () =>
      record.provider.release({
        key: acquisitionKey,
        grantId,
        hostId: args.hostId,
      }),
    );
  }
  deps.db
    .update(hosts)
    .set({ serverAccessProviderId: null, serverAccessGrantId: null })
    .where(eq(hosts.id, args.hostId))
    .run();
}

export const serverAccess = { resolve, release };
