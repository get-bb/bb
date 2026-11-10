import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withHostManagedAccountConfig } from "../host-managed-account.js";

const pooledEnv = {
  ANTHROPIC_BASE_URL: "http://127.0.0.1:4000/api/v1/plugins/account-pool/http/",
  ANTHROPIC_AUTH_TOKEN: "hub-token",
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
};

const staleUserConfig = {
  hasCompletedOnboarding: true,
  projects: { "/work": { allowedTools: ["Bash"] } },
  oauthAccount: { accountUuid: "lapsed-account" },
  additionalModelOptionsCache: [
    { value: "claude-old[1m]", label: "Old", description: "Lapsed login" },
  ],
  additionalModelOptionsAnsweredAt: 1,
  clientDataCacheSlots: { slot: { data: {}, at: 1 } },
  modelAccessCache: [{ apiName: "claude-old", entitled: true }],
};

const bootstrapAnswer = {
  additional_model_options: [
    { model: "claude-next[1m]", name: "Next", description: "Newest" },
    {
      model: "claude-preview",
      name: "Preview",
      description: "Early",
      disabled_reason: "Ask an admin",
    },
  ],
  additional_model_costs: {
    "claude-next": {
      input_tokens: 5,
      output_tokens: 25,
      prompt_cache_write_tokens: 6,
      prompt_cache_read_tokens: 0.5,
    },
  },
  model_access: [
    { api_name: "claude-next", entitled: true, max_effort_level: "max" },
  ],
  org_model_default: {
    name: "claude-next",
    updated_at: "2026-11-01T00:00:00Z",
    data_source: "org",
    override_user_selection: false,
  },
  oauth_account: { organization_uuid: "org-1", account_email: "a@b.c" },
};

const cleanups: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "bb-claude-home-"));
  cleanups.push(home);
  await writeFile(join(home, ".claude.json"), JSON.stringify(staleUserConfig));
  await mkdir(join(home, ".claude"));
  await writeFile(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ model: "opus" }),
  );
  return home;
}

afterEach(async () => {
  await Promise.all(
    cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("withHostManagedAccountConfig", () => {
  it("runs Claude Code against the routed account's bootstrap instead of a lapsed login's caches", async () => {
    const home = await makeHome();
    const fetch = vi.fn(async () => Response.json(bootstrapAnswer));
    let seen: {
      env: NodeJS.ProcessEnv;
      config: unknown;
      settings: unknown;
    } | null = null;

    const result = await withHostManagedAccountConfig(
      pooledEnv,
      async (env) => {
        const dir = env.CLAUDE_CONFIG_DIR ?? "";
        seen = {
          env,
          config: JSON.parse(await readFile(join(dir, ".claude.json"), "utf8")),
          settings: JSON.parse(
            await readFile(join(dir, "settings.json"), "utf8"),
          ),
        };
        return "probed";
      },
      { fetch, home, now: () => 42 },
    );

    expect(result).toBe("probed");
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        "http://127.0.0.1:4000/api/v1/plugins/account-pool/http/api/claude_cli/bootstrap?entrypoint=sdk-ts",
      ),
      expect.objectContaining({
        headers: {
          accept: "application/json",
          authorization: "Bearer hub-token",
          "anthropic-beta": "oauth-2025-04-20",
        },
      }),
    );
    expect(seen).not.toBeNull();
    expect(seen!.env).toMatchObject(pooledEnv);
    expect(seen!.settings).toEqual({ model: "opus" });
    expect(seen!.config).toEqual({
      hasCompletedOnboarding: true,
      projects: { "/work": { allowedTools: ["Bash"] } },
      additionalModelOptionsCache: [
        { value: "claude-next[1m]", label: "Next", description: "Newest" },
        {
          value: "claude-preview",
          label: "Preview (disabled)",
          description: "Early \u00b7 Ask an admin",
          disabled: true,
        },
      ],
      additionalModelOptionsAnsweredAt: 42,
      additionalModelCostsCache: {
        "claude-next": {
          inputTokens: 5,
          outputTokens: 25,
          promptCacheWriteTokens: 6,
          promptCacheReadTokens: 0.5,
          webSearchRequests: 0.01,
        },
      },
      modelAccessCache: [
        { apiName: "claude-next", entitled: true, maxEffortLevel: "max" },
      ],
      orgModelDefaultCache: {
        ...bootstrapAnswer.org_model_default,
        orgUuid: "org-1",
      },
    });
    await expect(
      readdir(seen!.env.CLAUDE_CONFIG_DIR ?? ""),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await readFile(join(home, ".claude.json"), "utf8")),
    ).toEqual(staleUserConfig);
  });

  it("reads the user's config from CLAUDE_CONFIG_DIR when it is set", async () => {
    const home = await makeHome();
    const configDir = await mkdtemp(join(tmpdir(), "bb-claude-config-"));
    cleanups.push(configDir);
    await writeFile(
      join(configDir, ".claude.json"),
      JSON.stringify({ theme: "light", oauthAccount: { accountUuid: "x" } }),
    );
    let config: unknown = null;

    await withHostManagedAccountConfig(
      { ...pooledEnv, CLAUDE_CONFIG_DIR: configDir },
      async (env) => {
        config = JSON.parse(
          await readFile(
            join(env.CLAUDE_CONFIG_DIR ?? "", ".claude.json"),
            "utf8",
          ),
        );
      },
      {
        fetch: async () => Response.json({}),
        home,
        now: () => 7,
      },
    );

    expect(config).toEqual({
      theme: "light",
      additionalModelOptionsCache: [],
      additionalModelOptionsAnsweredAt: 7,
      additionalModelCostsCache: {},
      modelAccessCache: [],
      orgModelDefaultCache: null,
    });
  });

  it.each([
    [
      "the host does not manage the login",
      { ...pooledEnv, CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: undefined },
      0,
    ],
    [
      "there is no base URL",
      { ...pooledEnv, ANTHROPIC_BASE_URL: undefined },
      0,
    ],
    ["the bootstrap is refused", pooledEnv, 1],
  ])(
    "probes with the unchanged environment when %s",
    async (_case, env, fetches) => {
      const home = await makeHome();
      const fetch = vi.fn(async () => new Response("no", { status: 404 }));
      const run = vi.fn(async (probeEnv: NodeJS.ProcessEnv) => probeEnv);

      await expect(
        withHostManagedAccountConfig(env, run, { fetch, home }),
      ).resolves.toBe(env);
      expect(fetch).toHaveBeenCalledTimes(fetches);
    },
  );

  it("probes with the unchanged environment when the hub is unreachable", async () => {
    const home = await makeHome();
    const run = vi.fn(async (probeEnv: NodeJS.ProcessEnv) => probeEnv);

    await expect(
      withHostManagedAccountConfig(pooledEnv, run, {
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
        home,
      }),
    ).resolves.toBe(pooledEnv);
  });
});
