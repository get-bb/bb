import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

// The connect credential is server-owned: the server dials the gate and holds
// the tunnel, so it persists the durable credential under its own data dir
// (not ~/.bb/cloud.json, which was the standalone client's store).
export interface ConnectCredential {
  serverUrl: string;
  handle: string;
  credential: string;
}

function credentialPath(dataDir: string): string {
  return join(dataDir, "connect.json");
}

export function readConnectCredential(
  dataDir: string,
): ConnectCredential | null {
  try {
    const raw = readFileSync(credentialPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<ConnectCredential>;
    if (
      typeof parsed.serverUrl === "string" &&
      typeof parsed.handle === "string" &&
      typeof parsed.credential === "string"
    ) {
      return {
        serverUrl: parsed.serverUrl,
        handle: parsed.handle,
        credential: parsed.credential,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeConnectCredential(
  dataDir: string,
  value: ConnectCredential,
): void {
  const path = credentialPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

export function clearConnectCredential(dataDir: string): void {
  rmSync(credentialPath(dataDir), { force: true });
}
