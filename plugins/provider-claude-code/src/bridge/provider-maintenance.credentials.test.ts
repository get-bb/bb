import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  keychain: "",
  file: "",
  keychainByService: null as Record<string, string> | null,
  filesByPath: null as Record<string, string> | null,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    execFile: (
      _file: string,
      args: readonly string[],
      _options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const stored =
        state.keychainByService === null
          ? state.keychain
          : state.keychainByService[args[args.indexOf("-s") + 1] ?? ""];
      queueMicrotask(() => {
        if (stored === undefined) {
          callback(new Error("item not found"), "", "");
        } else {
          callback(null, stored, "");
        }
      });
      return new EventEmitter();
    },
  };
});

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (file: string) => {
      if (state.filesByPath !== null) {
        const stored = state.filesByPath[file];
        return stored === undefined
          ? Promise.reject(new Error(`ENOENT: ${file}`))
          : Promise.resolve(stored);
      }
      return Promise.resolve(
        file.endsWith(".credentials.json")
          ? state.file
          : JSON.stringify({ oauthAccount: { emailAddress: null } }),
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

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
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

beforeEach(() => {
  state.keychainByService = null;
  state.filesByPath = null;
  vi.unstubAllEnvs();
  const credentials = JSON.stringify({
    claudeAiOauth: {
      accessToken: "test-access-token",
      expiresAt: null,
      subscriptionType: "pro",
      rateLimitTier: "default_claude_max_5x",
    },
  });
  state.file = credentials;
  state.keychain = Buffer.from(credentials, "utf8").toString("hex");
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
    state.keychain = "invalid-keychain-value";

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({ status: "ok" }),
    });
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

describe("Claude Code credentials under CLAUDE_CONFIG_DIR", () => {
  function oauth(accessToken: string, expiresAt: number | null): string {
    return JSON.stringify({
      claudeAiOauth: {
        accessToken,
        expiresAt,
        subscriptionType: "pro",
        rateLimitTier: "default_claude_max_5x",
      },
    });
  }
  const profile = "/profiles/personal";
  const profileService = `Claude Code-credentials-${createHash("sha256").update(profile).digest("hex").slice(0, 8)}`;
  const expired = oauth("stale-default-token", 1);
  const valid = oauth("profile-token", null);

  it("reads the profile's Keychain item and account, not the default profile's", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", profile);
    state.keychainByService = {
      "Claude Code-credentials": expired,
      [profileService]: valid,
    };
    state.filesByPath = {
      [path.join(os.homedir(), ".claude.json")]: JSON.stringify({
        oauthAccount: { emailAddress: "default@example.com" },
      }),
      [path.join(profile, ".claude.json")]: JSON.stringify({
        oauthAccount: { emailAddress: "profile@example.com" },
      }),
    };

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({
        status: "ok",
        accountEmail: "profile@example.com",
      }),
    });
  });

  it("falls back to the profile's credential file, never the default one", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", profile);
    state.keychainByService = { "Claude Code-credentials": valid };
    state.filesByPath = {
      [path.join(os.homedir(), ".claude", ".credentials.json")]: valid,
      [path.join(profile, ".credentials.json")]: expired,
    };

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: { status: "expired" },
    });
  });
});
