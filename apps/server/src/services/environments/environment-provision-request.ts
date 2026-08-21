import type { EnvironmentProvisionCommand } from "@bb/host-daemon-contract";

export interface EnvironmentProvisionRequest {
  command: EnvironmentProvisionCommand;
}

export function buildDirectEnvironmentProvisionRequest(args: {
  command: EnvironmentProvisionCommand;
}): EnvironmentProvisionRequest {
  return { command: args.command };
}
