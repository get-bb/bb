import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerPoolCli } from "./cli.js";
import type { ImportedClaudeCredentials } from "./credentials.js";
import { createHub } from "./hub.js";
import { PoolOperations } from "./operations.js";
import { accountPoolRpcContract, createRpcHandlers } from "./rpc.js";
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
  importCredentials?: () => Promise<ImportedClaudeCredentials>;
}

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
    );
    if ((await accounts.list()).every((account) => !account.enabled)) {
      bb.status.needsConfiguration(
        "Add and enable a Claude account with `bb pool account add`.",
      );
    }
    bb.rpc.register(accountPoolRpcContract, createRpcHandlers(operations));
    registerPoolCli(bb, operations);
    bb.providers.experimental_contributeEnv("claude-code", async (context) => {
      if (
        (await routing.isBypassed(context.threadId)) ||
        !(await operations.hasEnabledAccount())
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
      ];
    });
    bb.providers.experimental_contributeEnvHealth("claude-code", async () =>
      (await operations.hasEnabledAccount())
        ? {
            label: "Proxied",
            statusMessage: "Credentials are provided by the Account Pool hub.",
          }
        : null,
    );
    bb.onDispose(async () => {
      const installed = await bb.sdk.plugins.list();
      const disabled =
        installed.plugins.find((plugin) => plugin.id === bb.pluginId)
          ?.enabled === false;
      if (!disabled) return;
      const warnings = await operations.routedThreadsWithoutLocalLogin();
      if (warnings.length === 0) return;
      bb.log.warn(
        `Account Pool disabled with ${warnings.length} recently routed thread${warnings.length === 1 ? "" : "s"} on machines without a local Claude login. Run bb pool status before disabling to inspect them.`,
      );
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

export default createAccountPoolPlugin();
