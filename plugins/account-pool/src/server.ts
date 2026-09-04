import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerPoolCli } from "./cli.js";
import type { ImportedClaudeCredentials } from "./credentials.js";
import { createHub } from "./hub.js";
import { PoolOperations } from "./operations.js";
import { accountPoolRpcContract, createRpcHandlers } from "./rpc.js";
import { ClaudeOAuthLogin } from "./oauth-login.js";
import { ACCOUNT_POOL_ACCOUNTS_CHANGED } from "./realtime.js";
import {
  AccountStore,
  HubTokenStore,
  QUOTA_MIGRATIONS,
  QuotaStore,
  RoutingStore,
} from "./store.js";

export interface AccountPoolPluginOptions {
  fetch?: typeof fetch;
  now?: () => number;
  refreshUrl?: string;
  drainTimeoutMs?: number;
  disposeTimeoutMs?: number;
  importCredentials?: () => Promise<ImportedClaudeCredentials>;
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthProfileUrl?: string;
}

const DISPOSE_INSPECTION_TIMEOUT_MS = 2_000;
const DISPOSE_INSPECTION_TIMEOUT = Symbol("dispose-inspection-timeout");

export function helloResponse(): Response {
  return new Response(null, { status: 200 });
}

const upstreamSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Must be an HTTP or HTTPS URL.");

export function createAccountPoolPlugin(
  options: AccountPoolPluginOptions = {},
) {
  return async function accountPoolPlugin(bb: BbPluginApi): Promise<void> {
    const settings = bb.settings.define({
      upstreamBaseUrl: {
        type: "string",
        label: "Anthropic upstream base URL",
        description:
          "Override only for tests and QA. Production traffic uses https://api.anthropic.com.",
        default: "https://api.anthropic.com",
        experimental_schema: upstreamSchema,
      },
      switchThreshold: {
        type: "number",
        label: "Quota switch threshold",
        description:
          "Stop selecting an account when its 5-hour or 7-day utilization reaches this fraction.",
        default: 0.98,
        experimental_schema: z.number().min(0).max(1),
      },
    });
    let currentSettings = await settings.get();
    settings.onChange((next) => {
      currentSettings = next;
    });
    const secretDir = path.join(
      bb.server.experimental_dataDir,
      "plugins",
      bb.pluginId,
      "secrets",
      "accounts",
    );
    const accounts = new AccountStore(bb.storage.kv, secretDir);
    await accounts.initialize();
    const now = options.now ?? Date.now;
    const hubTokens = new HubTokenStore(secretDir, now);
    await hubTokens.initialize();
    const enrolledHosts = await bb.sdk.hosts.list();
    await hubTokens.prune(enrolledHosts.map((host) => host.id));
    const routing = new RoutingStore(bb.storage.kv, now);
    const db = bb.storage.database();
    bb.storage.migrate(db, QUOTA_MIGRATIONS);
    const quotas = new QuotaStore(db);
    const hub = createHub({
      accounts,
      quotas,
      hubTokens,
      getSettings: () => currentSettings,
      fetch: options.fetch,
      now,
      refreshUrl: options.refreshUrl,
      drainTimeoutMs: options.drainTimeoutMs,
    });
    const operations = new PoolOperations(
      accounts,
      quotas,
      hub,
      hubTokens,
      routing,
      () => bb.sdk.hosts.list(),
      async (hostId) =>
        (await bb.sdk.system.providerStates({ hostId })).providers,
      now,
      options.importCredentials,
      () => bb.realtime.publish(ACCOUNT_POOL_ACCOUNTS_CHANGED, {}),
    );
    const login = new ClaudeOAuthLogin({
      fetch: options.fetch,
      now,
      authorizeUrl: options.oauthAuthorizeUrl,
      tokenUrl: options.oauthTokenUrl,
      profileUrl: options.oauthProfileUrl,
      addAccount: (authenticated) => operations.addOAuth(authenticated),
    });
    if ((await accounts.list()).every((account) => !account.enabled)) {
      bb.status.needsConfiguration(
        "Add and enable a Claude account with `bb pool account add`.",
      );
    }
    bb.rpc.register(
      accountPoolRpcContract,
      createRpcHandlers(operations, login),
    );
    registerPoolCli(bb, operations, login);
    bb.providers.experimental_contributeEnv("claude-code", async (context) => {
      if (
        (await routing.isBypassed(context.threadId)) ||
        !(await operations.hasUsableEnabledAccount())
      ) {
        return [];
      }
      const token = await hubTokens.forHost(context.hostId);
      await routing.recordRouted(context.threadId, context.hostId);
      return [
        {
          name: "ANTHROPIC_BASE_URL",
          value: {
            serverPath: "/api/v1/plugins/account-pool/http",
          },
          reason: "Routed through the Account Pool hub",
          secret: false,
        },
        {
          name: "ANTHROPIC_AUTH_TOKEN",
          value: token,
          reason: "Account Pool hub token for this machine",
          secret: true,
        },
        {
          name: "ENABLE_TOOL_SEARCH",
          value: "true",
          reason:
            "Claude Code turns tool search off behind a custom base URL; the hub forwards tool_reference blocks",
          secret: false,
        },
      ];
    });
    bb.providers.experimental_contributeEnvHealth("claude-code", async () =>
      (await operations.hasUsableEnabledAccount())
        ? {
            label: "Proxied",
            statusMessage: "Credentials are provided by the Account Pool hub.",
          }
        : null,
    );
    bb.onDispose(async () => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const inspection = inspectDisableState(bb, operations);
        const timeout = new Promise<typeof DISPOSE_INSPECTION_TIMEOUT>(
          (resolve) => {
            timer = setTimeout(
              () => resolve(DISPOSE_INSPECTION_TIMEOUT),
              options.disposeTimeoutMs ?? DISPOSE_INSPECTION_TIMEOUT_MS,
            );
            timer.unref();
          },
        );
        const result = await Promise.race([inspection, timeout]);
        if (result === DISPOSE_INSPECTION_TIMEOUT) {
          bb.log.debug("Account Pool disable inspection timed out.");
          return;
        }
        if (result !== null) bb.log.warn(result);
      } catch (error) {
        bb.log.debug(
          `Account Pool disable inspection skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    });
    bb.http.route(
      "POST",
      "/v1/messages",
      (context) => hub.handle(context.req.raw),
      { auth: "none" },
    );
    bb.http.route(
      "POST",
      "/v1/messages/count_tokens",
      (context) => hub.handle(context.req.raw),
      { auth: "none" },
    );
    bb.http.route("HEAD", "/api/hello", () => helloResponse(), {
      auth: "none",
    });
    bb.background.service("hub", {
      start: (signal) => hub.start(signal),
    });
  };
}

async function inspectDisableState(
  bb: BbPluginApi,
  operations: PoolOperations,
): Promise<string | null> {
  const installed = await bb.sdk.plugins.list();
  const disabled =
    installed.plugins.find((plugin) => plugin.id === bb.pluginId)?.enabled ===
    false;
  if (!disabled) return null;
  const warnings = await operations.routedThreadsWithoutLocalLogin();
  if (warnings.length === 0) return null;
  return `Account Pool disabled with ${warnings.length} recently routed thread${warnings.length === 1 ? "" : "s"} on machines without a local Claude login. Run bb pool status before disabling to inspect them.`;
}

export default createAccountPoolPlugin();
