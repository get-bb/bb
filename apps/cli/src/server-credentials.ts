import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveCliDataDir } from "./cli-error-log.js";

const SERVER_CREDENTIALS_FILE_NAME = "server-credentials.json";

const storedServerCredentialSchema = z
  .object({
    token: z.string().min(1),
    credentialId: z.string().min(1),
    label: z.string(),
  })
  .strict();
export type StoredServerCredential = z.infer<
  typeof storedServerCredentialSchema
>;

const serverCredentialsFileSchema = z
  .object({ servers: z.record(z.string(), storedServerCredentialSchema) })
  .strict();
type ServerCredentialsFile = z.infer<typeof serverCredentialsFileSchema>;

export function serverCredentialsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveCliDataDir(env), SERVER_CREDENTIALS_FILE_NAME);
}

function readCredentialsFile(path: string): ServerCredentialsFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { servers: {} };
  }
  const parsed = serverCredentialsFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `${path} is not a valid bb server credentials file; delete it and sign in again with \`bb access login\``,
    );
  }
  return parsed.data;
}

function writeCredentialsFile(path: string, file: ServerCredentialsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function serverOrigin(serverUrl: string): string {
  return new URL(serverUrl).origin;
}

let cachedPath: string | null = null;
let cachedFile: ServerCredentialsFile | null = null;

function credentialsFile(path: string): ServerCredentialsFile {
  if (cachedPath !== path || cachedFile === null) {
    cachedFile = readCredentialsFile(path);
    cachedPath = path;
  }
  return cachedFile;
}

export function readServerCredential(
  serverUrl: string,
  path: string = serverCredentialsPath(),
): StoredServerCredential | null {
  return credentialsFile(path).servers[serverOrigin(serverUrl)] ?? null;
}

export function saveServerCredential(
  serverUrl: string,
  credential: StoredServerCredential,
  path: string = serverCredentialsPath(),
): void {
  const file = readCredentialsFile(path);
  const next = {
    servers: { ...file.servers, [serverOrigin(serverUrl)]: credential },
  };
  writeCredentialsFile(path, next);
  cachedPath = path;
  cachedFile = next;
}

export function forgetServerCredential(
  serverUrl: string,
  path: string = serverCredentialsPath(),
): boolean {
  const file = readCredentialsFile(path);
  const origin = serverOrigin(serverUrl);
  if (file.servers[origin] === undefined) return false;
  const servers = { ...file.servers };
  delete servers[origin];
  writeCredentialsFile(path, { servers });
  cachedPath = path;
  cachedFile = { servers };
  return true;
}
