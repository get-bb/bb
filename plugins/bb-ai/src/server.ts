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
  type AccountFetchInput,
  type AccountFetchOutput,
  type AccountStatus,
} from "./account-contract.js";
import { formatResetTime, formatUsage } from "./format.js";

export const BB_AI_SERVICE_ID = "bb";
const COMPLETE_PATH = "/api/ai/v1/complete";
const USAGE_PATH = "/api/ai/v1/usage";

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
});

export default function plugin(bb: BbPluginApi): void {
  let exhaustedUntil = 0;

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

  function gatewayError(response: AccountFetchOutput): Error {
    if (response.status === 401) {
      return new Error("Sign in to your bb account");
    }
    const parsed = gatewayErrorSchema.safeParse(response.body);
    if (!parsed.success) {
      return new Error(`bb cloud answered HTTP ${response.status}`);
    }
    const { code, message, resetsAt } = parsed.data.error;
    if (code === "budget_exhausted" && resetsAt !== undefined) {
      exhaustedUntil = resetsAt;
    }
    return new Error(message);
  }

  async function status(): Promise<PluginAiServiceStatus> {
    if (exhaustedUntil > Date.now()) {
      return {
        ready: false,
        message: `Daily limit reached; resets ${formatResetTime(exhaustedUntil)} UTC`,
      };
    }
    const account = await accountStatus();
    if (account === null) {
      return { ready: false, message: "The bb account plugin is not running" };
    }
    if (account.state !== "signed-in") {
      return { ready: false, message: "Sign in to your bb account" };
    }
    return { ready: true };
  }

  async function usage(): Promise<BbAiUsage> {
    const response = await accountFetch({
      target: "api",
      method: "GET",
      path: USAGE_PATH,
      body: null,
    });
    if (response.status !== 200) throw gatewayError(response);
    const parsed = usageSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new Error("bb cloud returned an invalid usage report");
    }
    return parsed.data;
  }

  async function overview(): Promise<BbAiOverview> {
    const account = await accountStatus();
    const current = await status();
    const signedIn = account?.state === "signed-in" && account.account !== null;
    let usageView: BbAiUsage | null = null;
    let usageError: string | null = null;
    if (signedIn) {
      try {
        usageView = await usage();
      } catch (error) {
        usageError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      account:
        account === null
          ? { state: "unavailable" }
          : signedIn && account.account !== null
            ? {
                state: "signed-in",
                githubLogin: account.account.githubLogin,
                name: account.account.name,
              }
            : { state: "signed-out" },
      status: current,
      usage: usageView,
      usageError,
    };
  }

  bb.experimental_aiServices.register({
    id: BB_AI_SERVICE_ID,
    displayName: "bb cloud",
    async complete(prompt, { signal }) {
      const response = await accountFetch(
        {
          target: "api",
          method: "POST",
          path: COMPLETE_PATH,
          body: { prompt },
        },
        signal,
      );
      if (response.status !== 200) throw gatewayError(response);
      const parsed = completeResponseSchema.safeParse(response.body);
      if (!parsed.success) {
        throw new Error("bb cloud returned an invalid reply");
      }
      exhaustedUntil = 0;
      return parsed.data.text;
    },
    status,
  });

  bb.rpc.register(bbAiRpcContract, { overview });

  bb.cli.register(
    defineCli({
      name: "ai",
      summary: "Check bb cloud AI for titles and commit messages",
      description:
        "bb cloud writes thread titles and commit messages for signed-in bb accounts. Choose which tasks use it with `bb settings ai-services set`.",
      commands: {
        status: cliCommand({
          summary: "Show whether bb cloud is ready and today's usage",
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
        usage: cliCommand({
          summary: "Show today's bb cloud spend against the daily limit",
          options: { json: JSON_OPTION },
          async run(input) {
            const account = await accountStatus();
            if (account?.state !== "signed-in") {
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
