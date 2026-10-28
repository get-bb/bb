import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveClaudeConfigDir,
  resolveCodexHome,
  resolvePiAgentDir,
} from "../src/provider-homes.js";

const homeDir = path.resolve("/host-home");
const cwd = path.resolve("/workspace");

describe("provider home path contracts", () => {
  it.each([
    [resolveClaudeConfigDir, "CLAUDE_CONFIG_DIR", ".claude", false],
    [resolveCodexHome, "CODEX_HOME", ".codex", false],
    [resolvePiAgentDir, "PI_CODING_AGENT_DIR", ".pi/agent", true],
  ] as const)(
    "resolves %s with the configured process context",
    (resolve, variable, fallback, expandsTilde) => {
      expect(resolve({ homeDir, cwd, env: {} })).toBe(
        path.join(homeDir, fallback),
      );
      expect(
        resolve({ homeDir, cwd, env: { [variable]: "profile/../active" } }),
      ).toBe(path.join(cwd, "active"));
      expect(resolve({ homeDir, cwd, env: { [variable]: "~/active" } })).toBe(
        path.join(
          expandsTilde ? homeDir : cwd,
          expandsTilde ? "active" : "~/active",
        ),
      );
      expect(
        resolve({ homeDir, cwd: null, env: { [variable]: "active" } }),
      ).toBe(path.join(homeDir, "active"));
    },
  );

  it("preserves literal Claude paths, including blank and decomposed Unicode values", () => {
    expect(
      resolveClaudeConfigDir({ homeDir, cwd, env: { CLAUDE_CONFIG_DIR: "" } }),
    ).toBe(cwd);
    expect(
      resolveClaudeConfigDir({
        homeDir,
        cwd,
        env: { CLAUDE_CONFIG_DIR: "  " },
      }),
    ).toBe(path.join(cwd, "  "));
    expect(
      resolveClaudeConfigDir({
        homeDir,
        cwd,
        env: { CLAUDE_CONFIG_DIR: "cafe\u0301" },
      }),
    ).toBe(path.join(cwd, "café"));
  });
});
