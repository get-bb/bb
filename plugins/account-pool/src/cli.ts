import {
  experimental_CliError,
  experimental_cliCommand,
  experimental_defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { setTimeout as wait } from "node:timers/promises";
import {
  accountAddInputSchema,
  accountIdInputSchema,
  accountPriorityInputSchema,
  accountReorderInputSchema,
  accountPoolConfigSetInputSchema,
  bypassInputSchema,
  codexLoginPollInputSchema,
  loginCompleteInputSchema,
  modelFamilySchema,
  parentModeSchema,
  tokenRotateInputSchema,
  routingSetInputSchema,
  type AccountPoolConfig,
  type AccountPoolConfigController,
  type AccountPoolConfigSetInput,
  type AccountSummary,
  type FamilyQuota,
  type LimitWindow,
  type ModelFamily,
  type PoolStatus,
  type PoolStatusReport,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";
import type { ClaudeOAuthLogin } from "./oauth-login.js";
import type { CodexDeviceLogin } from "./codex-device-login.js";

const DESCRIPTION = [
  "Accounts run sequentially by priority, then order added. The current fallback stays active until unavailable.",
  "When this bb server runs inside another bb server's thread, parent proxy routes its pooled traffic through that parent; isolate neutralises the inherited routing.",
  "Reorder includes every account for the provider and changes the next failover sequence; existing conversations stay pinned.",
].join("\n");

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const PROVIDER_OPTION = {
  type: "enum",
  values: ["claude", "codex"],
  required: true,
  aliases: ["vendor"],
  description: "Provider this account belongs to",
} as const;

const SESSION_OPTION = {
  type: "string",
  required: true,
  placeholder: "id",
  aliases: ["session-id", "sessionId"],
  description: "Session ID printed by `bb pool account add --login`",
} as const;

const ACCOUNT_ID_POSITIONAL = {
  name: "id",
  description: "Account UUID from `bb pool account list`",
  required: true,
} as const;

function formatReset(value: number | null): string {
  return value === null ? "-" : new Date(value).toISOString();
}

function formatUtilization(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function familyLabel(family: ModelFamily): string {
  return family[0]?.toUpperCase() + family.slice(1);
}

function formatWindowLabel(window: LimitWindow): string {
  if (window.windowMinutes === null) return window.slot;
  if (window.windowMinutes % 1_440 === 0)
    return `${window.windowMinutes / 1_440}d`;
  if (window.windowMinutes % 60 === 0) return `${window.windowMinutes / 60}h`;
  return `${window.windowMinutes}m`;
}

function formatLimitWindows(windows: readonly LimitWindow[]): string {
  if (windows.length === 0) return "-";
  return windows
    .map(
      (window) =>
        `${formatWindowLabel(window)}=${formatUtilization(window.utilization)} ${formatReset(window.resetAt)}`,
    )
    .join("; ");
}

function formatFamilyQuota(quota: FamilyQuota | null): string {
  if (quota === null) return "-";
  return [
    formatUtilization(quota.utilization),
    quota.status ?? "-",
    formatReset(quota.resetAt),
    quota.source,
  ].join(" ");
}

function formatAccounts(accounts: readonly AccountSummary[]): string {
  if (accounts.length === 0) return "No accounts configured.";
  const families = modelFamilySchema.options.filter((family) =>
    accounts.some((account) => account.familyWeekly[family] !== null),
  );
  return [
    [
      "ID",
      "Label",
      "Email",
      "Provider",
      "Kind",
      "Enabled",
      "Priority",
      "5h",
      "5h reset",
      "7d",
      "7d reset",
      "Windows",
      ...families.map(familyLabel),
      "Status",
    ].join("\t"),
    ...accounts.map((account) =>
      [
        account.id,
        account.label,
        account.email ?? "-",
        account.provider,
        account.kind,
        String(account.enabled),
        String(account.priority),
        formatUtilization(account.fiveHourUtilization),
        formatReset(account.fiveHourResetAt),
        formatUtilization(account.sevenDayUtilization),
        formatReset(account.sevenDayResetAt),
        formatLimitWindows(account.limitWindows),
        ...families.map((family) =>
          formatFamilyQuota(account.familyWeekly[family]),
        ),
        account.status,
      ].join("\t"),
    ),
  ].join("\n");
}

function formatStatus(status: PoolStatusReport): string {
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

function formatConfig(config: AccountPoolConfig): string {
  return [
    `anthropicUpstreamBaseUrl: ${config.anthropicUpstreamBaseUrl}`,
    `codexUpstreamBaseUrl: ${config.codexUpstreamBaseUrl}`,
    `switchThreshold: ${config.switchThreshold}`,
    `parentMode: ${config.parentMode}`,
  ].join("\n");
}

function formatParent(parent: PoolStatus["parent"]): string {
  if (parent === null) {
    return "No parent bb server Account Pooler was detected for this instance.";
  }
  return [
    `parent: ${parent.baseUrl}`,
    `mode: ${parent.mode}`,
    `parentServes.claude: ${parent.availability.claude}`,
    `parentServes.codex: ${parent.availability.codex}`,
  ].join("\n");
}

function parseConfigUpdate(
  key: string,
  value: string,
): AccountPoolConfigSetInput {
  if (key === "anthropicUpstreamBaseUrl") {
    return accountPoolConfigSetInputSchema.parse({
      anthropicUpstreamBaseUrl: value,
    });
  }
  if (key === "codexUpstreamBaseUrl") {
    return accountPoolConfigSetInputSchema.parse({
      codexUpstreamBaseUrl: value,
    });
  }
  if (key === "switchThreshold") {
    return accountPoolConfigSetInputSchema.parse({
      switchThreshold: Number(value),
    });
  }
  if (key === "parentMode") {
    return accountPoolConfigSetInputSchema.parse({ parentMode: value });
  }
  throw new experimental_CliError(
    "Config key must be anthropicUpstreamBaseUrl, codexUpstreamBaseUrl, switchThreshold, or parentMode.",
    { code: "invalid_value" },
  );
}

function json(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof experimental_CliError) throw error;
    throw new experimental_CliError(
      error instanceof Error ? error.message : String(error),
      { code: "pool_command_failed" },
    );
  }
}

export function registerPoolCli(
  bb: Pick<BbPluginApi, "cli">,
  operations: PoolOperations,
  login: ClaudeOAuthLogin,
  codexLogin: CodexDeviceLogin,
  config: AccountPoolConfigController,
): void {
  bb.cli.register(
    experimental_defineCli({
      name: "pool",
      summary:
        "Manage Claude and Codex accounts and inspect the Account Pooler hub",
      description: DESCRIPTION,
      commands: {
        "account add": experimental_cliCommand({
          summary:
            "Sign in to Claude or Codex, import credentials, or add an Anthropic API key",
          description:
            "--login prints the browser or device step and exits; finish it with `bb pool account login-complete` (Claude) or `bb pool account login-poll` (Codex).\n--import reads the provider's existing login on this bb server host (~/.claude or ~/.codex).",
          unexpectedPositionalHint:
            "the provider belongs in --provider <claude|codex>, not a bare argument",
          options: {
            provider: PROVIDER_OPTION,
            login: {
              type: "boolean",
              aliases: ["signin", "sign-in"],
              description:
                "Start a browser (Claude) or device-code (Codex) login and print the next command",
            },
            import: {
              type: "boolean",
              aliases: ["import-local", "local"],
              description:
                "Import the provider's existing login from this bb server host",
            },
            "api-key": {
              type: "string",
              placeholder: "key",
              stdin: true,
              aliases: ["apikey", "key"],
              description:
                "Anthropic API key, --provider claude only. Unsafe: exposes the key in process arguments, shell history, and agent transcripts",
            },
            label: {
              type: "string",
              placeholder: "text",
              aliases: ["name"],
              description:
                "Label shown in listings; defaults to a provider-derived label",
            },
            priority: {
              type: "integer",
              min: -1_000_000,
              max: 1_000_000,
              default: 100,
              placeholder: "n",
              aliases: ["order"],
              description:
                "Failover position; lower numbers run first, ties keep the order added",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "exactly-one", options: ["login", "import", "api-key"] },
            { kind: "at-most-one", options: ["login", "label"] },
            { kind: "at-most-one", options: ["login", "priority"] },
          ],
          run: (input) =>
            attempt(async () => {
              const provider = input.options.provider;
              if (input.options.login) {
                if (provider === "codex") {
                  const started = await codexLogin.start();
                  return {
                    exitCode: 0,
                    stdout: input.options.json
                      ? json({ ok: true, login: started })
                      : `${[
                          "Open this URL to sign in to Codex:",
                          started.verificationUri,
                          "",
                          `Enter this code: ${started.userCode}`,
                          `Session ID: ${started.sessionId}`,
                          "",
                          "After authorizing, wait for the account to be added with:",
                          `bb pool account login-poll --session ${started.sessionId}`,
                        ].join("\n")}\n`,
                  };
                }
                const started = login.start();
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? json({ ok: true, login: started })
                    : `${[
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
              const imported = input.options.import;
              if (!imported && provider !== "claude") {
                throw new experimental_CliError(
                  "Anthropic API keys require --provider claude.",
                  { code: "invalid_value" },
                );
              }
              const parsed = accountAddInputSchema.parse({
                provider,
                source: imported
                  ? { kind: "import" }
                  : { kind: "api-key", apiKey: input.options["api-key"] },
                label: input.options.label ?? null,
                priority: input.options.priority,
              });
              const account = await operations.add(parsed);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Added ${account.label} (${account.id}).\n`,
              };
            }),
        }),
        "account login-poll": experimental_cliCommand({
          summary: "Wait for a Codex device-code login to complete",
          description:
            "Blocks until the Codex authorization finishes, fails, or the invocation is cancelled.",
          options: { session: SESSION_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const parsed = codexLoginPollInputSchema.parse({
                sessionId: input.options.session,
              });
              const signal = ctx.signal;
              const cancel = () => codexLogin.cancel(parsed);
              signal?.addEventListener("abort", cancel, { once: true });
              try {
                if (signal?.aborted) {
                  cancel();
                  throw (
                    signal.reason ?? new Error("Codex login was cancelled.")
                  );
                }
                while (true) {
                  await wait(
                    codexLogin.nextPollDelayMs(parsed.sessionId),
                    undefined,
                    { signal },
                  );
                  const result = await codexLogin.poll(parsed);
                  if (signal?.aborted) {
                    throw (
                      signal.reason ?? new Error("Codex login was cancelled.")
                    );
                  }
                  if (result.status === "complete") {
                    return {
                      exitCode: 0,
                      stdout: input.options.json
                        ? json({ ok: true, account: result.account })
                        : `Added ${result.account.label} (${result.account.id}).\n`,
                    };
                  }
                  if (result.status === "error") {
                    throw new experimental_CliError(result.message, {
                      code: "codex_login_failed",
                    });
                  }
                }
              } catch (error) {
                if (signal?.aborted) codexLogin.cancel(parsed);
                throw error;
              } finally {
                signal?.removeEventListener("abort", cancel);
              }
            }),
        }),
        "account login-complete": experimental_cliCommand({
          summary: "Complete a Claude browser login with its manual code",
          description:
            "Pipe the code the final login page shows:\n  printf '%s\\n' \"$CLAUDE_AUTH_CODE\" | bb pool account login-complete --session <id> --code-stdin",
          options: {
            session: SESSION_OPTION,
            code: {
              type: "string",
              required: true,
              placeholder: "code",
              stdin: true,
              aliases: ["pasted", "auth-code"],
              description:
                "Manual callback code from the final login page. Unsafe: exposes the code in process arguments",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attempt(async () => {
              const parsed = loginCompleteInputSchema.parse({
                sessionId: input.options.session,
                pasted: input.options.code,
              });
              const account = await login.complete(parsed);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Added ${account.label} (${account.id}).\n`,
              };
            }),
        }),
        "account list": experimental_cliCommand({
          summary: "List pool accounts and observed quota",
          aliases: ["account ls"],
          suggestFor: ["accounts", "list", "ls"],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const accounts = await operations.list();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ accounts })
                  : `${formatAccounts(accounts)}\n`,
              };
            }),
        }),
        "account remove": experimental_cliCommand({
          summary: "Remove an account and its secret token file",
          aliases: ["account rm", "account delete"],
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              if (!(await operations.remove(id))) {
                throw new experimental_CliError(
                  `Account ${id} does not exist.`,
                  { code: "account_not_found" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, removed: id })
                  : `Removed ${id}.\n`,
              };
            }),
        }),
        "account enable": experimental_cliCommand({
          summary: "Enable an account",
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = await operations.enable(id);
              if (account === null) {
                throw new experimental_CliError(
                  `Account ${id} does not exist.`,
                  { code: "account_not_found" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Enabled ${id}.\n`,
              };
            }),
        }),
        "account disable": experimental_cliCommand({
          summary: "Disable an account",
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = await operations.disable(id);
              if (account === null) {
                throw new experimental_CliError(
                  `Account ${id} does not exist.`,
                  { code: "account_not_found" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Disabled ${id}.\n`,
              };
            }),
        }),
        "account priority": experimental_cliCommand({
          summary: "Set an account's position in the failover priority order",
          positionals: [
            ACCOUNT_ID_POSITIONAL,
            {
              name: "priority",
              description: "Whole number; lower numbers run first",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const raw = input.positionals.priority;
              if (!/^-?\d+$/.test(raw.trim())) {
                throw new experimental_CliError(
                  `invalid value '${raw}' for <priority>. Expected a whole number`,
                  { code: "invalid_value" },
                );
              }
              const parsed = accountPriorityInputSchema.parse({
                accountId: input.positionals.id,
                priority: Number(raw),
              });
              const account = await operations.setPriority(
                parsed.accountId,
                parsed.priority,
              );
              if (account === null) {
                throw new experimental_CliError("Account not found.", {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Set ${account.label} priority to ${account.priority}.\n`,
              };
            }),
        }),
        "account reorder": experimental_cliCommand({
          summary: "Set the complete failover order for one provider",
          description:
            "List every account for the provider, including disabled ones, in the order they should be tried.",
          positionals: [
            {
              name: "provider",
              description: "claude or codex",
              required: true,
            },
            {
              name: "account-id",
              description: "Every account UUID for that provider, in order",
              required: true,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const parsed = accountReorderInputSchema.parse({
                provider: input.positionals.provider,
                accountIds: input.positionals["account-id"],
              });
              await operations.reorder(parsed.provider, parsed.accountIds);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({
                      ok: true,
                      provider: parsed.provider,
                      accountIds: parsed.accountIds,
                    })
                  : `Updated ${parsed.provider} account order.\n`,
              };
            }),
        }),
        "account refresh": experimental_cliCommand({
          summary: "Refresh one account's observed usage",
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = await operations.refreshUsage(id);
              if (account === null) {
                throw new experimental_CliError("Account not found.", {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Refreshed usage for ${id}.\n`,
              };
            }),
        }),
        status: experimental_cliCommand({
          summary: "Show hub, machine token, routing, and account status",
          suggestFor: ["info", "hub"],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const [poolStatus, routedThreadsWithoutLocalLogin] =
                await Promise.all([
                  operations.status(),
                  operations.routedThreadsWithoutLocalLogin(),
                ]);
              const status: PoolStatusReport = {
                ...poolStatus,
                routedThreadsWithoutLocalLogin,
              };
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json(status)
                  : `${formatStatus(status)}\n`,
              };
            }),
        }),
        routing: experimental_cliCommand({
          summary: "Enable or disable pooled routing for one provider",
          positionals: [
            {
              name: "provider",
              description: "claude or codex",
              required: true,
            },
          ],
          options: {
            off: {
              type: "boolean",
              aliases: ["disable"],
              description: "Disable pooled routing instead of enabling it",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attempt(async () => {
              const parsed = routingSetInputSchema.parse({
                provider: input.positionals.provider,
                enabled: !input.options.off,
              });
              await operations.setRouting(parsed.provider, parsed.enabled);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({
                      ok: true,
                      provider: parsed.provider,
                      enabled: parsed.enabled,
                    })
                  : `${parsed.enabled ? "Enabled" : "Disabled"} ${parsed.provider} Account Pooler routing.\n`,
              };
            }),
        }),
        config: experimental_cliCommand({
          summary: "Show Account Pooler routing configuration",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const current = config.get();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, config: current })
                  : `${formatConfig(current)}\n`,
              };
            }),
        }),
        "config set": experimental_cliCommand({
          summary: "Update one Account Pooler routing configuration value",
          positionals: [
            {
              name: "key",
              description:
                "anthropicUpstreamBaseUrl, codexUpstreamBaseUrl, switchThreshold, or parentMode",
              required: true,
            },
            {
              name: "value",
              description:
                "HTTP(S) URL for the upstream keys, a number above 0 and at most 1 for switchThreshold, proxy or isolate for parentMode",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const next = await config.set(
                parseConfigUpdate(
                  input.positionals.key,
                  input.positionals.value,
                ),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, config: next })
                  : `${formatConfig(next)}\n`,
              };
            }),
        }),
        parent: experimental_cliCommand({
          summary:
            "Show or set how this instance uses a parent bb server's Account Pooler",
          positionals: [
            {
              name: "mode",
              description:
                "proxy routes pooled traffic through the parent; isolate neutralises the inherited routing. Omit to report the detected parent",
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const mode = input.positionals.mode;
              if (mode === undefined) {
                const status = await operations.status();
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? json({ ok: true, parent: status.parent })
                    : `${formatParent(status.parent)}\n`,
                };
              }
              const parentMode = parentModeSchema.parse(mode);
              const next = await config.set({ parentMode });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, parentMode: next.parentMode })
                  : `Set the Account Pooler parent mode to ${next.parentMode}.\n`,
              };
            }),
        }),
        "token rotate": experimental_cliCommand({
          summary: "Rotate one machine's Account Pooler bearer token",
          description:
            "The previous token keeps working for ten minutes. Tokens are never printed.",
          suggestFor: ["rotate", "token"],
          options: {
            machine: {
              type: "string",
              required: true,
              placeholder: "id-or-name",
              aliases: ["host", "host-id", "machine-id"],
              description:
                "Enrolled machine name or host ID from `bb pool status`",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attempt(async () => {
              const { machine } = tokenRotateInputSchema.parse({
                machine: input.options.machine,
              });
              const token = await operations.rotateToken(machine);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, token })
                  : `Rotated the Account Pooler token for ${token.hostName ?? token.hostId}.\n`,
              };
            }),
        }),
        bypass: experimental_cliCommand({
          summary: "Bypass Account Pooler routing for one thread",
          positionals: [
            {
              name: "thread-id",
              description:
                "Thread that should use its own provider credentials",
            },
          ],
          options: {
            off: {
              type: "boolean",
              aliases: ["disable"],
              description: "Restore pooled routing for the thread",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const threadId = input.positionals["thread-id"];
              if (threadId === undefined) {
                throw new experimental_CliError(
                  "missing required arguments: <thread-id>",
                  {
                    code: "missing_required",
                    ...(ctx.threadId === undefined
                      ? {}
                      : {
                          hint: `This thread is ${ctx.threadId}; re-run with bb pool bypass ${ctx.threadId}`,
                        }),
                  },
                );
              }
              const parsed = bypassInputSchema.parse({
                threadId,
                bypassed: !input.options.off,
              });
              const result = await operations.setBypass(
                parsed.threadId,
                parsed.bypassed,
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({
                      ok: true,
                      threadId: result.threadId,
                      bypassed: result.bypassed,
                    })
                  : `${result.bypassed ? "Enabled" : "Disabled"} Account Pooler bypass for ${result.threadId}.\n`,
              };
            }),
        }),
      },
    }),
  );
}
