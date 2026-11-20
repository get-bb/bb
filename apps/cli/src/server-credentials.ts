import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dpopPrivateJwkSchema } from "@bb/sdk/node";
import { z } from "zod";
import { resolveCliDataDir } from "./cli-error-log.js";

const SERVER_CREDENTIALS_FILE_NAME = "server-credentials.json";

const storedServerCredentialSchema = z
  .object({
    privateJwk: dpopPrivateJwkSchema,
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.number().int(),
    credentialId: z.string().min(1),
    label: z.string(),
  })
  .strict();
export type StoredServerCredential = z.infer<
  typeof storedServerCredentialSchema
>;

const serverCredentialsFileSchema = z
  .object({
    version: z.literal(2),
    servers: z.record(z.string(), storedServerCredentialSchema),
  })
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
    return { version: 2, servers: {} };
  }
  const parsed = serverCredentialsFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `${path} is not a bb server credentials file this CLI understands; delete it and sign in again with \`bb access login\``,
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

export function readServerCredential(
  serverUrl: string,
  path: string = serverCredentialsPath(),
): StoredServerCredential | null {
  return readCredentialsFile(path).servers[serverOrigin(serverUrl)] ?? null;
}

export function saveServerCredential(
  serverUrl: string,
  credential: StoredServerCredential,
  path: string = serverCredentialsPath(),
): void {
  const file = readCredentialsFile(path);
  writeCredentialsFile(path, {
    version: 2,
    servers: { ...file.servers, [serverOrigin(serverUrl)]: credential },
  });
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
  writeCredentialsFile(path, { version: 2, servers });
  return true;
}
