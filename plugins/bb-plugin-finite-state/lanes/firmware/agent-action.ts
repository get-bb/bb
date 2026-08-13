import type { PluginContext } from "../../lib/context.js";
import {
  FIRMWARE_ACTION_SERVICE,
  type ActionInvocationScope,
  type ScopedFirmwareAction,
} from "../../lib/agentic/action-allowlist.js";
import { getFirmwareStatus } from "./status.js";

interface FirmwareAgentActionDeps {
  materializeApi(input: {
    projectId: string;
    projectVersionId: string;
    scanId?: string;
    mode: "metadata" | "files";
    firmwarePaths?: string[];
  }): Promise<unknown>;
}

export function registerFirmwareAgentAction(
  ctx: PluginContext,
  deps: FirmwareAgentActionDeps,
): void {
  ctx.service<ScopedFirmwareAction>(FIRMWARE_ACTION_SERVICE, () => ({
    async materialize(input, scope?: ActionInvocationScope) {
      if (!scope) throw new Error("ACTION_SCOPE_REQUIRED");
      if (input.mode === "hydrate_all") {
        const current = await getFirmwareStatus({ db: ctx.db(), projectId: scope.projectId }, input.pvId);
        if (current.source !== "standalone_unpack" || current.state !== "ready" || current.materializedFiles !== current.files || current.errors !== 0) {
          throw new Error("API_FULL_MATERIALIZATION_UNSUPPORTED: whole-image hydration requires local standalone unpack before invoking this mode");
        }
        return { pvId: input.pvId, source: current.source, hydrated: current.materializedFiles, remaining: 0, errors: 0 };
      }
      await deps.materializeApi({
        projectId: scope.projectId,
        projectVersionId: input.pvId,
        ...(input.scanId ? { scanId: input.scanId } : {}),
        mode: input.mode === "manifest" ? "metadata" : "files",
        ...(input.paths ? { firmwarePaths: input.paths } : {}),
      });
      const status = await getFirmwareStatus({ db: ctx.db(), projectId: scope.projectId }, input.pvId);
      return {
        pvId: input.pvId,
        source: status.source ?? "api",
        hydrated: status.materializedFiles,
        remaining: Math.max(0, status.files - status.materializedFiles),
        errors: status.errors,
      };
    },
  }));
}
