import type { FeatureFlags } from "@bb/domain";
import type { ProviderCliInstallEvent } from "@bb/host-daemon-contract";
import type { TelemetryService } from "./telemetry.js";

type AgentInstallMethod = "native" | "bundled_npm" | "npm";

function installMethod(displayCommand: string): AgentInstallMethod {
  if (/npm-cli\.js/u.test(displayCommand)) return "bundled_npm";
  return /^'?(?:[^'\s]*[\\/])?(?:npm|bun)(?:\.cmd|\.exe)?'?(?:\s|$)/iu.test(
    displayCommand,
  )
    ? "npm"
    : "native";
}

export function captureAgentInstallTelemetry(args: {
  telemetry: TelemetryService;
  featureFlags: FeatureFlags;
  providerId: string;
  isBuiltinProvider: () => boolean;
  actionKind: "install" | "update";
  events: readonly ProviderCliInstallEvent[];
}): void {
  if (!args.featureFlags.agentInstallTelemetry) return;
  if (args.actionKind !== "install" || !args.isBuiltinProvider()) return;
  const started = args.events.find((event) => event.type === "started");
  if (started === undefined) return;
  const installMethodValue = installMethod(started.command);
  const succeeded = args.events.some(
    (event) => event.type === "completed" && event.success,
  );
  args.telemetry.capture({
    name: "agent_install_started",
    properties: {
      provider: args.providerId,
      install_method: installMethodValue,
    },
  });
  args.telemetry.capture({
    name: "agent_install_finished",
    properties: {
      provider: args.providerId,
      install_method: installMethodValue,
      outcome: succeeded ? "succeeded" : "failed",
    },
  });
}
