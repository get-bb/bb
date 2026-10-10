import { describe, expect, it } from "vitest";
import { resolveThreadEnvironment } from "./thread-shell-environment.js";

describe("resolveThreadEnvironment", () => {
  it("masks every entry value while the provider env keeps the real values", () => {
    const result = resolveThreadEnvironment({
      environmentId: "env-1",
      projectId: "project-1",
      threadId: "thread-1",
      threadStoragePath: "/tmp/thread-storage/thread-1",
      baseShellEnv: {
        PATH: "/usr/bin",
        BB_SERVER_URL: "http://127.0.0.1:3334",
      },
      contributedEnv: [
        {
          name: "PATH",
          value: "/plugin/bin:/usr/bin",
          source: { plugin: "toolchain" },
          reason: "Use the plugin toolchain",
        },
        {
          name: "ANTHROPIC_AUTH_TOKEN",
          value: "pool-bearer-token",
          source: { plugin: "account-pool" },
          reason: "Route Claude through the account pool",
        },
        {
          name: "ANTHROPIC_BASE_URL",
          value: { serverPath: "/plugins/account-pool/anthropic" },
          source: { plugin: "account-pool" },
          reason: "Use the account pool proxy",
        },
        {
          name: "GH_TOKEN",
          value: "machine-git-token",
          source: { core: "machine-git" },
          reason: "Server gh login",
        },
      ],
    });

    expect(result.envVars).toEqual({
      PATH: "/plugin/bin:/usr/bin",
      BB_SERVER_URL: "http://127.0.0.1:3334",
      BB_PROJECT_ID: "project-1",
      BB_THREAD_STORAGE: "/tmp/thread-storage/thread-1",
      BB_THREAD_ID: "thread-1",
      BB_ENVIRONMENT_ID: "env-1",
      ANTHROPIC_AUTH_TOKEN: "pool-bearer-token",
      ANTHROPIC_BASE_URL:
        "http://127.0.0.1:3334/plugins/account-pool/anthropic",
      GH_TOKEN: "machine-git-token",
    });
    expect(result.entries).toEqual([
      { name: "BB_SERVER_URL", source: "shell", value: { masked: true } },
      { name: "BB_PROJECT_ID", source: "shell", value: { masked: true } },
      { name: "BB_THREAD_STORAGE", source: "shell", value: { masked: true } },
      { name: "BB_THREAD_ID", source: "shell", value: { masked: true } },
      { name: "BB_ENVIRONMENT_ID", source: "shell", value: { masked: true } },
      {
        name: "PATH",
        source: { plugin: "toolchain" },
        value: { masked: true },
        reason: "Use the plugin toolchain",
      },
      {
        name: "ANTHROPIC_AUTH_TOKEN",
        source: { plugin: "account-pool" },
        value: { masked: true },
        reason: "Route Claude through the account pool",
      },
      {
        name: "ANTHROPIC_BASE_URL",
        source: { plugin: "account-pool" },
        value: { masked: true },
        reason: "Use the account pool proxy",
      },
      {
        name: "GH_TOKEN",
        source: { core: "machine-git" },
        value: { masked: true },
        reason: "Server gh login",
      },
    ]);
    expect(result.droppedContributions).toEqual([]);
  });
});
