import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";

export function operationEnvironment(
  entries: readonly HostDaemonContributedEnvEntry[],
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...base };
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

export function operationSecrets(
  entries: readonly HostDaemonContributedEnvEntry[],
): string[] {
  return entries.flatMap((entry) =>
    entry.secret && typeof entry.value === "string" && entry.value.length > 0
      ? [entry.value]
      : [],
  );
}

export function redactOperationSecrets(
  text: string,
  secrets: readonly string[],
): string {
  for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
  return text;
}

export { createSecretStreamRedactor } from "@bb/process-utils";
