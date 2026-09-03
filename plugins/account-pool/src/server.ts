import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerPoolCli } from "./cli.js";
import type { ImportedClaudeCredentials } from "./credentials.js";
import { createHub } from "./hub.js";
import { PoolOperations } from "./operations.js";
import { accountPoolRpcContract, createRpcHandlers } from "./rpc.js";
import { AccountStore, QUOTA_MIGRATIONS, QuotaStore } from "./store.js";

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
    const db = bb.storage.database();
    bb.storage.migrate(db, QUOTA_MIGRATIONS);
    const quotas = new QuotaStore(db);
    const hubKey = await accounts.hubKey();
    const hub = createHub({
      accounts,
      quotas,
      hubKey,
      getSettings: () => currentSettings,
      fetch: options.fetch,
      now: options.now,
      refreshUrl: options.refreshUrl,
      drainTimeoutMs: options.drainTimeoutMs,
    });
    const operations = new PoolOperations(
      accounts,
      quotas,
      hub,
      options.importCredentials,
    );
    if ((await accounts.list()).every((account) => !account.enabled)) {
      bb.status.needsConfiguration(
        "Add and enable a Claude account with `bb pool account add`.",
      );
    }
    bb.rpc.register(accountPoolRpcContract, createRpcHandlers(operations));
    registerPoolCli(bb, operations);
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
    bb.http.route(
      "HEAD",
      "/api/hello",
      () => helloResponse(),
      { auth: "none" },
    );
    bb.background.service("hub", {
      start: (signal) => hub.start(signal),
    });
  };
}

export default createAccountPoolPlugin();
