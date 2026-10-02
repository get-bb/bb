import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerUsageResultSchema } from "@bb/provider-bridge-protocol";
import { captureBridgeJsonRpcOutput } from "@bb/provider-bridge-protocol/testing";
import { readOpenCodeGoUsage } from "./opencode-usage.js";

const reportedUsage = {
  usage: {
    rolling: {
      status: "ok",
      percent: 12.5,
      resetsAt: "2026-09-22T13:00:00.000Z",
    },
    weekly: {
      status: "rate-limited",
      percent: 100,
      resetsAt: "2026-09-28T00:00:00.000Z",
    },
    monthly: {
      status: "ok",
      percent: 43.2,
      resetsAt: "2026-10-01T00:00:00.000Z",
    },
  },
};

let directory: string;
let env: NodeJS.ProcessEnv;
const fetchUsage = vi.fn<typeof fetch>();

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "bb-opencode-usage-"));
  env = { XDG_DATA_HOME: directory, HOME: directory };
  fetchUsage.mockReset();
  fetchUsage.mockImplementation(async () => Response.json(reportedUsage));
  vi.stubGlobal("fetch", fetchUsage);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

async function writeAuth(value: unknown, root = directory) {
  await fs.mkdir(path.join(root, "opencode"), { recursive: true });
  await fs.writeFile(
    path.join(root, "opencode", "auth.json"),
    JSON.stringify(value),
  );
}

async function writeAccount(
  overrides: {
    url?: string;
    orgId?: string | null;
    expiry?: number | null;
  } = {},
) {
  await fs.mkdir(path.join(directory, "opencode"), { recursive: true });
  const database = new DatabaseSync(
    path.join(directory, "opencode", "opencode.db"),
  );
  try {
    database.exec(
      "CREATE TABLE account (id TEXT PRIMARY KEY, email TEXT NOT NULL, url TEXT NOT NULL, access_token TEXT NOT NULL, token_expiry INTEGER); CREATE TABLE account_state (id INTEGER PRIMARY KEY, active_account_id TEXT, active_org_id TEXT)",
    );
    database
      .prepare("INSERT INTO account VALUES (?, ?, ?, ?, ?)")
      .run(
        "account-test",
        "go@example.com",
        overrides.url ?? "https://opencode.ai/console",
        "console-token",
        overrides.expiry === undefined ? Date.now() + 60_000 : overrides.expiry,
      );
    database
      .prepare("INSERT INTO account_state VALUES (?, ?, ?)")
      .run(
        1,
        "account-test",
        overrides.orgId === undefined ? "org-test" : overrides.orgId,
      );
  } finally {
    database.close();
  }
}

