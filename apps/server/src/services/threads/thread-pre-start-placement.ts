import { getHost, getProjectSourceByHost } from "@bb/db";
import { z } from "zod";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { WorkSessionDeps } from "../../types.js";
import { pluginHookProvider } from "../plugins/plugin-hook-registry.js";
import { requireConnectedHostSession } from "../lib/entity-lookup.js";

const skippedSchema = z
  .array(z.object({ hostId: z.string().min(1), reason: z.string() }).strict())
  .default([]);

const decisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choose"),
    hostId: z.string().min(1),
    requestedAt: z.number().int().nonnegative(),
    skipped: skippedSchema,
  }).strict(),
  z.object({ kind: z.literal("default"), reason: z.string(), skipped: skippedSchema }).strict(),
]);

export interface PlacementSkip {
  hostId: string;
  reason: string;
}

export type PreStartPlacement =
  | { kind: "unavailable" }
  | { kind: "host"; hostId: string; skipped: PlacementSkip[] }
  | { kind: "default"; skipped: PlacementSkip[] };

export async function choosePreStartHost(
  deps: WorkSessionDeps,
  input: { projectId: string; providerId: string },
): Promise<string | null> {
  const placement = await previewPreStartPlacement(deps, input);
  return placement.kind === "host" ? placement.hostId : null;
}

export async function previewPreStartPlacement(
  deps: WorkSessionDeps,
  input: { projectId: string; providerId: string },
): Promise<PreStartPlacement> {
  const provider = pluginHookProvider();
  const hooks = provider?.listHooks("experimental_thread.place") ?? [];
  if (provider === undefined || hooks.length === 0) return { kind: "unavailable" };
  let skipped: PlacementSkip[] = [];
  for (const { pluginId, handler } of hooks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(provider.decisionTimeoutMs, 10_000));
    const aborted = new Promise<null>((resolve) => {
      controller.signal.onabort = () => resolve(null);
    });
    try {
      const invocation = await Promise.race([
        provider.invokeHook(pluginId, "experimental_thread.place hook", () =>
          Promise.resolve(handler({ ...input, signal: controller.signal })),
        ),
        aborted,
      ]);
      if (invocation === null || !invocation.ok) {
        deps.logger.debug({ pluginId, reason: invocation?.error ?? "timeout or unload" }, "Using default thread placement");
        continue;
      }
      const parsed = decisionSchema.safeParse(invocation.value);
      if (!parsed.success) {
        deps.logger.debug({ pluginId, reason: "invalid placement decision" }, "Using default thread placement");
        continue;
      }
      skipped = parsed.data.skipped;
      if (parsed.data.kind === "default") {
        deps.logger.debug({ pluginId, reason: parsed.data.reason }, "Using default thread placement");
        continue;
      }
      const { hostId, requestedAt } = parsed.data;
      const age = Date.now() - requestedAt;
      if (age < 0 || age > 30_000) continue;
      const host = getHost(deps.db, hostId);
      if (host === null || host.type !== "persistent" || host.destroyedAt !== null || host.phase !== "active") continue;
      if (input.projectId !== PERSONAL_PROJECT_ID && getProjectSourceByHost(deps.db, input.projectId, hostId)?.type !== "local_path") continue;
      try {
        requireConnectedHostSession(deps, hostId);
      } catch {
        continue;
      }
      return { kind: "host", hostId, skipped };
    } catch (error) {
      deps.logger.debug({ pluginId, error }, "Using default thread placement");
      continue;
    } finally {
      clearTimeout(timeout);
      controller.signal.onabort = null;
      controller.abort();
    }
  }
  return { kind: "default", skipped };
}
