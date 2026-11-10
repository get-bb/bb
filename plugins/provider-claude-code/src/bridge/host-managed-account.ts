import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const BOOTSTRAP_PATH = "/api/claude_cli/bootstrap";
const BOOTSTRAP_TIMEOUT_MS = 5_000;
const OAUTH_BETA = "oauth-2025-04-20";

const ACCOUNT_SCOPED_CONFIG_KEYS = [
  "oauthAccount",
  "managedSettingsNoticeSeenOrg",
  "additionalModelOptionsCache",
  "additionalModelOptionsAnsweredAt",
  "additionalModelCostsCache",
  "modelAccessCache",
  "orgModelDefaultCache",
  "cachedArtifactRoster",
  "artifactRosterDenied",
  "lastSeenOrgDefaultUpdatedAt",
  "clientDataCache",
  "clientDataCacheSlots",
  "autoCompactWindowsCache",
  "cachedUsageUtilization",
  "metricsStatusCache",
  "metricsStatusCacheByPrincipal",
  "githubWebConnectionStatusCache",
  "unusedLimitResetStatusCache",
  "startupPrefetchedAt",
] as const;

const bootstrapSchema = z.object({
  additional_model_options: z
    .array(
      z.object({
        model: z.string(),
        name: z.string(),
        description: z.string(),
        disabled_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  additional_model_costs: z
    .record(
      z.string(),
      z.object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        prompt_cache_write_tokens: z.number(),
        prompt_cache_write_1h_tokens: z.number().nullish(),
        prompt_cache_read_tokens: z.number(),
        web_search_requests: z.number().nullish(),
      }),
    )
    .nullish(),
  model_access: z
    .array(
      z.object({
        api_name: z.string(),
        entitled: z.boolean(),
        max_effort_level: z.string().nullish(),
      }),
    )
    .nullish(),
  org_model_default: z.record(z.string(), z.unknown()).nullish(),
  oauth_account: z
    .object({ organization_uuid: z.string().nullish() })
    .passthrough()
    .nullish(),
});

type Bootstrap = z.infer<typeof bootstrapSchema>;

const storedConfigSchema = z.record(z.string(), z.unknown());

interface HostManagedAccountDeps {
  fetch?: typeof fetch;
  now?: () => number;
  home?: string;
}

function hostManagedBootstrapUrl(env: NodeJS.ProcessEnv): URL | null {
  const baseUrl = env.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST !== "1" || !baseUrl || !token) {
    return null;
  }
  try {
    const url = new URL(`${baseUrl.replace(/\/+$/u, "")}${BOOTSTRAP_PATH}`);
    url.searchParams.set("entrypoint", "sdk-ts");
    return url;
  } catch {
    return null;
  }
}

async function fetchBootstrap(
  url: URL,
  token: string,
  fetchImpl: typeof fetch,
): Promise<Bootstrap | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "anthropic-beta": OAUTH_BETA,
      },
      signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const parsed = bootstrapSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function accountCaches(
  bootstrap: Bootstrap,
  now: number,
): Record<string, unknown> {
  const organizationUuid = bootstrap.oauth_account?.organization_uuid;
  return {
    additionalModelOptionsCache: (bootstrap.additional_model_options ?? []).map(
      (option) => {
        const reason = option.disabled_reason;
        if (reason === null || reason === undefined) {
          return {
            value: option.model,
            label: option.name,
            description: option.description,
          };
        }
        return {
          value: option.model,
          label: `${option.name} (disabled)`,
          description: option.description
            ? `${option.description} \u00b7 ${reason}`
            : reason,
          disabled: true,
        };
      },
    ),
    additionalModelOptionsAnsweredAt: now,
    additionalModelCostsCache: Object.fromEntries(
      Object.entries(bootstrap.additional_model_costs ?? {}).map(
        ([model, cost]) => [
          model,
          {
            inputTokens: cost.input_tokens,
            outputTokens: cost.output_tokens,
            promptCacheWriteTokens: cost.prompt_cache_write_tokens,
            ...(cost.prompt_cache_write_1h_tokens == null
              ? {}
              : {
                  promptCacheWrite1hTokens: cost.prompt_cache_write_1h_tokens,
                }),
            promptCacheReadTokens: cost.prompt_cache_read_tokens,
            webSearchRequests: cost.web_search_requests ?? 0.01,
          },
        ],
      ),
    ),
    modelAccessCache: (bootstrap.model_access ?? []).map((access) => ({
      apiName: access.api_name,
      entitled: access.entitled,
      ...(access.max_effort_level == null
        ? {}
        : { maxEffortLevel: access.max_effort_level }),
    })),
    orgModelDefaultCache:
      bootstrap.org_model_default == null
        ? null
        : {
            ...bootstrap.org_model_default,
            ...(organizationUuid ? { orgUuid: organizationUuid } : {}),
          },
  };
}

async function readStoredConfig(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = storedConfigSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readUserConfig(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<Record<string, unknown>> {
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const configFile = env.CLAUDE_CONFIG_DIR
    ? join(env.CLAUDE_CONFIG_DIR, ".claude.json")
    : join(home, ".claude.json");
  return (
    (await readStoredConfig(configFile)) ??
    (await readStoredConfig(join(configDir, ".config.json"))) ??
    {}
  );
}

async function copyIfPresent(from: string, to: string): Promise<void> {
  try {
    await copyFile(from, to);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}

export async function withHostManagedAccountConfig<T>(
  env: NodeJS.ProcessEnv,
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
  deps: HostManagedAccountDeps = {},
): Promise<T> {
  const url = hostManagedBootstrapUrl(env);
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (url === null || !token) return run(env);
  const bootstrap = await fetchBootstrap(url, token, deps.fetch ?? fetch);
  if (bootstrap === null) return run(env);

  const home = deps.home ?? homedir();
  const userConfig = await readUserConfig(env, home);
  for (const key of ACCOUNT_SCOPED_CONFIG_KEYS) delete userConfig[key];
  const configDir = await mkdtemp(join(tmpdir(), "bb-claude-account-"));
  try {
    await writeFile(
      join(configDir, ".claude.json"),
      JSON.stringify({
        ...userConfig,
        ...accountCaches(bootstrap, (deps.now ?? Date.now)()),
      }),
      { mode: 0o600 },
    );
    await copyIfPresent(
      join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "settings.json"),
      join(configDir, "settings.json"),
    );
    return await run({ ...env, CLAUDE_CONFIG_DIR: configDir });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}
