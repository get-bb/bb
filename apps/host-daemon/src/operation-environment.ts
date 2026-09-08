import { createSecretStreamRedactor } from "@bb/process-utils";
import type { JsonValue } from "@bb/domain";
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
  try {
    const redactor = createSecretStreamRedactor(secrets);
    return redactor.push(text) + redactor.flush();
  } catch {
    return "[redacted]";
  }
}

export function redactOperationContent(
  value: JsonValue,
  secrets: readonly string[],
): JsonValue {
  function visit(content: JsonValue): JsonValue {
    if (typeof content === "string")
      return redactOperationSecrets(content, secrets);
    if (Array.isArray(content)) return content.map(visit);
    if (content !== null && typeof content === "object")
      return Object.fromEntries(
        Object.entries(content).map(([key, entry]) => [key, visit(entry)]),
      );
    return content;
  }
  try {
    return visit(value);
  } catch {
    return "[redacted]";
  }
}

export { createSecretStreamRedactor };
