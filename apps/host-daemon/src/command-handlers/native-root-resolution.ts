import { randomUUID } from "node:crypto";
import {
  EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  providerResolvedNativeRootsSchema,
  type ProviderNativeRootSet,
  type ProviderResolvedNativeRoots,
} from "@bb/domain";
import type {
  HostNativeRootResolution,
  HostNativeRootScan,
} from "@bb/host-daemon-contract";
import type { CommandDispatchOptions } from "../command-dispatch-support.js";

interface NativeRootResolutionArgs {
  cwd: string | null;
  resolution: HostNativeRootResolution;
  options: Pick<CommandDispatchOptions, "logger" | "pluginHost">;
  signal: AbortSignal;
}

async function resolveNativeRoots(
  scan: HostNativeRootScan,
  args: NativeRootResolutionArgs,
): Promise<ProviderResolvedNativeRoots> {
  const { resolver } = scan;
  if (resolver === null) {
    return EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
  }
  const { pluginHost, logger } = args.options;
  const fields = {
    pluginId: resolver.pluginId,
    providerId: scan.providerId,
    cwd: args.cwd,
  };
  const fallbackMessage = `Plugin "${resolver.pluginId}" failed to resolve native roots for provider "${scan.providerId}"; listing its declared roots only`;
  if (pluginHost === undefined) {
    logger.warn(
      { ...fields, reason: "host plugin runtime is unavailable" },
      fallbackMessage,
    );
    return EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
  }
  const callId = randomUUID();
  const cancel = (): void => {
    pluginHost.cancel({
      type: "plugin.host.cancel",
      pluginId: resolver.pluginId,
      generation: resolver.generation,
      callId,
    });
  };
  args.signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await pluginHost.call({
      type: "plugin.host.call",
      contributedEnv: args.resolution.contributedEnv,
      pluginId: resolver.pluginId,
      generation: resolver.generation,
      artifact: resolver.artifact,
      callId,
      method: "resolveNativeRoots",
      input: { providerId: scan.providerId, cwd: args.cwd },
      timeoutMs: args.resolution.timeoutMs,
    });
    return providerResolvedNativeRootsSchema.parse(result.output);
  } catch (error) {
    logger.warn({ ...fields, err: error }, fallbackMessage);
    return EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
  } finally {
    args.signal.removeEventListener("abort", cancel);
  }
}

export async function resolveNativeRootSet(
  scan: HostNativeRootScan,
  args: NativeRootResolutionArgs,
): Promise<ProviderNativeRootSet> {
  return {
    skills: scan.declaredRoots.skills,
    commands: scan.declaredRoots.commands,
    resolved: await resolveNativeRoots(scan, args),
  };
}
