import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";

export function operationEnvironment(
  entries: readonly HostDaemonContributedEnvEntry[],
  base: NodeJS.ProcessEnv,
  inherited = false,
): NodeJS.ProcessEnv {
  const env = inherited
    ? sanitizeInheritedChildProcessEnv({ env: base })
    : { ...base };
  for (const entry of entries) {
    if (typeof entry.value === "string") env[entry.name] = entry.value;
    else {
      if (!base.BB_SERVER_URL)
        throw new Error("Host environment requires BB_SERVER_URL");
      env[entry.name] = `${base.BB_SERVER_URL}${entry.value.serverPath}`;
    }
  }
  return env;
}
