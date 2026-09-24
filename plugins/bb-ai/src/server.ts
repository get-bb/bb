import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
  type PluginAiServiceStatus,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ACCOUNT_PLUGIN_ID,
  accountFetchMethod,
  accountFetchOutputSchema,
  accountStatusMethod,
  accountStatusSchema,
  type Account,
  type AccountFetchInput,
  type AccountFetchOutput,
  type AccountStatus,
} from "./account-contract.js";
import { BB_CLOUD_DISCLOSURE, BB_CLOUD_OFF_MESSAGE } from "./disclosure.js";
import { formatResetTime, formatUsage } from "./format.js";

export const BB_AI_SERVICE_ID = "bb";
const COMPLETE_PATH = "/api/ai/v1/complete";
const USAGE_PATH = "/api/ai/v1/usage";
const COMPLETE_TIMEOUT_MS = 5_000;
const ENABLED_KEY = "enabled";
const SIGN_IN_MESSAGE = "Sign in to your bb account";
const ACCOUNT_DOWN_MESSAGE = "The bb account plugin is not running";

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const completeResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
  usage: z.object({
    costMicros: z.number().nonnegative(),
    spentTodayMicros: z.number().nonnegative(),
    limitMicros: z.number().nonnegative(),
  }),
});

export const usageSchema = z.object({
  day: z.string(),
  spentMicros: z.number().nonnegative(),
  limitMicros: z.number().nonnegative(),
  resetsAt: z.number(),
});
export type BbAiUsage = z.infer<typeof usageSchema>;

const gatewayErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    resetsAt: z.number().optional(),
  }),
});

const statusViewSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true) }),
  z.object({ ready: z.literal(false), message: z.string() }),
]);

const overviewSchema = z.object({
  enabled: z.boolean(),
  account: z.discriminatedUnion("state", [
    z.object({ state: z.literal("unavailable") }),
    z.object({ state: z.literal("signed-out") }),
    z.object({
      state: z.literal("signed-in"),
      githubLogin: z.string().nullable(),
      name: z.string(),
    }),
  ]),
  status: statusViewSchema,
  usage: usageSchema.nullable(),
  usageError: z.string().nullable(),
});
export type BbAiOverview = z.infer<typeof overviewSchema>;

export const bbAiRpcContract = defineRpcContract({
  overview: { input: z.null(), output: overviewSchema },
  setEnabled: {
    experimental_description:
      "Turn bb cloud on or off. While off, bb cloud reports not ready and sends nothing to getbb.app.",
    input: z.object({ enabled: z.boolean() }).strict(),
    output: overviewSchema,
  },
});

const OFF_STATUS: PluginAiServiceStatus = {
  ready: false,
  message: BB_CLOUD_OFF_MESSAGE,
};

interface Exhaustion {
  accountKey: string;
  until: number;
}

interface GatewayFailure {
  message: string;
  resetsAt: number | null;
}

function accountKey(account: Account): string {
  return JSON.stringify([account.baseUrl, account.userId]);
}

function gatewayFailure(response: AccountFetchOutput): GatewayFailure {
  if (response.status === 401) {
    return { message: SIGN_IN_MESSAGE, resetsAt: null };
  }
  const parsed = gatewayErrorSchema.safeParse(response.body);
  if (!parsed.success) {
    return {
      message: `bb cloud answered HTTP ${response.status}`,
      resetsAt: null,
    };
  }
  const { code, message, resetsAt } = parsed.data.error;
  return {
    message,
    resetsAt: code === "budget_exhausted" ? (resetsAt ?? null) : null,
  };
}

