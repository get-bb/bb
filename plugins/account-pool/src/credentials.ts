import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "Claude Code-credentials";

const credentialsFileSchema = z
  .object({
    claudeAiOauth: z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        expiresAt: z.number().nullish(),
        subscriptionType: z.string().nullish(),
        rateLimitTier: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

const accountFileSchema = z.object({
  oauthAccount: z
    .object({ emailAddress: z.string().email().nullish() })
    .nullish(),
});

export interface ImportedClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  email: string | null;
}

function parseCredentials(
  raw: string,
): Omit<ImportedClaudeCredentials, "email"> | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  if (/^(?:[0-9a-f]{2})+$/iu.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, "hex").toString("utf8"));
  }
  for (const candidate of candidates) {
    try {
      const parsed = credentialsFileSchema.safeParse(JSON.parse(candidate));
      if (!parsed.success) continue;
      return {
        accessToken: parsed.data.claudeAiOauth.accessToken,
        refreshToken: parsed.data.claudeAiOauth.refreshToken,
        expiresAt: parsed.data.claudeAiOauth.expiresAt ?? null,
        subscriptionType: parsed.data.claudeAiOauth.subscriptionType ?? null,
        rateLimitTier: parsed.data.claudeAiOauth.rateLimitTier ?? null,
      };
    } catch {}
  }
  return null;
}

async function readKeychainCredentials(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const username = os.userInfo().username;
  const argumentSets = [
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", username, "-w"],
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
  ];
  for (const args of argumentSets) {
    try {
      const result = await execFileAsync("security", args, { timeout: 10_000 });
      if (result.stdout.trim()) return result.stdout.trim();
    } catch {}
  }
  return null;
}

async function readAccountEmail(): Promise<string | null> {
  try {
    const value = JSON.parse(
      await fs.readFile(path.join(os.homedir(), ".claude.json"), "utf8"),
    );
    const parsed = accountFileSchema.safeParse(value);
    return parsed.success
      ? (parsed.data.oauthAccount?.emailAddress ?? null)
      : null;
  } catch {
    return null;
  }
}

export async function importClaudeCredentials(): Promise<ImportedClaudeCredentials> {
  const keychain = await readKeychainCredentials();
  let credentials = keychain === null ? null : parseCredentials(keychain);
  if (credentials === null) {
    try {
      credentials = parseCredentials(
        await fs.readFile(
          path.join(os.homedir(), ".claude", ".credentials.json"),
          "utf8",
        ),
      );
    } catch {}
  }
  if (credentials === null) {
    throw new Error(
      "Claude Code OAuth credentials were not found. Run `claude /login` on the bb server host, then retry.",
    );
  }
  return { ...credentials, email: await readAccountEmail() };
}
