import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { claudeConfigDirectory, claudeProfile } from "./config-directory.js";

const cwd = path.resolve("/workspace");

it("resolves a relative CLAUDE_CONFIG_DIR against the session's cwd", () => {
  expect(claudeConfigDirectory({ CLAUDE_CONFIG_DIR: "profile" }, cwd)).toBe(
    path.join(cwd, "profile"),
  );
  expect(claudeConfigDirectory({}, cwd)).toBe(path.join(homedir(), ".claude"));
});

it("keeps the default profile's account file and Keychain item", () => {
  expect(claudeProfile({}, cwd)).toEqual({
    configDirectory: path.join(homedir(), ".claude"),
    accountFile: path.join(homedir(), ".claude.json"),
    keychainService: "Claude Code-credentials",
  });
});

it("uses the moved profile's account file and Keychain item", () => {
  const configured = path.resolve("/profiles/work");
  expect(claudeProfile({ CLAUDE_CONFIG_DIR: configured }, cwd)).toEqual({
    configDirectory: configured,
    accountFile: path.join(configured, ".claude.json"),
    keychainService: `Claude Code-credentials-${createHash("sha256")
      .update(configured)
      .digest("hex")
      .slice(0, 8)}`,
  });
});
