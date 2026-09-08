import { cacheVendorInventory } from "./inventory-cache.js";
import { devboxRpc, hostInput } from "./rpc.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { cloudInit } from "./cloud-init.js";
import { inputsSchema } from "./inputs.js";
import {
  BILLING,
  PRICING,
  configSchema,
  createDevboxStore,
  computeCost,
  latestScheduledAction,
  pruneSnapshots,
  recordPower,
  invalidatePendingSnapshot,
  sleepWithBackup,
} from "./devbox.js";
import {
  allocationName,
  createVendor,
  VendorError,
  type Droplet,
  type Vendor,
} from "./vendor.js";

const resourceSchema = z
  .object({
    version: z.literal(1),
    key: z.string().min(1),
    dropletId: z.number().int().positive(),
    enrollmentId: z.string().min(1),
  })
  .strict();
const intentSchema = z
  .object({ dropletId: z.number().int().positive().nullable() })
  .strict();
const WAIT_MS = 600_000;
class AllocationError extends Error {}

export function createDigitalOceanPlugin(deps: {
  vendor: (token: string) => Vendor;
  sleep: (signal: AbortSignal) => Promise<void>;
  now?: () => number;
}) {
  return async (bb: BbPluginApi) => {
    const now = deps.now ?? Date.now;
    const store = createDevboxStore(bb.storage.kv, now);
    const settings = bb.settings.define({
      snapshotRetention: {
        type: "number",
        default: 2,
        label: "Snapshots to retain (1–100); snapshot storage bills per GB",
      },
      DIGITALOCEAN_TOKEN: {
        type: "string",
        secret: true,
        label: "DigitalOcean API token",
      },
    });
    let client: { token: string; api: Vendor } | null = null;
    async function vendor() {
      const token = (await settings.get()).DIGITALOCEAN_TOKEN?.trim();
      if (!token)
        throw new AllocationError(
          "Configure the DIGITALOCEAN_TOKEN plugin setting.",
        );
      if (client?.token !== token)
        client = { token, api: cacheVendorInventory(deps.vendor(token), now) };
      return client.api;
    }
    async function owned(
      api: Vendor,
      id: number,
      key: string,
      signal: AbortSignal,
    ) {
      const droplet = await api.get(id, signal);
      const name = allocationName(key);
      if (
        droplet !== null &&
        (droplet.name !== name || !droplet.tags.includes(name))
      ) {
        throw new AllocationError(
          "DigitalOcean allocation ownership does not match.",
        );
      }
      return droplet;
    }
    async function active(api: Vendor, droplet: Droplet, signal: AbortSignal) {
      while (droplet.status !== "active") {
        if (droplet.status !== "new")
          throw new AllocationError(
            "DigitalOcean Droplet is not booting or active.",
          );
        await deps.sleep(signal);
        const next = await api.get(droplet.id, signal);
        if (next === null)
          throw new AllocationError(
            "DigitalOcean Droplet disappeared during creation.",
          );
        droplet = next;
      }
    }
    async function machine(hostId: string) {
      const host = await bb.sdk.hosts.get({ hostId });
      if (host.machineProviderId !== "digitalocean")
        throw new Error("Select a DigitalOcean machine.");
      let stored = await bb.storage.kv.get<unknown>(`resource/${hostId}`);
      if (stored === undefined) {
        await bb.sdk.hosts.experimental_providerDetails({ hostId });
        stored = await bb.storage.kv.get<unknown>(`resource/${hostId}`);
      }
      return { host, resource: resourceSchema.parse(stored) };
    }
    async function details(
      hostId: string,
      resource: z.infer<typeof resourceSchema>,
      signal: AbortSignal,
    ) {
      await bb.storage.kv.set(`resource/${hostId}`, resource);
      if (
        (await bb.storage.kv.get<unknown>(`devbox/${hostId}`)) === undefined
      ) {
        await store.set(hostId, await store.get(hostId));
      }
      const state = await store.get(hostId);
      try {
        const api = await vendor();
        const inventory = await api.inventory(resource.dropletId, signal);
        const name = allocationName(resource.key);
        if (
          inventory.droplet !== null &&
          (inventory.droplet.name !== name ||
            !inventory.droplet.tags.includes(name))
        )
          throw new AllocationError(
            "DigitalOcean allocation ownership does not match.",
          );
        if (
          inventory.droplet?.status === "active" ||
          inventory.droplet?.status === "off"
        )
          recordPower(state, inventory.droplet.status, now());
        const cost = computeCost(inventory, state, hostId, now());
        const latest = state.snapshots.at(-1);
        return {
          summary: `${BILLING}. $${cost.monthlyEstimate.toFixed(2)}/month + account unassigned IPs $${cost.accountUnassignedIpMonthlyEstimate.toFixed(2)}/month. Snapshots: ${cost.snapshotGb.toFixed(2)} GB ($${cost.snapshotMonthlyEstimate.toFixed(2)}/month). Observed running ${cost.runningHoursObserved.toFixed(2)} h / off ${cost.offHoursObserved.toFixed(2)} h. Backup: ${state.backupStatus}${latest ? ` · ${latest.id}, ${latest.size_gigabytes} GB, ${latest.created_at}` : ""}.`,
          values: { ...state, cost, inventoryError: null },
        };
      } catch {
        return {
          summary: `${BILLING}. Backup: ${state.backupStatus}. Inventory unavailable.`,
          values: {
            ...state,
            cost: null,
            inventoryError: "DigitalOcean inventory unavailable; retry later.",
          },
        };
      }
    }
    const handlers = {
      async machines() {
        return (await bb.sdk.hosts.list())
          .filter(
            (host) =>
              host.machineProviderId === "digitalocean" &&
              host.lifecycle.phase !== "destroyed",
          )
          .map(({ id, name }) => ({ id, name }));
      },
      async configuration({ hostId }: z.infer<typeof hostInput>) {
        await machine(hostId);
        return (await store.get(hostId)).config;
      },
      async status({ hostId }: z.infer<typeof hostInput>) {
        const { resource } = await machine(hostId);
        return details(hostId, resource, AbortSignal.timeout(WAIT_MS));
      },
      async configure({
        hostId,
        config,
      }: {
        hostId: string;
        config: z.infer<typeof configSchema>;
      }) {
        return store.exclusive(hostId, async () => {
          await machine(hostId);
          const state = await store.get(hostId);
          state.config = config;
          state.scheduleCursor = now();
          state.scheduleRevision += 1;
          state.scheduleError = null;
          await store.set(hostId, state);
          return config;
        });
      },
      async sleep({ hostId }: z.infer<typeof hostInput>) {
        const { resource } = await machine(hostId);
        await bb.sdk.hosts.suspend({ hostId });
        const state = await store.get(hostId);
        return {
          ok: true as const,
          power: state.power,
          backupStatus: state.backupStatus,
          backupError: state.backupError,
          details: await details(hostId, resource, AbortSignal.timeout(30_000)),
          snapshotId: state.snapshots.at(-1)?.id ?? null,
        };
      },
      async wake({ hostId }: z.infer<typeof hostInput>) {
        await machine(hostId);
        await bb.sdk.hosts.resume({ hostId });
        return { ok: true as const };
      },
    };
    bb.rpc.register(devboxRpc, handlers);
    bb.cli.register({
      name: "digitalocean",
      summary: `Manage long-lived dev boxes. ${BILLING}. ${PRICING}`,
      commands: [
        {
          name: "status",
          summary: "Live inventory, backups, schedule and estimated cost",
          usage: "bb digitalocean status <host-id> [--json]",
        },
        {
          name: "configure",
          summary:
            "Set idleMinutes (null disables), retention and weekday schedule with explicit timezone",
          usage: "bb digitalocean configure <host-id> <config-json> [--json]",
        },
        {
          name: "snapshot-now",
          summary: "Quiesce, gracefully shut down, snapshot and remain off",
          usage: "bb digitalocean snapshot-now <host-id> [--json]",
        },
        {
          name: "sleep",
          summary: "Sleep with backup through core",
          usage: "bb digitalocean sleep <host-id> [--json]",
        },
        {
          name: "wake",
          summary: "Resume through core",
          usage: "bb digitalocean wake <host-id> [--json]",
        },
        {
          name: "cost",
          summary: "Show estimated live costs",
          usage: "bb digitalocean cost <host-id> [--json]",
        },
      ],
      async run(argv) {
        const [command, hostId, config, ...extra] = argv.filter(
          (arg) => arg !== "--json",
        );
        const input = hostInput.parse({ hostId });
        if (extra.length || (command !== "configure" && config !== undefined))
          throw new Error("Unexpected arguments");
        let result;
        let exitCode = 0;
        if (command === "configure")
          result = await handlers.configure({
            ...input,
            config: configSchema.parse(JSON.parse(config ?? "null")),
          });
        else if (command === "status" || command === "cost")
          result = await handlers.status(input);
        else if (command === "sleep" || command === "snapshot-now") {
          const slept = await handlers.sleep(input);
          exitCode = slept.backupStatus === "off, backup failed" ? 1 : 0;
          result = slept;
        } else if (command === "wake") result = await handlers.wake(input);
        else
          throw new Error(
            "Use status, configure, snapshot-now, sleep, wake or cost.",
          );
        return { exitCode, stdout: JSON.stringify(result, null, 2) };
      },
    });
    const scheduleClaims = new Set<string>();
    bb.background.schedule("devbox-schedules", "* * * * *", async () => {
      for (const hostId of await store.hosts()) {
        const state = await store.get(hostId);
        if (state.config.schedule === null) continue;
        const scheduled = latestScheduledAction(
          state.config.schedule,
          state.scheduleCursor,
          now(),
        );
        if (!scheduled || scheduleClaims.has(hostId)) continue;
        scheduleClaims.add(hostId);
        try {
          const { host } = await machine(hostId);
          const desired = scheduled.action === "sleep" ? "suspended" : "active";
          if (
            host.lifecycle.phase !== "active" &&
            host.lifecycle.phase !== "suspended"
          )
            continue;
          const claim = await store.exclusive(hostId, async () => {
            const current = await store.get(hostId);
            if (
              current.scheduleRevision !== state.scheduleRevision ||
              current.scheduleCursor >= scheduled.at
            )
              return null;
            return {
              operation:
                scheduled.action === "wake"
                  ? bb.sdk.hosts.resume({ hostId })
                  : host.lifecycle.phase === desired
                    ? Promise.resolve()
                    : bb.sdk.hosts.suspend({ hostId }),
            };
          });
          if (!claim) continue;
          await claim.operation;
          const established = await bb.sdk.hosts.get({ hostId });
          if (established.lifecycle.phase !== desired) continue;
          await store.exclusive(hostId, async () => {
            const current = await store.get(hostId);
            if (current.scheduleRevision !== state.scheduleRevision) return;
            current.scheduleCursor = Math.max(
              current.scheduleCursor,
              scheduled.at,
            );
            current.scheduleError = null;
            await store.set(hostId, current);
          });
        } catch {
          await store.exclusive(hostId, async () => {
            const current = await store.get(hostId);
            if (current.scheduleRevision !== state.scheduleRevision) return;
            current.scheduleError =
              "Scheduled action failed or machine is busy; retry next minute until superseded by the next scheduled action.";
            await store.set(hostId, current);
          });
        } finally {
          scheduleClaims.delete(hostId);
        }
      }
    });
    bb.experimental_machines.register({
      id: "digitalocean",
      displayName: "DigitalOcean",
      icon: "./digitalocean-logo.svg",
      inputs: inputsSchema,
      policy: {
        idleSuspendMs: null,
        retire: { after: "never" },
        removeRetryMs: 30_000,
      },
      async experimental_idleSuspendMs({ hostId }) {
        const { idleMinutes } = (await store.get(hostId)).config;
        return idleMinutes === null ? null : idleMinutes * 60_000;
      },
      async experimental_details({ hostId, resource, signal }) {
        return details(hostId, resourceSchema.parse(resource), signal);
      },
      async availability() {
        return (await settings.get()).DIGITALOCEAN_TOKEN?.trim()
          ? { status: "available" }
          : {
              status: "setup-required",
              message: "Configure the DIGITALOCEAN_TOKEN plugin setting.",
            };
      },
      async create(context) {
        try {
          const api = await vendor();
          const initialConfig = configSchema.parse({
            idleMinutes: inputsSchema.parse(context.inputs).idleMinutes,
            retention: (await settings.get()).snapshotRetention,
          });
          const name = allocationName(context.key);
          const intentKey = `allocation/${name}`;
          const stored = await bb.storage.kv.get<unknown>(intentKey);
          const intent =
            stored === undefined ? null : intentSchema.parse(stored);
          const signal = AbortSignal.any([
            context.signal,
            AbortSignal.timeout(WAIT_MS),
          ]);
          signal.throwIfAborted();
          const enrollment = await bb.experimental_machines.enrollments.prepare(
            { key: context.key },
          );
          let droplet = intent?.dropletId
            ? await owned(api, intent.dropletId, context.key, signal)
            : await api.find(name, signal);
          if (droplet === null && intent !== null) {
            const reconcile = AbortSignal.any([
              signal,
              AbortSignal.timeout(30_000),
            ]);
            try {
              while (droplet === null) {
                await deps.sleep(reconcile);
                droplet = await api.find(name, reconcile);
              }
            } catch {
              context.signal.throwIfAborted();
              throw new AllocationError(
                "DigitalOcean allocation is unresolved after an earlier create submission. Reconcile the Droplet with its allocation tag before retrying; no second create was submitted.",
              );
            }
          }
          if (droplet === null) {
            if (enrollment.state !== "pending")
              throw new AllocationError(
                "Enrolled DigitalOcean machine has no Droplet; restore or remove the existing machine.",
              );
            const installer = await bb.experimental_machines.installerCommand(
              enrollment.bootstrap,
            );
            const userData = cloudInit(installer);
            signal.throwIfAborted();
            await bb.storage.kv.set(intentKey, { dropletId: null });
            context.report.step("Creating the DigitalOcean Droplet…");
            droplet = await api.create(
              { name, ...inputsSchema.parse(context.inputs), userData },
              signal,
            );
          }
          const resource = {
            version: 1,
            key: context.key,
            dropletId: droplet.id,
            enrollmentId: enrollment.id,
          };
          await context.checkpoint(resource);
          await bb.storage.kv.set(`resource/${enrollment.hostId}`, resource);
          if (
            (await bb.storage.kv.get<unknown>(
              `devbox/${enrollment.hostId}`,
            )) === undefined
          ) {
            const state = await store.get(enrollment.hostId);
            state.config = initialConfig;
            await store.set(enrollment.hostId, state);
          }
          await bb.storage.kv.set(intentKey, { dropletId: droplet.id });
          signal.throwIfAborted();
          await active(api, droplet, signal);
          context.report.step("Waiting for the machine to connect…");
          await bb.experimental_machines.enrollments.waitForConnection({
            enrollmentId: enrollment.id,
            timeoutMs: WAIT_MS,
            signal,
          });
          return {
            status: "created",
            hostId: enrollment.hostId,
            resource,
          };
        } catch (error) {
          context.signal.throwIfAborted();
          return {
            status: "failed",
            failure:
              error instanceof VendorError &&
              [401, 403, 422].includes(error.status)
                ? "terminal"
                : "transient",
            message:
              error instanceof AllocationError || error instanceof VendorError
                ? error.message
                : "DigitalOcean provisioning failed. Retry to reconcile the existing allocation.",
          };
        }
      },
      async experimental_reconcileCleanup(context) {
        const name = allocationName(context.key);
        const stored = await bb.storage.kv.get<unknown>(`allocation/${name}`);
        if (stored === undefined) return { status: "removed" };
        const intent = intentSchema.parse(stored);
        const api = await vendor();
        const droplet =
          intent.dropletId === null
            ? await api.find(name, context.signal)
            : await owned(api, intent.dropletId, context.key, context.signal);
        if (droplet === null && intent.dropletId === null)
          return {
            status: "failed",
            message:
              "DigitalOcean allocation intent is unresolved; retry tag reconciliation.",
          };
        if (droplet !== null) {
          await bb.storage.kv.set(`allocation/${name}`, {
            dropletId: droplet.id,
          });
          await api.destroy(droplet.id, context.signal);
        }
        return { status: "removed" };
      },
      async suspend(context) {
        return store.exclusive(context.hostId, async () => {
          const resource = resourceSchema.parse(context.resource);
          const api = await vendor();
          const droplet = await owned(
            api,
            resource.dropletId,
            resource.key,
            context.signal,
          );
          if (droplet === null)
            throw new AllocationError("DigitalOcean Droplet no longer exists.");
          context.report.step("Graceful shutdown, then snapshot…");
          const state = await sleepWithBackup({
            hostId: context.hostId,
            dropletId: droplet.id,
            api,
            store,
            signal: context.signal,
            now,
          });
          context.report.step(state.backupStatus);
          context.checkpoint(resource);
          return { resource };
        });
      },
      async resume(context) {
        return store.exclusive(context.hostId, async () => {
          const resource = resourceSchema.parse(context.resource);
          const api = await vendor();
          const droplet = await owned(
            api,
            resource.dropletId,
            resource.key,
            context.signal,
          );
          if (droplet === null)
            throw new AllocationError("DigitalOcean Droplet no longer exists.");
          const state = await store.get(context.hostId);
          invalidatePendingSnapshot(state);
          await store.set(context.hostId, state);
          if (droplet.status !== "active")
            await api.power(droplet.id, "power_on", context.signal);
          recordPower(state, "active", now());
          await store.set(context.hostId, state);
          const { hostId } =
            await bb.experimental_machines.enrollments.waitForConnection({
              enrollmentId: resource.enrollmentId,
              timeoutMs: WAIT_MS,
              signal: context.signal,
            });
          if (hostId !== context.hostId)
            throw new AllocationError(
              "DigitalOcean enrollment returned a different machine identity.",
            );
          return { resource };
        });
      },
      async remove(context) {
        return store.exclusive(context.hostId, async () => {
          const resource = resourceSchema.parse(context.resource);
          const api = await vendor();
          const droplet = await owned(
            api,
            resource.dropletId,
            resource.key,
            context.signal,
          );
          if (droplet !== null) await api.destroy(droplet.id, context.signal);
          await pruneSnapshots({
            hostId: context.hostId,
            dropletId: resource.dropletId,
            api,
            store,
            signal: context.signal,
            keep: 0,
          });
          await store.delete(context.hostId);
          await bb.storage.kv.delete(`resource/${context.hostId}`);
          return { status: "removed" as const };
        });
      },
    });
  };
}

export default createDigitalOceanPlugin({
  vendor: createVendor,
  sleep: (signal) => setTimeout(3000, undefined, { signal }),
});
