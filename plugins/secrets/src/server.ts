import path from "node:path";
import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { secretNameSchema, secretRequestResponseSchema } from "./contracts.js";
import { assertNoDuplicateAssignments, reconcileDotenv } from "./dotenv.js";

interface ParsedRequest {
  names: string[];
  purpose: string | null;
  descriptions: Map<string, string>;
  writeEnv: string;
}

interface FileSnapshot {
  content: string;
  sha256: string | null;
}

const fileReadResultSchema = z.object({
  content: z.string(),
  contentEncoding: z.enum(["utf8", "base64"]),
  sha256: z.string(),
});
const threadHostSchema = z.object({
  host: z.object({ id: z.string() }).nullable().optional(),
});
const fileWriteResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("written") }),
  z.object({
    outcome: z.literal("conflict"),
    currentSha256: z.string().nullable(),
  }),
]);

function requireOptionValue(
  argv: readonly string[],
  index: number,
  message: string,
): string {
  const value = argv[index]?.trim();
  if (!value || value.startsWith("--")) throw new Error(message);
  return value;
}

function parseSecretName(value: string, label: string): string {
  const parsed = secretNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${label} must start with a letter or underscore and contain only letters, digits, and underscores.`,
    );
  }
  return parsed.data;
}

function parseRequest(argv: string[]): ParsedRequest {
  if (argv[0] !== "request")
    throw new Error("Usage: bb secret request <NAME...> --write-env <path>");
  const names: string[] = [];
  const descriptions = new Map<string, string>();
  let purpose: string | null = null;
  let writeEnv: string | null = null;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      names.push(parseSecretName(token, "Variable name"));
      continue;
    }
    if (token === "--purpose") {
      purpose = requireOptionValue(
        argv,
        ++index,
        "--purpose requires a non-empty description.",
      );
      continue;
    }
    if (token === "--write-env") {
      writeEnv = requireOptionValue(
        argv,
        ++index,
        "--write-env requires a path.",
      );
      continue;
    }
    if (token === "--describe") {
      const name = parseSecretName(
        requireOptionValue(
          argv,
          ++index,
          "--describe requires NAME and DESCRIPTION.",
        ),
        "--describe NAME",
      );
      const description = requireOptionValue(
        argv,
        ++index,
        "--describe requires NAME and DESCRIPTION.",
      );
      if (descriptions.has(name))
        throw new Error(`Duplicate --describe for ${name}.`);
      descriptions.set(name, description);
      continue;
    }
    throw new Error(`Unknown option ${token}.`);
  }
  if (names.length === 0)
    throw new Error("Request at least one variable name.");
  if (new Set(names).size !== names.length)
    throw new Error("Variable names must be unique.");
  if (!writeEnv) throw new Error("--write-env is required in this version.");
  for (const name of descriptions.keys()) {
    if (!names.includes(name))
      throw new Error(`--describe references unrequested variable ${name}.`);
  }
  return { names, purpose, descriptions, writeEnv };
}

function resolveHostPath(cwd: string, candidate: string): string {
  if (path.posix.isAbsolute(candidate)) return path.posix.normalize(candidate);
  if (path.win32.isAbsolute(candidate)) return path.win32.normalize(candidate);
  return path.posix.isAbsolute(cwd)
    ? path.posix.resolve(cwd, candidate)
    : path.win32.resolve(cwd, candidate);
}

function httpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error))
    return null;
  const status = error.status;
  return typeof status === "number" ? status : null;
}

async function readSnapshot(
  bb: BbPluginApi,
  args: { hostId: string; path: string },
): Promise<FileSnapshot> {
  try {
    const result = fileReadResultSchema.parse(await bb.sdk.files.read(args));
    if (result.contentEncoding !== "utf8")
      throw new Error("Dotenv file is not valid UTF-8 text.");
    return { content: result.content, sha256: result.sha256 };
  } catch (error) {
    if (httpStatus(error) === 404) return { content: "", sha256: null };
    throw error;
  }
}

async function runRequest(
  bb: BbPluginApi,
  argv: string[],
  ctx: PluginCliContext,
): Promise<PluginCliResult> {
  const parsed = parseRequest(argv);
  if (!ctx.threadId)
    throw new Error("bb secret request must run from a bb thread.");
  if (!ctx.cwd)
    throw new Error(
      "bb secret request requires the invoking working directory.",
    );
  const thread = threadHostSchema.parse(
    await bb.sdk.threads.get({
      threadId: ctx.threadId,
      include: "host",
    }),
  );
  const host = thread.host;
  if (!host?.id) throw new Error("The thread needs a live host.");
  const destinationPath = resolveHostPath(ctx.cwd, parsed.writeEnv);
  const fileArgs = { hostId: host.id, path: destinationPath };
  let snapshot = await readSnapshot(bb, fileArgs);
  assertNoDuplicateAssignments(snapshot.content, parsed.names);

  const result = await bb.ui.requestInput(
    {
      threadId: ctx.threadId,
      rendererId: "secret-request",
      title: `Add secrets to ${destinationPath}`,
      payload: {
        purpose: parsed.purpose,
        destination: {
          kind: "dotenv",
          path: destinationPath,
        },
        fields: parsed.names.map((name) => ({
          name,
          description: parsed.descriptions.get(name) ?? null,
        })),
      },
    },
    { signal: ctx.signal },
  );
  if (result.outcome === "cancelled") {
    return {
      exitCode: 1,
      stderr: `Secret request cancelled (${result.reason}).\n`,
    };
  }
  const response = secretRequestResponseSchema.parse(result.value);
  const responseNames = Object.keys(response.values).sort();
  if (responseNames.join("\0") !== [...parsed.names].sort().join("\0")) {
    throw new Error(
      "Secret response did not contain exactly the requested variables.",
    );
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reconciled = reconcileDotenv(snapshot.content, response.values);
    const write = fileWriteResultSchema.parse(
      await bb.sdk.files.write({
        ...fileArgs,
        content: reconciled.content,
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256: snapshot.sha256,
        mode: 0o600,
      }),
    );
    if (write.outcome === "written") {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ path: destinationPath, names: parsed.names, added: reconciled.added, updated: reconciled.updated, unchanged: reconciled.unchanged })}\n`,
      };
    }
    if (attempt === 1)
      throw new Error(
        "Dotenv file changed twice while secrets were being written; no write was applied.",
      );
    snapshot = await readSnapshot(bb, fileArgs);
    assertNoDuplicateAssignments(snapshot.content, parsed.names);
  }
  throw new Error("Unreachable dotenv write state.");
}

export default function plugin(bb: BbPluginApi) {
  bb.cli.register({
    name: "secret",
    summary: "Securely request credentials and write them to a dotenv file.",
    commands: [
      {
        name: "request",
        summary: "Request one or more secrets in a secure user form.",
        usage:
          "bb secret request <NAME...> --write-env <path> [--purpose <text>] [--describe <NAME> <text>]...",
      },
    ],
    async run(argv, ctx) {
      try {
        return await runRequest(bb, argv, ctx);
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
