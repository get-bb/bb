import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import {
  accountAddInputSchema,
  accountIdInputSchema,
  type AccountSummary,
  type PoolStatus,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";

interface ParsedFlags {
  booleans: Set<string>;
  values: Map<string, string>;
}

const HELP = [
  "Usage:",
  "  bb pool account add --provider claude --import [--label <text>] [--priority <n>]",
  "  bb pool account add --provider claude --api-key-stdin [--label <text>] [--priority <n>]",
  "  bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]  Unsafe: exposes the key in process arguments.",
  "  bb pool account list [--json]",
  "  bb pool account remove <id>",
  "  bb pool account enable <id>",
  "  bb pool account disable <id>",
  "  bb pool status [--json] [--show-key]",
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

function formatStatus(status: PoolStatus, showKey: boolean): string {
  return [
    `Route: ${status.route}`,
    `Accepting: ${status.accepting}`,
    `Enabled accounts: ${status.enabledAccountCount}`,
    `In flight: ${status.inFlight}`,
    ...(showKey && status.hubKey !== null ? [`Hub key: ${status.hubKey}`] : []),
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
): void {
  bb.cli.register({
    name: "pool",
    summary: "Manage Claude accounts and inspect the Account Pool hub",
    commands: [
      {
        name: "account-add",
        summary:
          "Import Claude Code OAuth credentials or add an Anthropic API key",
        usage:
          "bb pool account add --provider claude (--import | --api-key-stdin) [--label <text>] [--priority <n>]\nUnsafe compatibility form: bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]",
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
        summary:
          "Show hub status; reveal the bearer token only with --show-key",
        usage: "bb pool status [--json] [--show-key]",
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
            ["import", "api-key-stdin"],
            ["provider", "api-key", "label", "priority"],
          );
          const imported = flags.booleans.has("import");
          const apiKeyStdin = flags.booleans.has("api-key-stdin");
          const apiKey = flags.values.get("api-key");
          const sourceCount =
            Number(imported) +
            Number(apiKeyStdin) +
            Number(apiKey !== undefined);
          if (sourceCount !== 1)
            throw new Error(
              "Choose exactly one of --import, --api-key-stdin, or --api-key <key>.",
            );
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
          const flags = parseFlags(argv.slice(1), ["json", "show-key"], []);
          const showKey = flags.booleans.has("show-key");
          const status = await operations.status(showKey);
          return {
            exitCode: 0,
            stdout: flags.booleans.has("json")
              ? json(status)
              : `${formatStatus(status, showKey)}\n`,
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