function limitReachedMessage(until: number): string {
  return `Daily limit reached; resets ${formatResetTime(until)} UTC`;
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const stored = z
    .boolean()
    .safeParse(await bb.storage.kv.get<unknown>(ENABLED_KEY));
  let enabled = stored.success && stored.data;
  let exhaustion: Exhaustion | null = null;

  async function accountStatus(): Promise<AccountStatus | null> {
    try {
      return await bb.sdk.plugins.callRpc({
        pluginId: ACCOUNT_PLUGIN_ID,
        method: accountStatusMethod,
        input: {},
        outputSchema: accountStatusSchema,
      });
    } catch {
      return null;
    }
  }

  async function currentAccountKey(): Promise<string | null> {
    const current = await accountStatus();
    return current?.signedIn === true ? accountKey(current.account) : null;
  }

  function accountFetch(
    input: AccountFetchInput,
    signal?: AbortSignal,
  ): Promise<AccountFetchOutput> {
    return bb.sdk.plugins.callRpc({
      pluginId: ACCOUNT_PLUGIN_ID,
      method: accountFetchMethod,
      input,
      outputSchema: accountFetchOutputSchema,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  function exhaustedUntil(key: string): number | null {
    if (exhaustion === null || exhaustion.accountKey !== key) return null;
    return exhaustion.until > Date.now() ? exhaustion.until : null;
  }

  function statusFor(account: AccountStatus | null): PluginAiServiceStatus {
    if (account === null)
      return { ready: false, message: ACCOUNT_DOWN_MESSAGE };
    if (!account.signedIn) return { ready: false, message: SIGN_IN_MESSAGE };
    const until = exhaustedUntil(accountKey(account.account));
    if (until !== null) {
      return { ready: false, message: limitReachedMessage(until) };
    }
    return { ready: true };
  }

  async function status(): Promise<PluginAiServiceStatus> {
    if (!enabled) return OFF_STATUS;
    return statusFor(await accountStatus());
  }

  async function complete(
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!enabled) throw new Error(BB_CLOUD_OFF_MESSAGE);
    const account = await accountStatus();
    if (account === null) throw new Error(ACCOUNT_DOWN_MESSAGE);
    if (!account.signedIn) throw new Error(SIGN_IN_MESSAGE);
    const key = accountKey(account.account);
    const until = exhaustedUntil(key);
    if (until !== null) throw new Error(limitReachedMessage(until));
    const response = await accountFetch(
      {
        target: "api",
        method: "POST",
        path: COMPLETE_PATH,
        body: { prompt },
        timeoutMs: COMPLETE_TIMEOUT_MS,
      },
      signal,
    );
    if (response.status !== 200) {
      const failure = gatewayFailure(response);
      if (failure.resetsAt !== null && (await currentAccountKey()) === key) {
        exhaustion = { accountKey: key, until: failure.resetsAt };
      }
      throw new Error(failure.message);
    }
    const parsed = completeResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new Error("bb cloud returned an invalid reply");
    }
    return parsed.data.text;
  }

  async function usage(): Promise<BbAiUsage> {
    const response = await accountFetch({
      target: "api",
      method: "GET",
      path: USAGE_PATH,
      body: null,
    });
    if (response.status !== 200) {
      throw new Error(gatewayFailure(response).message);
    }
    const parsed = usageSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new Error("bb cloud returned an invalid usage report");
    }
    return parsed.data;
  }

  async function overview(): Promise<BbAiOverview> {
    const account = await accountStatus();
    let usageView: BbAiUsage | null = null;
    let usageError: string | null = null;
    if (enabled && account?.signedIn === true) {
      try {
        usageView = await usage();
      } catch (error) {
        usageError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      enabled,
      account:
        account === null
          ? { state: "unavailable" }
          : account.signedIn
            ? {
                state: "signed-in",
                githubLogin: account.account.githubLogin,
                name: account.account.name,
              }
            : { state: "signed-out" },
      status: enabled ? statusFor(account) : OFF_STATUS,
      usage: usageView,
      usageError,
    };
  }

  async function setEnabled(next: boolean): Promise<BbAiOverview> {
    await bb.storage.kv.set(ENABLED_KEY, next);
    enabled = next;
    return overview();
  }

  bb.experimental_aiServices.register({
    id: BB_AI_SERVICE_ID,
    displayName: "bb cloud",
    complete: (prompt, { signal }) => complete(prompt, signal),
    status,
  });

  bb.rpc.register(bbAiRpcContract, {
    overview,
    setEnabled: ({ enabled: next }, context) => {
      if (context.experimental_caller.kind !== "client") {
        throw new Error(
          "only you can turn bb cloud on or off, from Settings or `bb ai on|off`",
        );
      }
      return setEnabled(next);
    },
  });

  bb.cli.register(
    defineCli({
      name: "ai",
      summary: "Turn on or check bb cloud AI for titles and commit messages",
      description: `bb cloud writes thread titles and commit messages for signed-in bb accounts. It is off until you run \`bb ai on\` or turn it on in Settings → bb cloud AI. Choose which tasks use it with \`bb settings ai-services set\`.\n\n${BB_CLOUD_DISCLOSURE}`,
      commands: {
        status: cliCommand({
          summary: "Show whether bb cloud is on and ready, and today's usage",
          options: { json: JSON_OPTION },
          async run(input) {
            const view = await overview();
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify(view) };
            }
            const account =
              view.account.state === "signed-in"
                ? `Signed in as ${view.account.githubLogin ?? view.account.name}`
                : view.account.state === "signed-out"
                  ? "Signed out. Run `bb account login`."
                  : "The bb account plugin is not running.";
            const ready = view.status.ready
              ? "Ready"
              : `Not ready: ${view.status.message}`;
            const usageLine =
              view.usage !== null
                ? `Usage: ${formatUsage(view.usage)}`
                : view.usageError !== null
                  ? `Usage unavailable: ${view.usageError}`
                  : null;
            return {
              exitCode: 0,
              stdout: [account, ready, usageLine]
                .filter((line) => line !== null)
                .join("\n"),
            };
          },
        }),
        on: cliCommand({
          summary: "Turn bb cloud on for thread titles and commit messages",
          description: BB_CLOUD_DISCLOSURE,
          options: { json: JSON_OPTION },
          async run(input) {
            const view = await setEnabled(true);
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify(view) };
            }
            return {
              exitCode: 0,
              stdout: view.status.ready
                ? "bb cloud is on and ready for thread titles and commit messages."
                : `bb cloud is on but not ready: ${view.status.message}`,
            };
          },
        }),
        off: cliCommand({
          summary: "Turn bb cloud off; bb sends nothing to getbb.app",
          options: { json: JSON_OPTION },
          async run(input) {
            const view = await setEnabled(false);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(view)
                : "bb cloud is off. bb no longer sends prompts or diffs to getbb.app. Run `bb ai on` to turn it back on.",
            };
          },
        }),
        usage: cliCommand({
          summary: "Show today's bb cloud spend against the daily limit",
          options: { json: JSON_OPTION },
          async run(input) {
            const account = await accountStatus();
            if (account?.signedIn !== true) {
              throw new PluginCliError("Not signed in to a bb account", {
                code: "signed_out",
                hint: "Run `bb account login`.",
              });
            }
            const current = await usage();
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(current)
                : formatUsage(current),
            };
          },
        }),
      },
    }),
  );
}
