import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const HEADER_VALUE_FORBIDDEN_PATTERN = /[\u0000-\u0008\u000a-\u001f\u007f]/u;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const INSTALL_DAEMON_PID_FILE_NAME = "install-daemon.pid";

export const SERVER_MOVE_INVALID_ADDRESS = "server_move_invalid_address";

export function normalizeMovedServerUrl(value: string): string {
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new ExpectedCommandDispatchError(
      SERVER_MOVE_INVALID_ADDRESS,
      "The new server address contains control characters",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExpectedCommandDispatchError(
      SERVER_MOVE_INVALID_ADDRESS,
      "The new server address is not a valid URL",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExpectedCommandDispatchError(
      SERVER_MOVE_INVALID_ADDRESS,
      `The new server address uses an unsupported protocol: ${url.protocol}`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ExpectedCommandDispatchError(
      SERVER_MOVE_INVALID_ADDRESS,
      "The new server address must not contain credentials",
    );
  }
  return url.href.replace(/\/+$/u, "");
}

export function tryNormalizeMovedServerUrl(value: string): string | null {
  try {
    return normalizeMovedServerUrl(value);
  } catch {
    return null;
  }
}

export function validateServerHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new ExpectedCommandDispatchError(
        SERVER_MOVE_INVALID_ADDRESS,
        `The new server header name ${JSON.stringify(name)} is invalid`,
      );
    }
    if (HEADER_VALUE_FORBIDDEN_PATTERN.test(value)) {
      throw new ExpectedCommandDispatchError(
        SERVER_MOVE_INVALID_ADDRESS,
        `The new server header ${name} contains control characters`,
      );
    }
  }
  return { ...headers };
}

async function readInstallDaemonPid(dataDir: string): Promise<number | null> {
  try {
    const raw = (
      await readFile(join(dataDir, INSTALL_DAEMON_PID_FILE_NAME), "utf8")
    ).trim();
    return /^[0-9]+$/u.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

export async function detectUnrecognizedSupervisor(args: {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  parentPid: number;
}): Promise<string | null> {
  const invocationId = args.env.INVOCATION_ID?.trim() ?? "";
  const xpcServiceName = args.env.XPC_SERVICE_NAME?.trim() ?? "";
  const supervisor =
    invocationId !== ""
      ? "systemd"
      : xpcServiceName !== "" && xpcServiceName !== "0"
        ? "launchd"
        : null;
  if (supervisor === null) {
    return null;
  }
  return (await readInstallDaemonPid(args.dataDir)) === args.parentPid
    ? null
    : supervisor;
}
