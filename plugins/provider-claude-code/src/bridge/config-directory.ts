import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

export interface ClaudeProfile {
  configDirectory: string;
  accountFile: string;
  keychainService: string;
}

export function claudeConfigDirectory(
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  return resolve(
    cwd,
    (env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC"),
  );
}

export function claudeProfile(
  env: NodeJS.ProcessEnv,
  cwd: string,
): ClaudeProfile {
  const configured = env.CLAUDE_CONFIG_DIR;
  const configDirectory = claudeConfigDirectory(env, cwd);
  if (!configured) {
    return {
      configDirectory,
      accountFile: join(homedir(), ".claude.json"),
      keychainService: CLAUDE_KEYCHAIN_SERVICE,
    };
  }
  return {
    configDirectory,
    accountFile: join(configDirectory, ".claude.json"),
    keychainService: `${CLAUDE_KEYCHAIN_SERVICE}-${createHash("sha256")
      .update(configured.normalize("NFC"))
      .digest("hex")
      .slice(0, 8)}`,
  };
}
