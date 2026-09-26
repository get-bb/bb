import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  fileReads: [] as string[],
  files: {} as Record<string, string | null>,
  keychainReads: [] as string[],
  keychains: {} as Record<string, string | null>,
  file: "",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: readonly string[],
    _options: object,
    callback: (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    const service = args[args.indexOf("-s") + 1] ?? "";
    state.keychainReads.push(service);
    const value = state.keychains[service];
    if (value == null) {
      callback(new Error("not found"), { stdout: "", stderr: "" });
      return;
    }
    callback(null, { stdout: value, stderr: "" });
  },
}));

vi.mock("node:os", () => ({
  default: {
    homedir: () => "/test-home",
    userInfo: () => ({ username: "test-user" }),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (file: string) => {
      state.fileReads.push(file);
      const value = state.files[file];
      if (value === null) return Promise.reject(new Error("not found"));
      return Promise.resolve(
        value ??
          (file.endsWith(".credentials.json")
            ? state.file
            : JSON.stringify({ oauthAccount: { emailAddress: null } })),
      );
    },
  },
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () => Promise.resolve("/test/claude"),
}));

import { getClaudeProviderUsage } from "./provider-maintenance.js";

const originalPlatform = process.platform;

beforeAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "darwin",
  });
});

afterAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  const credentials = JSON.stringify({
    claudeAiOauth: {
      accessToken: "test-access-token",
      expiresAt: null,
      subscriptionType: "pro",
      rateLimitTier: "default_claude_max_5x",
    },
  });
  state.file = credentials;
  state.fileReads = [];
  state.files = {};
  state.keychainReads = [];
  state.keychains = {
    "Claude Code-credentials": Buffer.from(credentials, "utf8").toString("hex"),
  };
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ limits: [] }),
    }),
  );
});

describe("Claude Code credential loading", () => {
  it("loads a hex-encoded Keychain credential", async () => {
    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({ status: "ok" }),
    });
  });

  it("uses the credential file when the Keychain value is invalid", async () => {
    state.keychains["Claude Code-credentials"] = "invalid-keychain-value";

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({ status: "ok" }),
    });
  });

  it("loads the custom profile Keychain service and account", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/test-home/custom-claude");
    state.keychains = {
      "Claude Code-credentials": JSON.stringify({
        claudeAiOauth: {
          accessToken: "stale-default-token",
          expiresAt: 1,
          subscriptionType: "pro",
          rateLimitTier: null,
        },
      }),
      "Claude Code-credentials-aa6e28bf": Buffer.from(
        state.file,
        "utf8",
      ).toString("hex"),
    };
    state.files["/test-home/custom-claude/.claude.json"] = JSON.stringify({
      oauthAccount: {
        emailAddress: "custom@example.com",
        accountUuid: "00000000-0000-4000-8000-000000000001",
      },
    });

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({
        status: "ok",
        accountEmail: "custom@example.com",
        accountKey: "anthropic:account:00000000-0000-4000-8000-000000000001",
      }),
    });
    expect(state.keychainReads).toEqual(["Claude Code-credentials-aa6e28bf"]);
    expect(state.fileReads).toEqual(["/test-home/custom-claude/.claude.json"]);
  });

  it("uses custom profile files before the default Keychain fallback", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "custom-claude");
    state.keychains = {
      "Claude Code-credentials": "invalid-default-profile",
    };
    state.files["/test-home/custom-claude/.credentials.json"] = state.file;

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({ status: "ok" }),
    });
    expect(state.keychainReads).toEqual([
      "Claude Code-credentials-aa6e28bf",
      "Claude Code-credentials-aa6e28bf",
    ]);
    expect(state.fileReads).toContain(
      "/test-home/custom-claude/.credentials.json",
    );
    expect(state.keychainReads).not.toContain("Claude Code-credentials");
  });

  it("distinguishes usage-check throttling from an exhausted Claude limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({
        status: "error",
        message:
          "Anthropic temporarily throttled this usage check. This does not mean your Claude limit is exhausted. Try again later.",
      }),
    });
  });
});
