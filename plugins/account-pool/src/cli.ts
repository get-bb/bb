import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import {
  accountAddInputSchema,
  accountIdInputSchema,
  bypassInputSchema,
  loginCompleteInputSchema,
  tokenRotateInputSchema,
  type AccountSummary,
  type PoolStatus,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";
import type { ClaudeOAuthLogin } from "./oauth-login.js";

interface ParsedFlags {
  booleans: Set<string>;
  values: Map<string, string>;
}

const HELP = [
  "Usage:",
  "  bb pool account add --provider claude --import [--label <text>] [--priority <n>]",
  "  bb pool account add --provider claude --login",
  "  printf '%s\\n' \"$CLAUDE_AUTH_CODE\" | bb pool account login-complete --session <id> --code-stdin",
  "  bb pool account add --provider claude --api-key-stdin [--label <text>] [--priority <n>]",
  "  bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]  Unsafe: exposes the key in process arguments.",
  "  bb pool account list [--json]",
  "  bb pool account remove <id>",
  "  bb pool account enable <id>",
  "  bb pool account disable <id>",
  "  bb pool status [--json]",
  "  bb pool token rotate --machine <id-or-name>",
  "  bb pool bypass <thread-id> [--off]",
].join("\n");

function parseFlags(
  argv: readonly string[],
  allowedBooleans: readonly string[],
  allowedValues: readonly string[],
): ParsedFlags {
  const booleans = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) {
      throw new Error(`Unexpected argument ${JSON.stringify(arg)}.`);
    }
    const name = arg.slice(2);
    if (booleans.has(name) || values.has(name)) {
      throw new Error(`Duplicate flag --${name}.`);
    }
    if (allowedBooleans.includes(name)) {
      booleans.add(name);
      continue;
    }
    if (!allowedValues.includes(name))
      throw new Error(`Unknown flag --${name}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} requires a value.`);
    }
    values.set(name, value);
    index += 1;
  }
  return { booleans, values };
}

function formatReset(value: number | null): string {
  return value === null ? "-" : new Date(value).toISOString();
}

