import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { cloudInit } from "./cloud-init.js";
import { inputsSchema } from "./inputs.js";
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
}) {
  return async (bb: BbPluginApi) => {
    const settings = bb.settings.define({
      DIGITALOCEAN_TOKEN: {
        type: "string",
        secret: true,
        label: "DigitalOcean API token",
      },
    });
    async function vendor() {
      const token = (await settings.get()).DIGITALOCEAN_TOKEN?.trim();
      if (!token)
        throw new AllocationError(
          "Configure the DIGITALOCEAN_TOKEN plugin setting.",
        );
      return deps.vendor(token);
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
    bb.experimental_machines.register({
      id: "digitalocean",
      displayName: "DigitalOcean",
      environmentRow: {
        displayName: "DigitalOcean",
        environmentProviderId: "project-checkout",
      },
      inputs: inputsSchema,
      policy: {
        idleSuspendMs: null,
        retire: { after: "never" },
        removeRetryMs: 30_000,
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
      async suspend(context) {
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
        if (droplet.status !== "off")
          await api.power(droplet.id, "power_off", context.signal);
        return { resource };
      },
      async resume(context) {
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
        if (droplet.status !== "active")
          await api.power(droplet.id, "power_on", context.signal);
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
      },
      async remove(context) {
        const resource = resourceSchema.parse(context.resource);
        const api = await vendor();
        const droplet = await owned(
          api,
          resource.dropletId,
          resource.key,
          context.signal,
        );
        if (droplet !== null) await api.destroy(droplet.id, context.signal);
        return { status: "removed" };
      },
    });
  };
}

export default createDigitalOceanPlugin({
  vendor: createVendor,
  sleep: (signal) => setTimeout(3000, undefined, { signal }),
});
