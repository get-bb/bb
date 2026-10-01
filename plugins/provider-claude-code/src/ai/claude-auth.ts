import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AiServiceFailure } from "./failure.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "Claude Code-credentials";

const credentialsFileSchema = z
  .object({
    claudeAiOauth: z
      .object({
        accessToken: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export interface ClaudeAuthCredentials {
  accessToken: string;
}

function parseCredentials(raw: string): ClaudeAuthCredentials | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  if (/^(?:[0-9a-f]{2})+$/iu.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, "hex").toString("utf8"));
  }
  for (const candidate of candidates) {
    try {
      const parsed = credentialsFileSchema.safeParse(JSON.parse(candidate));
      if (!parsed.success) continue;
      return { accessToken: parsed.data.claudeAiOauth.accessToken };
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

export async function readClaudeAuthCredentials(): Promise<ClaudeAuthCredentials> {
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
    throw new AiServiceFailure(
      "auth_required",
      "claude_auth_missing",
      "Claude Code OAuth credentials were not found. Run `claude` on this machine to sign in.",
    );
  }
  return credentials;
}
