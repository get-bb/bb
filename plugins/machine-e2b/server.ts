import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { createVendor, type Vendor } from "./vendor.js";

const resourceSchema = z
  .object({
    version: z.literal(1),
    key: z.string().min(1),
    sandboxId: z.string().min(1),
  })
  .strict();
const allocationSchema = z
  .object({ sandboxId: z.string().min(1).nullable() })
  .strict();
const configurationSchema = z.object({
  E2B_API_KEY: z.string().trim().min(1),
  template: z.string().trim().min(1),
  timeoutMinutes: z.coerce.number().int().min(1).max(1440),
});

export function createE2BPlugin(deps: {
  vendor: (apiKey: string) => Vendor;
  sleep: (signal: AbortSignal) => Promise<void>;
}) {
  return async (bb: BbPluginApi) => {
    const settings = bb.settings.define({
      E2B_API_KEY: { type: "string", secret: true, label: "E2B API key" },
      template: {
        type: "string",
        label: "E2B template",
        description:
          "Template built from node:22.23.2-bookworm with Node 22.19+, npm, curl, git and build tools available to root.",
      },
      timeoutMinutes: {
        type: "string",
        label: "Sandbox lifetime (minutes)",
        default: "60",
        description:
          "Running lifetime, 1–1440 minutes, subject to your E2B plan.",
      },
    });
    async function vendor() {
      const apiKey = (await settings.get()).E2B_API_KEY?.trim();
      if (!apiKey) throw new Error("Configure the E2B_API_KEY plugin setting.");
      return deps.vendor(apiKey);
    }
    async function configured() {
      const parsed = configurationSchema.safeParse(await settings.get());
      if (!parsed.success)
        throw new Error(
          "Configure E2B_API_KEY, a Node 22.19+ template, and a valid timeoutMinutes setting.",
        );
      return {
        vendor: deps.vendor(parsed.data.E2B_API_KEY),
        template: parsed.data.template,
        timeoutMs: parsed.data.timeoutMinutes * 60_000,
      };
    }
    bb.experimental_machines.register({
      id: "e2b",
      displayName: "E2B",
      environmentRow: {
        displayName: "E2B",
        environmentProviderId: "project-checkout",
      },
      policy: {
        idleSuspendMs: 15 * 60_000,
        retire: { after: "last-thread", graceMs: 30 * 24 * 60 * 60_000 },
        removeRetryMs: 30_000,
      },
      async availability() {
        const valid = configurationSchema.safeParse(
          await settings.get(),
        ).success;
        return valid
          ? { status: "available" }
          : {
              status: "setup-required",
              message:
                "Configure E2B_API_KEY, a Node 22.19+ template, and timeoutMinutes.",
            };
      },
      async create(context) {
        const configuredValues = await configured();
        const api = configuredValues.vendor;
        const signal = AbortSignal.any([
          context.signal,
          AbortSignal.timeout(600_000),
        ]);
        signal.throwIfAborted();
        await bb.experimental_machines.prepareEnrollment({ key: context.key });
        signal.throwIfAborted();
        const intentKey = `allocation/${context.key}`;
        const stored = await bb.storage.kv.get<unknown>(intentKey);
        const intent =
          stored === undefined ? null : allocationSchema.parse(stored);
        let sandboxId =
          intent?.sandboxId ?? (await api.find(context.key, signal));
        if (sandboxId === null && intent !== null) {
          const reconcile = AbortSignal.any([
            signal,
            AbortSignal.timeout(30_000),
          ]);
          try {
            while (sandboxId === null) {
              await deps.sleep(reconcile);
              sandboxId = await api.find(context.key, reconcile);
            }
          } catch {
            context.signal.throwIfAborted();
            return {
              status: "failed",
              failure: "transient",
              message:
                "E2B allocation is unresolved after a previous create submission. Reconcile its metadata before retrying; no second create was submitted.",
            };
          }
        }
        let sandbox;
        if (sandboxId === null) {
          signal.throwIfAborted();
          await bb.storage.kv.set(intentKey, { sandboxId: null });
          context.report.step("Creating the E2B sandbox…");
          sandbox = await api.create(
            configuredValues.template,
            context.key,
            configuredValues.timeoutMs,
            signal,
          );
          sandboxId = sandbox.sandboxId;
        }
        const resource = { version: 1, key: context.key, sandboxId };
        await context.checkpoint(resource);
        await bb.storage.kv.set(intentKey, { sandboxId });
        signal.throwIfAborted();
        sandbox ??= await api.connect(
          sandboxId,
          configuredValues.timeoutMs,
          signal,
        );
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: context.key,
          executor: sandbox.executor,
          daemon: { kind: "install" },
          report: context.report,
          signal,
        });
        return {
          status: "created",
          hostId,
          resource,
        };
      },
      async suspend(context) {
        const resource = resourceSchema.parse(context.resource);
        await (
          await configured()
        ).vendor.pause(resource.sandboxId, context.signal);
        return { resource };
      },
      async resume(context) {
        const resource = resourceSchema.parse(context.resource);
        const config = await configured();
        const sandbox = await config.vendor.connect(
          resource.sandboxId,
          config.timeoutMs,
          context.signal,
        );
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: resource.key,
          executor: sandbox.executor,
          daemon: { kind: "preinstalled" },
          report: context.report,
          signal: context.signal,
        });
        if (hostId !== context.hostId)
          throw new Error(
            "E2B bootstrap returned a different machine identity.",
          );
        return { resource };
      },
      async remove(context) {
        const resource = resourceSchema.parse(context.resource);
        await (
          await configured()
        ).vendor.kill(resource.sandboxId, context.signal);
        return { status: "removed" };
      },
    });
  };
}
export default createE2BPlugin({
  vendor: createVendor,
  sleep: (signal) => setTimeout(3000, undefined, { signal }),
});
