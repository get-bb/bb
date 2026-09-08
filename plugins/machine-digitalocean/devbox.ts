import { z } from "zod";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import type { Vendor } from "./vendor.js";
import { snapshotSchema } from "./snapshot.js";

export const BILLING =
  "Estimate: powered-off droplets still bill; snapshot storage bills per GB";
export const PRICING =
  "https://docs.digitalocean.com/products/droplets/details/pricing/";
export const scheduleSchema = z
  .object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    sleep: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    wake: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA timezone"),
  })
  .strict()
  .refine((value) => value.sleep !== value.wake, "Sleep and wake must differ");
export const configSchema = z
  .object({
    idleMinutes: z.number().int().min(1).max(43_200).nullable().default(null),
    retention: z.number().int().min(1).max(100).default(2),
    schedule: scheduleSchema.nullable().default(null),
  })
  .strict();
export type DevboxConfig = z.infer<typeof configSchema>;
const stateSchema = z.object({
  config: configSchema,
  snapshots: z.array(snapshotSchema),
  pendingSnapshot: z.string().nullable(),
  backupStatus: z.enum(["none", "complete", "off, backup failed"]),
  backupError: z.string().nullable(),
  power: z.enum(["active", "off"]),
  powerSince: z.number(),
  runningMs: z.number().nonnegative(),
  offMs: z.number().nonnegative(),
  scheduleCursor: z.number(),
  scheduleError: z.string().nullable(),
});
export type DevboxState = z.infer<typeof stateSchema>;

export function createDevboxStore(
  kv: PluginKvStorage,
  now: () => number = Date.now,
) {
  const pending = new Map<string, Promise<void>>();
  return {
    async exclusive<T>(hostId: string, run: () => Promise<T>): Promise<T> {
      const previous = pending.get(hostId) ?? Promise.resolve();
      let release = () => {};
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      pending.set(hostId, done);
      await previous;
      try {
        return await run();
      } finally {
        release();
        if (pending.get(hostId) === done) pending.delete(hostId);
      }
    },
    async get(hostId: string): Promise<DevboxState> {
      const stored = await kv.get<unknown>(`devbox/${hostId}`);
      return stored === undefined
        ? {
            config: configSchema.parse({}),
            snapshots: [],
            pendingSnapshot: null,
            backupStatus: "none",
            backupError: null,
            power: "active",
            powerSince: now(),
            runningMs: 0,
            offMs: 0,
            scheduleCursor: now(),
            scheduleError: null,
          }
        : stateSchema.parse(stored);
    },
    async set(hostId: string, value: DevboxState) {
      await kv.set(`devbox/${hostId}`, stateSchema.parse(value));
    },
    async hosts() {
      return (await kv.list("devbox/")).map((key) => key.slice(7));
    },
    async delete(hostId: string) {
      await kv.delete(`devbox/${hostId}`);
    },
  };
}
export type DevboxStore = ReturnType<typeof createDevboxStore>;

export function recordPower(
  state: DevboxState,
  power: "active" | "off",
  now: number,
) {
  if (state.power === power) return;
  const elapsed = Math.max(0, now - state.powerSince);
  if (state.power === "active") state.runningMs += elapsed;
  else state.offMs += elapsed;
  state.power = power;
  state.powerSince = now;
}

export async function sleepWithBackup(args: {
  hostId: string;
  dropletId: number;
  api: Vendor;
  store: DevboxStore;
  signal: AbortSignal;
  now: () => number;
}) {
  const { hostId, dropletId, api, store, signal, now } = args;
  const state = await store.get(hostId);
  const droplet = await api.get(dropletId, signal);
  if (!droplet) throw new Error("DigitalOcean Droplet no longer exists.");
  const wasOff = droplet.status === "off";
  if (!wasOff) await api.power(dropletId, "shutdown", signal);
  const off = await api.get(dropletId, signal);
  if (off?.status !== "off")
    throw new Error(
      "DigitalOcean graceful shutdown did not leave the Droplet off.",
    );
  recordPower(state, "off", now());
  await store.set(hostId, state);
  if (
    wasOff &&
    state.backupStatus === "complete" &&
    state.pendingSnapshot === null
  )
    return state;
  state.pendingSnapshot ??= `bb-devbox-${hostId}-${now()}`;
  await store.set(hostId, state);
  try {
    let snapshot = (await api.snapshots(signal)).find(
      (item) =>
        item.name === state.pendingSnapshot &&
        item.resource_id === String(dropletId),
    );
    if (!snapshot) {
      await api.snapshot(dropletId, state.pendingSnapshot, signal);
      snapshot = (await api.snapshots(signal)).find(
        (item) =>
          item.name === state.pendingSnapshot &&
          item.resource_id === String(dropletId),
      );
    }
    if (!snapshot)
      throw new Error(
        "Completed snapshot is not visible in inventory; retry reconciliation.",
      );
    state.snapshots = [
      ...state.snapshots.filter((item) => item.id !== snapshot.id),
      snapshot,
    ];
    state.pendingSnapshot = null;
    state.backupStatus = "complete";
    state.backupError = null;
    await store.set(hostId, state);
  } catch {
    state.backupStatus = "off, backup failed";
    state.backupError =
      "Snapshot submission or inventory reconciliation failed. Previous backups retained; retry sleep after waking.";
    await store.set(hostId, state);
    return state;
  }
  try {
    await pruneSnapshots({ ...args, keep: state.config.retention });
  } catch {
    const current = await store.get(hostId);
    current.backupError =
      "Backup complete; retention cleanup failed. Older backups retained; retry cleanup on next sleep.";
    await store.set(hostId, current);
  }
  return store.get(hostId);
}

