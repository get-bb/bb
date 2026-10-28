import path from "node:path";
import { expect, it } from "vitest";
import { resolvePiAgentDir } from "./config-home.js";
it("resolves the provider home with the configured process cwd", () => {
  const homeDir = path.resolve("/host-home");
  const cwd = path.resolve("/workspace");
  expect(resolvePiAgentDir({ homeDir, cwd, env: {} })).toBe(
    path.join(homeDir, ".pi/agent"),
  );
  expect(
    resolvePiAgentDir({
      homeDir,
      cwd,
      env: { PI_CODING_AGENT_DIR: "profile/../active" },
    }),
  ).toBe(path.join(cwd, "active"));
  expect(
    resolvePiAgentDir({
      homeDir,
      cwd: null,
      env: { PI_CODING_AGENT_DIR: "active" },
    }),
  ).toBe(path.join(homeDir, "active"));
});

it("keeps the provider's tilde and empty-value semantics", () => {
  const homeDir = path.resolve("/host-home");
  const cwd = path.resolve("/workspace");
  expect(
    resolvePiAgentDir({
      homeDir,
      cwd,
      env: { PI_CODING_AGENT_DIR: "~/active" },
    }),
  ).toBe(path.join(homeDir, "active"));
  expect(
    resolvePiAgentDir({ homeDir, cwd, env: { PI_CODING_AGENT_DIR: "" } }),
  ).toBe(path.join(homeDir, ".pi/agent"));
  expect(
    resolvePiAgentDir({ homeDir, cwd, env: { PI_CODING_AGENT_DIR: "   " } }),
  ).toBe(path.join(homeDir, ".pi/agent"));
});
