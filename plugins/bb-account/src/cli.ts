import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { AccountError, type AccountService } from "./account.js";
import type { AccountStatus, LoginView } from "./contract.js";
import { HostedRequestError, RedeemError } from "./hosted.js";
import type { LinkLogins } from "./login.js";
import { resolveBaseUrl } from "./rpc.js";

const DESCRIPTION = [
  "Sign this bb in to your getbb.app account. bb account holds the server",
  "credential that remote access (bb connect) and hosted services use.",
  "",
  "  bb account login          Print a getbb.app link and code to approve",
  "  bb account login --wait   Wait here until that sign-in finishes",
  "  bb account login --code <code>",
  "                            Pair with a one-time code from the dashboard",
].join("\n");

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const REDEEM_ERROR_TEXT: Record<RedeemError["code"], string> = {
  invalid_code:
    "that code is invalid or has expired — get a new one from the getbb.app dashboard",
  expired_code:
    "that code has expired — get a new one from the getbb.app dashboard",
  already_used:
    "that code was already used — get a new one from the getbb.app dashboard",
  network: "couldn't reach getbb.app — check the connection and try again",
};

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatAccount(status: AccountStatus): string {
  if (status.account === null) {
    return "Not signed in. Run `bb account login` to sign in.";
  }
  const account = status.account;
  const login =
    account.githubLogin === null ? "" : ` (@${account.githubLogin})`;
  return [
    `Signed in as ${account.name}${login}`,
    `  Handle:  ${account.handle ?? "none yet"}`,
    `  Server:  ${account.serverLabel}  ${account.serverUrl}`,
  ].join("\n");
}

function formatPendingLogin(view: LoginView): string {
  const minutes = Math.max(
    0,
    Math.round((view.expiresAt - Date.now()) / 60_000),
  );
  return [
    "To sign in this bb, open:",
    `  ${view.verificationUrl}`,
    `and confirm the code ${view.userCode}. It expires in about ${minutes} min.`,
    "",
    "bb finishes signing in on its own once you approve. To wait here for the",
    "result, run:",
    "  bb account login --wait",
  ].join("\n");
}

function loginFailure(view: LoginView): PluginCliError {
  const reason = view.message ?? `sign-in ${view.state}`;
  return new PluginCliError(
    `${reason} Run \`bb account login\` to start again.`,
    { code: `login_${view.state.replace("-", "_")}` },
  );
}

function accountFailure(error: unknown): PluginCliError {
  if (error instanceof PluginCliError) return error;
  if (error instanceof RedeemError) {
    return new PluginCliError(REDEEM_ERROR_TEXT[error.code], {
      code: error.code,
    });
  }
  if (error instanceof AccountError) {
    return new PluginCliError(error.message, { code: error.code });
  }
  if (error instanceof HostedRequestError) {
    return new PluginCliError(error.message, { code: "network" });
  }
  return new PluginCliError(
    error instanceof Error ? error.message : String(error),
    { code: "account_failed" },
  );
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    throw accountFailure(error);
  }
}

export function registerAccountCli(args: {
  bb: Pick<BbPluginApi, "cli">;
  account: AccountService;
  logins: LinkLogins;
  defaultBaseUrl: string;
}): void {
  const { bb, account, logins, defaultBaseUrl } = args;
  bb.cli.register(
    defineCli({
      name: "account",
      summary: "Sign this bb in to your getbb.app account",
      description: DESCRIPTION,
      root: cliCommand({
        summary: "Show how to sign in",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        status: cliCommand({
          summary: "Show which getbb.app account this bb is signed in to",
          options: { json: JSON_OPTION },
          run: (input) => {
            const status = account.status();
            const login = logins.view(null);
            if (input.options.json) {
              return { exitCode: 0, stdout: asJson({ ...status, login }) };
            }
            const lines = [formatAccount(status)];
            if (login !== null && login.state === "pending") {
              lines.push(
                "",
                `Sign-in waiting for approval: open ${login.verificationUrl} and confirm ${login.userCode}.`,
              );
            }
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
        login: cliCommand({
          summary: "Sign in with a getbb.app link, or pair with a code",
          description:
            "Without --code, prints a getbb.app link and a code to approve in any browser, then returns; bb keeps checking and signs in once you approve. --wait waits for that sign-in to finish. Signing in replaces the account this bb is signed in to.",
          options: {
            code: {
              type: "string",
              placeholder: "code",
              description: "One-time pairing code from the getbb.app dashboard",
            },
            wait: {
              type: "boolean",
              description:
                "Wait until the sign-in started by `bb account login` is approved, denied, or expires",
            },
            "base-url": {
              type: "string",
              placeholder: "url",
              description: "getbb.app base URL; only for local testing",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["code", "wait"] },
            { kind: "at-most-one", options: ["wait", "base-url"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const baseUrl = resolveBaseUrl(
                input.options["base-url"] ?? null,
                defaultBaseUrl,
              );
              if (input.options.code !== undefined) {
                const status = await account.redeemCode(
                  input.options.code.trim(),
                  baseUrl,
                );
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? asJson(status)
                    : `${formatAccount(status)}\n`,
                };
              }
              if (input.options.wait) {
                const view = await logins.wait(ctx.signal);
                if (view === null) {
                  throw new PluginCliError(
                    "no sign-in is in progress — run `bb account login` first",
                    { code: "no_login" },
                  );
                }
                if (view.state === "pending") {
                  throw new PluginCliError(
                    "stopped waiting; the sign-in is still open",
                    { code: "login_pending" },
                  );
                }
                if (view.state !== "signed-in") throw loginFailure(view);
                const status = account.status();
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? asJson({ ...status, login: view })
                    : `${formatAccount(status)}\n`,
                };
              }
              const view = await logins.start(baseUrl);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson({ login: view, status: account.status() })
                  : `${formatPendingLogin(view)}\n`,
              };
            }),
        }),
        logout: cliCommand({
          summary: "Sign out and forget this bb's getbb.app pairing",
          description:
            "Revokes the server credential on getbb.app. Remote access and hosted services stop until you sign in again.",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const wasSignedIn = account.hasCredential();
              const status = await account.signOut();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : wasSignedIn
                    ? "Signed out. Remote access and hosted services stop until you sign in again.\n"
                    : "Not signed in.\n",
              };
            }),
        }),
      },
    }),
  );
}