export async function pruneSnapshots({
  hostId,
  dropletId,
  api,
  store,
  signal,
  keep,
}: {
  hostId: string;
  dropletId: number;
  api: Vendor;
  store: DevboxStore;
  signal: AbortSignal;
  keep: number;
}) {
  const state = await store.get(hostId);
  const inventory = await api.snapshots(signal);
  const owned = inventory
    .filter(
      (item) =>
        item.resource_id === String(dropletId) &&
        item.name.startsWith(`bb-devbox-${hostId}-`),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
  for (const snapshot of owned.slice(keep)) {
    await api.deleteSnapshot(snapshot.id, signal);
    state.snapshots = state.snapshots.filter((item) => item.id !== snapshot.id);
    await store.set(hostId, state);
  }
}

export function latestScheduledAction(
  schedule: NonNullable<DevboxConfig["schedule"]>,
  after: number,
  now: number,
): { at: number; action: "sleep" | "wake" } | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const lower = Math.max(after, now - 8 * 86_400_000);
  for (let at = Math.floor(now / 60_000) * 60_000; at > lower; at -= 60_000) {
    const parts = formatter.formatToParts(at);
    const part = (key: string) =>
      parts.find((item) => item.type === key)?.value;
    if (!schedule.weekdays.includes(days.indexOf(part("weekday") ?? "")))
      continue;
    const time = `${part("hour")}:${part("minute")}`;
    if (time === schedule.sleep || time === schedule.wake)
      return { at, action: time === schedule.sleep ? "sleep" : "wake" };
  }
  return null;
}

export function computeCost(
  inventory: Awaited<ReturnType<Vendor["inventory"]>>,
  state: DevboxState,
  hostId: string,
  now: number,
) {
  const droplet = inventory.droplet;
  const size = inventory.sizes.find((item) => item.slug === droplet?.size_slug);
  if (droplet && !size)
    throw new Error("DigitalOcean size rate is unavailable.");
  const snapshots = inventory.snapshots.filter(
    (item) =>
      item.resource_id === String(droplet?.id) ||
      item.name.startsWith(`bb-devbox-${hostId}-`),
  );
  const snapshotGb = snapshots.reduce(
    (sum, item) => sum + item.size_gigabytes,
    0,
  );
  const unassignedReservedIps = inventory.reservedIps
    .filter((ip) => ip.droplet === null)
    .map((ip) => ip.ip);
  const elapsed = Math.max(0, now - state.powerSince);
  const hours = droplet
    ? Math.max(0, now - Date.parse(droplet.created_at)) / 3_600_000
    : 0;
  return {
    label: BILLING,
    pricingUrl: PRICING,
    snapshotPricingUrl:
      "https://docs.digitalocean.com/products/snapshots/details/pricing/",
    reservedIpPricingUrl:
      "https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/",
    observedAt: new Date(now).toISOString(),
    currency: "USD",
    dropletStatus: droplet?.status ?? "absent",
    runningHoursObserved:
      (state.runningMs + (state.power === "active" ? elapsed : 0)) / 3_600_000,
    offHoursObserved:
      (state.offMs + (state.power === "off" ? elapsed : 0)) / 3_600_000,
    dropletHourly: size?.price_hourly ?? 0,
    dropletMonthlyCap: size?.price_monthly ?? 0,
    dropletAccruedEstimate: size
      ? Math.min(
          Math.max(0.01, size.price_hourly * Math.max(hours, 1 / 60)),
          size.price_monthly * Math.max(1, Math.ceil(hours / 672)),
        )
      : 0,
    snapshotGb,
    snapshotMonthlyEstimate: snapshotGb * 0.06,
    unassignedReservedIps,
    accountUnassignedIpMonthlyEstimate: unassignedReservedIps.length * 5,
    monthlyEstimate: (size?.price_monthly ?? 0) + snapshotGb * 0.06,
    exclusions:
      "Taxes, bandwidth, volumes, credits; unassigned reserved IPs are account-wide and listed separately. Observed running/off time begins at plugin enrollment; powered-off compute bills at the same rate. Accrued compute is an approximation across billing months.",
  };
}
