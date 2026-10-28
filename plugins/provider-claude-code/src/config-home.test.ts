import path from "node:path";
import { expect, it } from "vitest";
import { resolveClaudeConfigDir } from "./config-home.js";
it("resolves the provider home with the configured process cwd", () => {
  const homeDir = path.resolve("/host-home");
  const cwd = path.resolve("/workspace");
  expect(resolveClaudeConfigDir({ homeDir, cwd, env: {} })).toBe(
    path.join(homeDir, ".claude"),
  );
  expect(
    resolveClaudeConfigDir({
      homeDir,
      cwd,
      env: { CLAUDE_CONFIG_DIR: "profile/../active" },
    }),
  ).toBe(path.join(cwd, "active"));
  expect(
    resolveClaudeConfigDir({
      homeDir,
      cwd: null,
      env: { CLAUDE_CONFIG_DIR: "active" },
    }),
  ).toBe(path.join(homeDir, "active"));
});

it("keeps the provider's tilde and empty-value semantics", () => {
  const homeDir = path.resolve("/host-home");
  const cwd = path.resolve("/workspace");
  expect(
    resolveClaudeConfigDir({
      homeDir,
      cwd,
      env: { CLAUDE_CONFIG_DIR: "~/active" },
    }),
  ).toBe(path.join(cwd, "~/active"));
  expect(
    resolveClaudeConfigDir({ homeDir, cwd, env: { CLAUDE_CONFIG_DIR: "" } }),
  ).toBe(cwd);
  expect(
    resolveClaudeConfigDir({ homeDir, cwd, env: { CLAUDE_CONFIG_DIR: "  " } }),
  ).toBe(path.join(cwd, "  "));
  expect(
    resolveClaudeConfigDir({
      homeDir,
      cwd,
      env: { CLAUDE_CONFIG_DIR: "cafe\u0301" },
    }),
  ).toBe(path.join(cwd, "café"));
});
