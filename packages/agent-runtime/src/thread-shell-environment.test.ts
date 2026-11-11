import { describe, expect, it } from "vitest";
import { resolveThreadEnvironment } from "./thread-shell-environment.js";

const resolve = (
  baseShellEnv: Record<string, string>,
  contributedEnv: Parameters<
    typeof resolveThreadEnvironment
  >[0]["contributedEnv"] = [],
) =>
  resolveThreadEnvironment({
    environmentId: "env-1",
    threadId: "thread-1",
    baseShellEnv,
    contributedEnv,
  });

describe("resolveThreadEnvironment", () => {
  it.each([
    "ANTHROPIC_AUTH_TOKEN",
    "CODEX_POOL_AUTH_TOKEN",
    "BB_ACCOUNT_POOL_PARENT_TOKEN",
    "OPENAI_API_KEY",
    "CLIENT_SECRET",
    "DB_PASSWORD",
    "NPM_AUTH",
  ])("masks plugin-contributed %s but passes it to the provider", (name) => {
    const resolved = resolve({}, [
      {
        name,
        value: "synthetic-credential-7181",
        source: { plugin: "account-pool" },
        reason: "Route through the hub",
      },
    ]);

    expect(resolved.envVars[name]).toBe("synthetic-credential-7181");
    expect(resolved.entries).toContainEqual({
      name,
      source: { plugin: "account-pool" },
      value: { masked: true },
      reason: "Route through the hub",
    });
    expect(JSON.stringify(resolved.entries)).not.toContain(
      "synthetic-credential-7181",
    );
  });

  it("masks credential-named shell variables and keeps other values", () => {
    const resolved = resolve({
      GITHUB_TOKEN: "synthetic-shell-token",
      PATH: "/usr/bin",
    });

    expect(resolved.envVars.GITHUB_TOKEN).toBe("synthetic-shell-token");
    expect(resolved.entries).toContainEqual({
      name: "GITHUB_TOKEN",
      source: "shell",
      value: { masked: true },
    });
    expect(resolved.entries).toContainEqual({
      name: "PATH",
      source: "shell",
      value: "/usr/bin",
    });
  });

  it("keeps plugin values whose names are not credential-like", () => {
    const resolved = resolve({}, [
      {
        name: "ANTHROPIC_BASE_URL",
        value: "http://127.0.0.1:3334/hub",
        source: { plugin: "account-pool" },
        reason: "Route through the hub",
      },
    ]);

    expect(resolved.entries).toContainEqual({
      name: "ANTHROPIC_BASE_URL",
      source: { plugin: "account-pool" },
      value: "http://127.0.0.1:3334/hub",
      reason: "Route through the hub",
    });
  });
});
