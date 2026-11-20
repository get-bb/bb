import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_ACCESS_TOKEN_PREFIX = "bbl_";
export const LOCAL_ACCESS_TOKEN_FILE_NAME = "local-access-token";

export function formatLocalAccessTokenPath(dataDir: string): string {
  return join(dataDir, LOCAL_ACCESS_TOKEN_FILE_NAME);
}

export function localAccessTokenFromSecret(secret: string): string {
  return `${LOCAL_ACCESS_TOKEN_PREFIX}${secret.trim()}`;
}

export function readLocalAccessTokenSync(dataDir: string): string | null {
  let secret: string;
  try {
    secret = readFileSync(formatLocalAccessTokenPath(dataDir), "utf8").trim();
  } catch {
    return null;
  }
  return secret.length === 0 ? null : localAccessTokenFromSecret(secret);
}
