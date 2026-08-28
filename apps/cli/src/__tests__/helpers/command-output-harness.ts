import { afterEach, beforeEach, expect, vi } from "vitest";
import { Command } from "commander";
import { z } from "zod";
import type { JsonValue } from "@bb/domain";

const readlineState = vi.hoisted(() => ({
  question: vi.fn(),
  close: vi.fn(),
}));

type MockTransportResolved =
  | Response
  | object
  | string
  | number
  | boolean
  | null
  | undefined;
type ConsoleLogArgs = Parameters<typeof console.log>;
export type CommandRegistrar = (program: Command) => void;

interface ApiRequestArgs {
  json?: JsonValue;
  param?: Record<string, string>;
  query?: Record<string, string>;
}

type ApiStubHandler = {
  bivarianceHack(
    args: ApiRequestArgs,
  ): MockTransportResolved | Promise<MockTransportResolved>;
}["bivarianceHack"];

const serverApiHandlers = new Map<string, ApiStubHandler>();
const jsonBodySchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonBodySchema),
    z.record(z.string(), jsonBodySchema),
  ]),
);

export const createClientMock = vi.fn();
export const readlineMocks = readlineState;
export const resolveLocalHostIdMock = vi.fn(async () => "host-test-001");

function routeMatches(route: string, url: URL, method: string): boolean {
  const routeParts = route.split(".");
  const routeMethod = routeParts.pop();
  if (routeMethod !== `$${method.toLowerCase()}`) return false;
  const pathParts = url.pathname.split("/").filter(Boolean).slice(1);
  if (routeParts.length !== pathParts.length) return false;
  return routeParts.every(
    (part, index) => part.startsWith(":") || part === pathParts[index],
  );
}

function requestArgs(
  route: string,
  url: URL,
  init: RequestInit,
): ApiRequestArgs {
  const routeParts = route.split(".");
  routeParts.pop();
  const pathParts = url.pathname.split("/").filter(Boolean).slice(1);
  const args: ApiRequestArgs = {};
  const params: Record<string, string> = {};
  routeParts.forEach((part, index) => {
    if (part.startsWith(":")) params[part.slice(1)] = pathParts[index]!;
  });
  if (Object.keys(params).length > 0) args.param = params;
  const query = Object.fromEntries(url.searchParams.entries());
  if (Object.keys(query).length > 0) args.query = query;
  if (init.body !== undefined) {
    args.json = jsonBodySchema.parse(JSON.parse(String(init.body)));
  }
  return args;
}

async function fetchStub(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname === "/status") {
    return Response.json({ hostId: await resolveLocalHostIdMock() });
  }
  const route = [...serverApiHandlers.keys()].find((candidate) =>
    routeMatches(candidate, url, init.method ?? "GET"),
  );
  const handler =
    route === undefined ? undefined : serverApiHandlers.get(route);
  if (route === undefined || handler === undefined) {
    return Response.json({ ok: true });
  }
  const result = await handler(requestArgs(route, url, init));
  return result instanceof Response ? result : Response.json(result);
}

export function setupCommandOutputTestEnvironment(): void {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code ?? 0}`);
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub);

    createClientMock.mockReset();
    resolveLocalHostIdMock.mockReset();
    resolveLocalHostIdMock.mockResolvedValue("host-test-001");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    readlineState.question.mockReset();
    readlineState.close.mockReset();
    readlineState.question.mockResolvedValue("no");

    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      const text = Buffer.from(chunk).toString("utf8");
      if (text.endsWith(" [y/N] ")) {
        void Promise.resolve(readlineState.question(text)).then((answer) => {
          process.stdin.emit("data", `${String(answer)}\n`);
        });
      }
      return true;
    });

    vi.stubEnv("BB_PROJECT_ID", undefined);
    vi.stubEnv("BB_THREAD_ID", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
}

export function stubServerApi(handlers: Record<string, ApiStubHandler>): void {
  serverApiHandlers.clear();
  for (const [path, handler] of Object.entries(handlers)) {
    serverApiHandlers.set(path, handler);
  }
}

export function collectLogLines(logSpy: ReturnType<typeof vi.spyOn>): string[] {
  return logSpy.mock.calls.map((args: ConsoleLogArgs) => args.join(" "));
}

export function collectLogPayloads(
  logSpy: ReturnType<typeof vi.spyOn>,
): string[] {
  return logSpy.mock.calls.map((args: ConsoleLogArgs) => String(args[0] ?? ""));
}

export async function runCommand(
  args: string[],
  register: CommandRegistrar,
): Promise<void> {
  const program = new Command();
  register(program);
  await program.parseAsync(["node", "bb", ...args]);
}

export async function getHelpOutput(
  args: string[],
  register: CommandRegistrar,
): Promise<string> {
  const program = new Command();
  const writeOut = vi.fn();
  program.exitOverride();
  program.configureOutput({
    writeOut,
    writeErr: vi.fn(),
  });
  register(program);

  await expect(
    program.parseAsync(["node", "bb", ...args, "--help"]),
  ).rejects.toMatchObject({
    code: "commander.helpDisplayed",
  });

  return writeOut.mock.calls
    .map((callArgs) => String(callArgs[0] ?? ""))
    .join("");
}
