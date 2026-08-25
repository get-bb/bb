import type { Command } from "commander";
import type { Dispatcher } from "undici";
import type { ContextSnapshot } from "./context-env.js";
import { cliFetch } from "./client.js";

/**
 * The `experimental_invocation.before` plugin policy, asked once before every
 * executable `bb` action. The policy lives on the server, so the answer is
 * only as available as the server is:
 *
 * - a server that answers decides: `{ allowed: false, reason }` stops the
 *   command, and an answer the CLI cannot read stops it too (a server that
 *   knows the route never answers garbage, so garbage is a broken policy);
 * - a server that cannot be reached, or that predates the route (HTTP 404),
 *   has no policy to apply: the command proceeds as it did before policies
 *   existed. Every server-side action it goes on to attempt still hits that
 *   same server, and bb-defined agent tools are checked server-side
 *   regardless, so nothing a policy could have blocked slips through —
 *   only local commands (`bb guide`, help) keep working offline, which is
 *   the point. Failing closed here once bricked every `bb` command the
 *   moment the server was down or one release behind.
 */

export class CliInvocationPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliInvocationPreflightError";
  }
}

/** Top-level commands that execute no bb action: nothing to preflight. */
const LOCAL_COMMANDS: ReadonlySet<string> = new Set(["guide", "manager"]);

/**
 * The route streams its response head at once and the body when the policy
 * settles (a handler may wait on user input), so the head gets a short
 * budget and the body a long one — the plugin CLI proxy's.
 */
const PREFLIGHT_HEADERS_TIMEOUT_MS = 10_000;
const PREFLIGHT_BODY_TIMEOUT_MS = 65 * 60 * 1000;

export type CliInvocationPreflightOutcome =
  | { kind: "allowed" }
  /** No policy could be asked: the server is unreachable or predates the route. */
  | { kind: "skipped"; reason: "unreachable" | "unsupported" }
  | { kind: "blocked"; reason: string };

export interface CliInvocationPreflightArgs {
  baseUrl: string;
  argv: readonly string[];
  cwd: string;
  context: Pick<ContextSnapshot, "projectId" | "threadId">;
}

let preflightDispatcher: Promise<Dispatcher> | undefined;
function getPreflightDispatcher(): Promise<Dispatcher> {
  preflightDispatcher ??= import("undici").then(
    ({ Agent }) =>
      new Agent({
        headersTimeout: PREFLIGHT_HEADERS_TIMEOUT_MS,
        bodyTimeout: PREFLIGHT_BODY_TIMEOUT_MS,
      }),
  );
  return preflightDispatcher;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A server that accepted the connection but did not answer in time is not
 * "unreachable": it is up, and it will go on to run the command, so its
 * policy must not be skipped. Only a connection that never came up is.
 */
const NOT_ANSWERING_CODES: ReadonlySet<string> = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "EPIPE",
]);

function errorCode(error: unknown): string | null {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
  }
  return null;
}

function isServerNotAnswering(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== null) return NOT_ANSWERING_CODES.has(code);
  const name = error instanceof Error ? error.name : "";
  return name === "HeadersTimeoutError" || name === "BodyTimeoutError" || name === "AbortError";
}

function responseError(body: unknown, status: number): string {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const error = Reflect.get(body, "error");
    if (typeof error === "string" && error.length > 0) return error;
  }
  return `server returned HTTP ${status}`;
}

export async function preflightCliInvocation(
  args: CliInvocationPreflightArgs,
): Promise<CliInvocationPreflightOutcome> {
  let response: Response;
  try {
    response = await cliFetch(`${args.baseUrl}/api/v1/plugins/invocations/preflight`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        argv: args.argv,
        cwd: args.cwd,
        threadId: args.context.threadId ?? null,
        projectId: args.context.projectId ?? null,
      }),
      dispatcher: await getPreflightDispatcher(),
    });
  } catch (error) {
    if (isServerNotAnswering(error)) {
      return {
        kind: "blocked",
        reason: `BB invocation preflight failed: the server did not answer (${errorMessage(error)})`,
      };
    }
    return { kind: "skipped", reason: "unreachable" };
  }

  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: "skipped", reason: "unsupported" };
  }
  if (!response.ok) {
    // A relay or proxy error body is often not JSON; the status is the fact.
    const body: unknown = await response.json().catch(() => null);
    return {
      kind: "blocked",
      reason: `BB invocation preflight failed: ${responseError(body, response.status)}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      kind: "blocked",
      reason: `BB invocation preflight returned a malformed response: ${errorMessage(error)}`,
    };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "blocked", reason: "BB invocation preflight returned a malformed response" };
  }
  const allowed = Reflect.get(body, "allowed");
  if (allowed === true) return { kind: "allowed" };
  const reason = Reflect.get(body, "reason");
  if (allowed === false && typeof reason === "string" && reason.length > 0) {
    return { kind: "blocked", reason };
  }
  return { kind: "blocked", reason: "BB invocation preflight returned a malformed response" };
}

/** `preflightCliInvocation`, thrown as the command's error when blocked. */
export async function assertCliInvocationAllowed(
  args: CliInvocationPreflightArgs,
): Promise<void> {
  const outcome = await preflightCliInvocation(args);
  if (outcome.kind === "blocked") {
    throw new CliInvocationPreflightError(outcome.reason);
  }
}

/** The top-level `bb` subcommand an action belongs to. */
function topLevelCommandName(actionCommand: Command): string | null {
  let command: Command = actionCommand;
  while (command.parent !== null && command.parent.parent !== null) {
    command = command.parent;
  }
  return command.parent === null ? null : command.name();
}

export function registerCliInvocationPreflight(
  program: Command,
  args: {
    getUrl(): string;
    getContext(): ContextSnapshot;
    getArgv?(): readonly string[];
    getCwd?(): string;
  },
): void {
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    const topLevel = topLevelCommandName(actionCommand);
    if (topLevel !== null && LOCAL_COMMANDS.has(topLevel)) {
      return;
    }
    await assertCliInvocationAllowed({
      baseUrl: args.getUrl(),
      argv: args.getArgv?.() ?? process.argv.slice(2),
      cwd: args.getCwd?.() ?? process.cwd(),
      context: args.getContext(),
    });
  });
}
