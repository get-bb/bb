import { createHash } from "node:crypto";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function fingerprintAcpLaunchSpec(
  spec: HostDaemonAcpLaunchSpec,
): string {
  const stableSpec = {
    displayName: spec.displayName,
    command: spec.command,
    args: spec.args,
    env: sortedRecord(spec.env),
    ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
    ...(spec.modelCli !== undefined && spec.modelCli.listArgs.length > 0
      ? {
          modelCli: {
            listArgs: spec.modelCli.listArgs,
            ...(spec.modelCli.selectFlag !== undefined
              ? { selectFlag: spec.modelCli.selectFlag }
              : {}),
            primaryModels: spec.modelCli.primaryModels,
          },
        }
      : {}),
  };

  return createHash("sha256")
    .update(JSON.stringify(stableSpec))
    .digest("hex")
    .slice(0, 16);
}