function formatUtilization(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function formatAccounts(accounts: readonly AccountSummary[]): string {
  if (accounts.length === 0) return "No accounts configured.";
  return [
    "ID\tLabel\tKind\tEnabled\tPriority\t5h\t5h reset\t7d\t7d reset\tStatus",
    ...accounts.map((account) =>
      [
        account.id,
        account.label,
        account.kind,
        String(account.enabled),
        String(account.priority),
        formatUtilization(account.fiveHourUtilization),
        formatReset(account.fiveHourResetAt),
        formatUtilization(account.sevenDayUtilization),
        formatReset(account.sevenDayResetAt),
        account.status,
      ].join("\t"),
    ),
  ].join("\n");
}

function formatStatus(status: PoolStatus): string {
  return [
    `Route: ${status.route}`,
    `Accepting: ${status.accepting}`,
    `Enabled accounts: ${status.enabledAccountCount}`,
    `In flight: ${status.inFlight}`,
    "",
    "Machine tokens:",
    ...(status.hosts.length === 0
      ? ["None minted."]
      : status.hosts.map(
          (host) =>
            `${host.hostName ?? host.hostId}\t${new Date(host.mintedAt).toISOString()}\t${host.lastUsedAt === null ? "never" : new Date(host.lastUsedAt).toISOString()}`,
        )),
    "",
    "Recently routed threads without a local Claude login:",
    ...(status.routedThreadsWithoutLocalLogin.length === 0
      ? ["None."]
      : status.routedThreadsWithoutLocalLogin.map(
          (thread) =>
            `${thread.threadId}\t${thread.hostName ?? thread.hostId}\t${thread.localClaudeStatus}`,
        )),
    "",
    formatAccounts(status.accounts),
  ].join("\n");
}

function json(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function registerPoolCli(
  bb: Pick<BbPluginApi, "cli">,
  operations: PoolOperations,
  login: ClaudeOAuthLogin,
): void {
  bb.cli.register({
    name: "pool",
    summary: "Manage Claude accounts and inspect the Account Pool hub",
    commands: [
      {
        name: "account-add",
        summary:
          "Sign in to Claude, import Claude Code credentials, or add an Anthropic API key",
        usage:
          "bb pool account add --provider claude --login\nbb pool account add --provider claude (--import | --api-key-stdin) [--label <text>] [--priority <n>]\nUnsafe compatibility form: bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]",
      },
      {
        name: "account-login-complete",
        summary: "Complete a Claude browser login with its manual code",
        usage:
          "printf '%s\\n' \"$CLAUDE_AUTH_CODE\" | bb pool account login-complete --session <id> --code-stdin",
      },
      {
        name: "account-list",
        summary: "List pool accounts and observed quota",
        usage: "bb pool account list [--json]",
      },
      {
        name: "account-remove",
        summary: "Remove an account and its secret token file",
        usage: "bb pool account remove <id>",
      },
      {
        name: "account-enable",
        summary: "Enable an account",
        usage: "bb pool account enable <id>",
      },
      {
        name: "account-disable",
        summary: "Disable an account",
        usage: "bb pool account disable <id>",
      },
      {
        name: "status",
        summary: "Show hub, machine token, routing, and account status",
        usage: "bb pool status [--json]",
      },
      {
        name: "token-rotate",
        summary: "Rotate one machine's Account Pool bearer token",
        usage: "bb pool token rotate --machine <id-or-name>",
      },
      {
        name: "bypass",
        summary: "Bypass Account Pool routing for one thread",
        usage: "bb pool bypass <thread-id> [--off]",
      },
    ],
    async run(argv): Promise<PluginCliResult> {
      try {
        if (argv.includes("--help") || argv.includes("-h")) {
          return { exitCode: 0, stdout: `${HELP}\n` };
        }
        if (argv[0] === "account" && argv[1] === "add") {
          const flags = parseFlags(
            argv.slice(2),
            ["import", "api-key-stdin", "login"],
            ["provider", "api-key", "label", "priority"],
          );
          const imported = flags.booleans.has("import");
          const apiKeyStdin = flags.booleans.has("api-key-stdin");
          const loginRequested = flags.booleans.has("login");
          const apiKey = flags.values.get("api-key");
          const sourceCount =
            Number(imported) +
            Number(apiKeyStdin) +
            Number(loginRequested) +
            Number(apiKey !== undefined);
          if (sourceCount !== 1)
            throw new Error(
              "Choose exactly one of --login, --import, --api-key-stdin, or --api-key <key>.",
            );
          if (loginRequested) {
            if (flags.values.get("provider") !== "claude") {
              throw new Error("--login requires --provider claude.");
            }
            if (flags.values.has("label") || flags.values.has("priority")) {
              throw new Error("--login does not accept --label or --priority.");
            }
            const started = login.start();
            return {
              exitCode: 0,
              stdout: `${[
                "Open this URL to sign in to Claude:",
                started.authorizeUrl,
                "",
                `Session ID: ${started.sessionId}`,
                "",
                "After signing in, pipe the code shown on the final page into:",
                `printf '%s\\n' \"$CLAUDE_AUTH_CODE\" | bb pool account login-complete --session ${started.sessionId} --code-stdin`,
              ].join("\n")}\n`,
            };
          }
          if (apiKeyStdin) {
            throw new Error(
              "--api-key-stdin must be invoked through the bb CLI so it can read stdin safely.",
            );
          }
          const priorityText = flags.values.get("priority") ?? "100";
          const input = accountAddInputSchema.parse({
            provider: flags.values.get("provider"),
            source: imported ? { kind: "import" } : { kind: "api-key", apiKey },
            label: flags.values.get("label") ?? null,
            priority: Number(priorityText),
          });
          const account = await operations.add(input);
          return {
            exitCode: 0,
            stdout: `Added ${account.label} (${account.id}).\n`,
          };
        }
        if (argv[0] === "account" && argv[1] === "login-complete") {
          const flags = parseFlags(
            argv.slice(2),
            ["code-stdin"],
            ["session", "code"],
          );
          if (flags.booleans.has("code-stdin")) {
            throw new Error(
              "--code-stdin requires the current bb CLI so it can read stdin safely.",
            );
          }
          const input = loginCompleteInputSchema.parse({
            sessionId: flags.values.get("session"),
            pasted: flags.values.get("code"),
          });
          const account = await login.complete(input);
          return {
            exitCode: 0,
            stdout: `Added ${account.label} (${account.id}).\n`,
          };
        }
        if (argv[0] === "account" && argv[1] === "list") {
          const flags = parseFlags(argv.slice(2), ["json"], []);
          const accounts = await operations.list();
          return {
            exitCode: 0,
            stdout: flags.booleans.has("json")
              ? json({ accounts })
              : `${formatAccounts(accounts)}\n`,
          };
        }
        if (
          argv[0] === "account" &&
          ["remove", "enable", "disable"].includes(argv[1] ?? "")
        ) {
          if (argv.length !== 3) throw new Error(HELP);
          const { id } = accountIdInputSchema.parse({ id: argv[2] });
          if (argv[1] === "remove") {
            const removed = await operations.remove(id);
            if (!removed) throw new Error(`Account ${id} does not exist.`);
            return { exitCode: 0, stdout: `Removed ${id}.\n` };
          }
          const account =
            argv[1] === "enable"
              ? await operations.enable(id)
              : await operations.disable(id);
          if (account === null)
            throw new Error(`Account ${id} does not exist.`);
          return {
            exitCode: 0,
            stdout: `${argv[1] === "enable" ? "Enabled" : "Disabled"} ${id}.\n`,
          };
        }
        if (argv[0] === "status") {
          const flags = parseFlags(argv.slice(1), ["json"], []);
          const status = await operations.status();
          return {
            exitCode: 0,
            stdout: flags.booleans.has("json")
              ? json(status)
              : `${formatStatus(status)}\n`,
          };
        }
        if (argv[0] === "token" && argv[1] === "rotate") {
          const flags = parseFlags(argv.slice(2), [], ["machine"]);
          const { machine } = tokenRotateInputSchema.parse({
            machine: flags.values.get("machine"),
          });
          const token = await operations.rotateToken(machine);
          return {
            exitCode: 0,
            stdout: `Rotated the Account Pool token for ${token.hostName ?? token.hostId}.\n`,
          };
        }
        if (argv[0] === "bypass") {
          const threadId = argv[1];
          if (threadId === undefined) throw new Error(HELP);
          const flags = parseFlags(argv.slice(2), ["off"], []);
          const input = bypassInputSchema.parse({
            threadId,
            bypassed: !flags.booleans.has("off"),
          });
          const result = await operations.setBypass(
            input.threadId,
            input.bypassed,
          );
          return {
            exitCode: 0,
            stdout: `${result.bypassed ? "Enabled" : "Disabled"} Account Pool bypass for ${result.threadId}.\n`,
          };
        }
        throw new Error(HELP);
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
