import path from "node:path";
import { expect, it } from "vitest";
import { resolveCodexHome, resolveSharedCodexHome } from "./config-home.js";
it("resolves the provider home with the configured process cwd", () => {
  const homeDir = path.resolve("/host-home");
  const cwd = path.resolve("/workspace");
  expect(resolveCodexHome({ homeDir, cwd, env: {} })).toBe(
    path.join(homeDir, ".codex"),
  );
  expect(
    resolveCodexHome({
      homeDir,
      cwd,
      env: { CODEX_HOME: "profile/../active" },
    }),
  ).toBe(path.join(cwd, "active"));
  expect(
    resolveCodexHome({ homeDir, cwd: null, env: { CODEX_HOME: "active" } }),
  ).toBe(path.join(homeDir, "active"));
});

it("keeps the provider's tilde and empty-value semantics", () => {
  const homeDir = path.resolve("/host-home");
  const cwd = path.resolve("/workspace");
  expect(
    resolveCodexHome({ homeDir, cwd, env: { CODEX_HOME: "~/active" } }),
  ).toBe(path.join(cwd, "~/active"));
  expect(resolveCodexHome({ homeDir, cwd, env: { CODEX_HOME: "" } })).toBe(
    path.join(homeDir, ".codex"),
  );
  expect(resolveCodexHome({ homeDir, cwd, env: { CODEX_HOME: "   " } })).toBe(
    path.join(homeDir, ".codex"),
  );
});

it("has no machine-wide home when CODEX_HOME is relative to each session", () => {
  const homeDir = path.resolve("/host-home");
  const configured = path.resolve("/profiles/codex");
  expect(resolveSharedCodexHome({ homeDir, env: { CODEX_HOME: " " } })).toBe(
    path.join(homeDir, ".codex"),
  );
  expect(
    resolveSharedCodexHome({ homeDir, env: { CODEX_HOME: configured } }),
  ).toBe(configured);
  expect(
    resolveSharedCodexHome({ homeDir, env: { CODEX_HOME: "profile" } }),
  ).toBeNull();
});
