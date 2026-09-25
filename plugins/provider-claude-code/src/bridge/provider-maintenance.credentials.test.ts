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
  settings: null as string | null,
  localSettings: null as string | null,
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => callback(null, { stdout: state.keychain, stderr: "" }),
}));

function missingFile(): Promise<never> {
  return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
}

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (file: string) => {
      if (file.endsWith(".credentials.json"))
        return Promise.resolve(state.file);
      if (file.endsWith("settings.json")) {
        return state.settings === null
          ? missingFile()
          : Promise.resolve(state.settings);
      }
      if (file.endsWith("settings.local.json")) {
        return state.localSettings === null
          ? missingFile()
          : Promise.resolve(state.localSettings);
      }
      return Promise.resolve(
        JSON.stringify({ oauthAccount: { emailAddress: null } }),
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

import {
  getClaudeProviderHealth,
  getClaudeProviderUsage,
} from "./provider-maintenance.js";

const originalPlatform = process.platform;
const originalApiKey = process.env.ANTHROPIC_API_KEY;

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
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
  vi.unstubAllGlobals();
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
  state.keychain = Buffer.from(credentials, "utf8").toString("hex");
  state.settings = null;
  state.localSettings = null;
  delete process.env.ANTHROPIC_API_KEY;
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

describe("Claude Code provider health authentication", () => {
  function clearOauthCredentials() {
    state.keychain = "";
    state.file = "";
  }

  it("keeps the OAuth plan label when OAuth credentials exist alongside an API key", async () => {
    state.settings = JSON.stringify({ env: { ANTHROPIC_API_KEY: "sk-test" } });

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toEqual(
      expect.objectContaining({ status: "ready", planLabel: "Max (5x)" }),
    );
  });

  it("reports ready for an API key in settings.json without OAuth credentials", async () => {
    clearOauthCredentials();
    state.settings = JSON.stringify({ env: { ANTHROPIC_API_KEY: "sk-test" } });

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toEqual(
      expect.objectContaining({
        status: "ready",
        planLabel: "API key",
        accountEmail: null,
      }),
    );
  });

  it("reports ready for an apiKeyHelper in settings.local.json", async () => {
    clearOauthCredentials();
    state.localSettings = JSON.stringify({ apiKeyHelper: "~/bin/key.sh" });

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toEqual(
      expect.objectContaining({ status: "ready", planLabel: "API key" }),
    );
  });

  it("reports ready for ANTHROPIC_API_KEY in the bridge environment", async () => {
    clearOauthCredentials();
    process.env.ANTHROPIC_API_KEY = "sk-test";

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toEqual(
      expect.objectContaining({ status: "ready", planLabel: "API key" }),
    );
  });

  it("reports unauthenticated without OAuth credentials or an API key", async () => {
    clearOauthCredentials();
    state.settings = JSON.stringify({ env: { ANTHROPIC_API_KEY: "  " } });

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toEqual(
      expect.objectContaining({ status: "unauthenticated", planLabel: null }),
    );
  });

  it("reports unauthenticated when settings.json is malformed", async () => {
    clearOauthCredentials();
    state.settings = "{ not json";

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toEqual(
      expect.objectContaining({ status: "unauthenticated" }),
    );
  });
});