describe("OpenCode Go usage", () => {
  it("reads the active Console account before legacy credentials and scopes usage to its organization", async () => {
    await writeAccount();
    await writeAuth({ "opencode-go": { type: "api", key: "old-key" } });
    const databasePath = path.join(directory, "opencode", "opencode.db");
    const before = await fs.readFile(databasePath);
    const result = providerUsageResultSchema.parse(
      await readOpenCodeGoUsage(env),
    );
    expect(result).toMatchObject({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: "go@example.com",
        accountKey: "opencode:organization:org-test:account:account-test",
        windows: [
          { usedPercent: 12.5 },
          { usedPercent: 100 },
          { usedPercent: 43.2 },
        ],
      },
    });
    expect(fetchUsage).toHaveBeenCalledExactlyOnceWith(
      "https://opencode.ai/inference/go/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer console-token",
          "x-opencode-org-id": "org-test",
        }),
      }),
    );
    expect(await fs.readFile(databasePath)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("console-token");
  });

  it("honors an explicit API key over an active Console account", async () => {
    await writeAccount();
    env.OPENCODE_API_KEY = "explicit-key";
    expect(await readOpenCodeGoUsage(env)).toMatchObject({
      usage: { status: "ok", accountEmail: null, accountKey: null },
    });
    expect(fetchUsage).toHaveBeenCalledExactlyOnceWith(
      "https://opencode.ai/zen/go/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer explicit-key",
        }),
      }),
    );
  });

  it.each([
    { url: "https://enterprise.example.com/console" },
    { url: "https://opencode.ai.attacker.example/console" },
    { orgId: null },
  ])(
    "does not send an unrelated or unscoped account token to Go",
    async (overrides) => {
      await writeAccount(overrides);
      expect(await readOpenCodeGoUsage(env)).toEqual({
        supported: true,
        usage: { status: "unauthenticated" },
      });
      expect(fetchUsage).not.toHaveBeenCalled();
    },
  );

  it("reports an expired Console token without modifying OpenCode's credentials", async () => {
    await writeAccount({ expiry: 1 });
    expect(await readOpenCodeGoUsage(env)).toEqual({
      supported: true,
      usage: { status: "expired" },
    });
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it("supports older OpenCode databases without Console account tables", async () => {
    await writeAuth({ "opencode-go": { type: "api", key: "legacy-key" } });
    const database = new DatabaseSync(
      path.join(directory, "opencode", "opencode.db"),
    );
    database.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    database.close();
    expect(await readOpenCodeGoUsage(env)).toMatchObject({
      usage: { status: "ok" },
    });
    expect(fetchUsage).toHaveBeenCalledExactlyOnceWith(
      "https://opencode.ai/zen/go/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer legacy-key",
        }),
      }),
    );
  });

  it("reads the configured Go key and preserves all reported windows and resets", async () => {
    await writeAuth({
      "opencode-go": { type: "api", key: "go-test-key" },
      opencode: { type: "api", key: "zen-test-key" },
    });
    const result = providerUsageResultSchema.parse(
      await readOpenCodeGoUsage(env),
    );
    expect(result).toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: null,
        accountKey: null,
        planLabel: "OpenCode Go",
        windows: [
          {
            label: "5 hour",
            kind: "five-hour",
            model: null,
            usedPercent: 12.5,
            resetsAt: reportedUsage.usage.rolling.resetsAt,
          },
          {
            label: "Weekly",
            kind: "weekly",
            model: null,
            usedPercent: 100,
            resetsAt: reportedUsage.usage.weekly.resetsAt,
          },
          {
            label: "Monthly",
            kind: "custom",
            model: null,
            usedPercent: 43.2,
            resetsAt: reportedUsage.usage.monthly.resetsAt,
          },
        ],
      },
    });
    expect(fetchUsage).toHaveBeenCalledExactlyOnceWith(
      "https://opencode.ai/zen/go/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer go-test-key",
        }),
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("reads a shared Zen key from the default OpenCode data directory", async () => {
    await writeAuth(
      { opencode: { type: "api", key: "zen-test-key" } },
      path.join(directory, ".local", "share"),
    );
    await readOpenCodeGoUsage({ HOME: directory });
    expect(fetchUsage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer zen-test-key",
        }),
      }),
    );
  });

  it("honors environment credentials before the auth file", async () => {
    await writeAuth({ "opencode-go": { type: "api", key: "file-key" } });
    env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      "opencode-go": { type: "api", key: "content-key" },
    });
    await readOpenCodeGoUsage(env);
    expect(fetchUsage).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer content-key",
        }),
      }),
    );
    env.OPENCODE_API_KEY = "env-key";
    await readOpenCodeGoUsage(env);
    expect(fetchUsage).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer env-key" }),
      }),
    );
  });

  it("does not collect quota when Go credentials are absent", async () => {
    expect(await readOpenCodeGoUsage(env)).toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
    await writeAuth({
      anthropic: { type: "api", key: "unrelated-key" },
      "opencode-go": { type: "oauth", access: "unsupported-key" },
    });
    expect(await readOpenCodeGoUsage(env)).toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it("reports unreadable credentials without exposing file contents", async () => {
    await writeAuth({});
    await fs.writeFile(
      path.join(directory, "opencode", "auth.json"),
      "broken secret-key",
    );
    expect(await readOpenCodeGoUsage(env)).toMatchObject({
      supported: true,
      usage: {
        status: "error",
        message: "OpenCode credentials could not be read.",
      },
    });
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it.each([
    [401, "expired"],
    [403, "error"],
    [429, "error"],
    [500, "error"],
  ])(
    "reports HTTP %i without manufacturing zero usage",
    async (status, expectedStatus) => {
      env.OPENCODE_API_KEY = "test-key";
      fetchUsage.mockResolvedValue(
        new Response("sensitive response body", { status }),
      );
      const result = await readOpenCodeGoUsage(env);
      expect(result).toMatchObject({
        supported: true,
        usage: { status: expectedStatus },
      });
      expect(JSON.stringify(result)).not.toContain("sensitive");
      expect(JSON.stringify(result)).not.toContain("windows");
    },
  );

  it.each([
    {},
    { usage: { ...reportedUsage.usage, weekly: undefined } },
    {
      usage: {
        ...reportedUsage.usage,
        rolling: { ...reportedUsage.usage.rolling, percent: -1 },
      },
    },
    {
      usage: {
        ...reportedUsage.usage,
        monthly: { ...reportedUsage.usage.monthly, resetsAt: "invalid" },
      },
    },
  ])("rejects malformed usage responses", async (body) => {
    env.OPENCODE_API_KEY = "test-key";
    fetchUsage.mockResolvedValue(Response.json(body));
    expect(await readOpenCodeGoUsage(env)).toMatchObject({
      supported: true,
      usage: {
        status: "error",
        message: "OpenCode Go returned invalid usage information.",
      },
    });
  });

  it("bounds overage to the existing maintenance protocol's percent range", async () => {
    env.OPENCODE_API_KEY = "test-key";
    fetchUsage.mockResolvedValue(
      Response.json({
        usage: {
          ...reportedUsage.usage,
          weekly: { ...reportedUsage.usage.weekly, percent: 105 },
        },
      }),
    );
    expect(
      providerUsageResultSchema.parse(await readOpenCodeGoUsage(env)),
    ).toMatchObject({
      usage: {
        status: "ok",
        windows: [expect.anything(), { usedPercent: 100 }, expect.anything()],
      },
    });
  });

  it("reports network failures without exposing credentials from exceptions", async () => {
    env.OPENCODE_API_KEY = "test-key";
    fetchUsage.mockRejectedValue(new Error("test-key"));
    const result = await readOpenCodeGoUsage(env);
    expect(result).toMatchObject({
      supported: true,
      usage: { status: "error" },
    });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("routes bridge usage requests to Go with the configured launch environment", async () => {
    const { handleLine } = await import("./bridge.js");
    vi.stubEnv("OPENCODE_API_KEY", "inherited-key");
    const output = captureBridgeJsonRpcOutput();
    try {
      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "go-usage-test",
          method: "provider/usage",
          params: {
            providerId: "test-opencode",
            providerOptions: {
              acpDialect: "opencode",
              acpLaunchSpec: {
                displayName: "OpenCode",
                command: process.execPath,
                args: [],
                env: { OPENCODE_API_KEY: "launch-key" },
              },
            },
          },
        }),
      );
      await vi.waitFor(() =>
        expect(
          output.messages.some((message) => message.id === "go-usage-test"),
        ).toBe(true),
      );
      const result = output.messages.find(
        (message) => message.id === "go-usage-test",
      )?.result;
      expect(providerUsageResultSchema.parse(result)).toMatchObject({
        supported: true,
        usage: {
          status: "ok",
          planLabel: "OpenCode Go",
          windows: expect.any(Array),
        },
      });
      expect(fetchUsage).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer launch-key",
          }),
        }),
      );
    } finally {
      output.restore();
    }
  });
});
