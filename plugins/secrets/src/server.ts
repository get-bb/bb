import path from "node:path";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  SECRET_REQUEST_RENDERER_ID,
  secretNameSchema,
  secretRequestResponseSchema,
} from "./secret-request.js";
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

const DESCRIBE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DESCRIBE_SPELLINGS = new Set([
  "--describe",
  "--description",
  "--describe-variable",
]);

function cliError(message: string, code: string, hint?: string): never {
  throw new PluginCliError(message, {
    code,
    ...(hint === undefined ? {} : { hint }),
  });
}

function parseSecretName(value: string, label: string): string {
  const parsed = secretNameSchema.safeParse(value);
  if (!parsed.success) {
    cliError(
      `${label} must start with a letter or underscore and contain only letters, digits, and underscores.`,
      "invalid_variable_name",
    );
  }
  return parsed.data;
}

function foldDescribePairs(argv: readonly string[]): string[] {
  const folded: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const name = argv[index + 1];
    const description = argv[index + 2];
    if (
      !DESCRIBE_SPELLINGS.has(token) ||
      name === undefined ||
      description === undefined ||
      !DESCRIBE_NAME_PATTERN.test(name) ||
      description.startsWith("--")
    ) {
      folded.push(token);
      continue;
    }
    folded.push(`--describe=${name}=${description}`);
    index += 2;
  }
  return folded;
}

function parseDescriptions(
  entries: readonly string[],
  names: readonly string[],
): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      cliError(
        "--describe requires NAME and DESCRIPTION.",
        "invalid_describe",
        "Write --describe NAME 'text' or --describe NAME=text.",
      );
    }
    const name = parseSecretName(
      entry.slice(0, separator).trim(),
      "--describe NAME",
    );
    const description = entry.slice(separator + 1).trim();
    if (description.length === 0) {
      cliError(
        "--describe requires NAME and DESCRIPTION.",
        "invalid_describe",
        "Write --describe NAME 'text' or --describe NAME=text.",
      );
    }
    if (descriptions.has(name))
      cliError(`Duplicate --describe for ${name}.`, "duplicate_describe");
    if (!names.includes(name)) {
      cliError(
        `--describe references unrequested variable ${name}.`,
        "unrequested_describe",
      );
    }
    descriptions.set(name, description);
  }
  return descriptions;
}

function parseRequest(input: {
  names: readonly string[];
  purpose: string | undefined;
  describe: readonly string[];
  writeEnv: string;
}): ParsedRequest {
  const names = input.names.map((name) =>
    parseSecretName(name, "Variable name"),
  );
  if (new Set(names).size !== names.length)
    cliError("Variable names must be unique.", "duplicate_variable_name");
  const purpose = input.purpose?.trim();
  if (purpose !== undefined && purpose.length === 0) {
    cliError(
      "--purpose requires a non-empty description.",
      "invalid_purpose",
      "Write --purpose 'why these credentials are needed'.",
    );
  }
  const writeEnv = input.writeEnv.trim();
  if (writeEnv.length === 0)
    cliError("--write-env requires a path.", "invalid_write_env");
  return {
    names,
    purpose: purpose ?? null,
    descriptions: parseDescriptions(input.describe, names),
    writeEnv,
  };
}

function resolveHostPath(cwd: string, candidate: string): string {
  if (path.posix.isAbsolute(candidate)) return path.posix.normalize(candidate);
  if (path.win32.isAbsolute(candidate)) return path.win32.normalize(candidate);
  return path.posix.isAbsolute(cwd)
    ? path.posix.resolve(cwd, candidate)
    : path.win32.resolve(cwd, candidate);
}

const ROW_LABEL_MAX_LENGTH = 80;
const ROW_TITLE_MAX_LENGTH = 160;

function clampToLength(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
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
  parsed: ParsedRequest,
  ctx: PluginCliContext,
): Promise<PluginCliResult> {
  if (!ctx.threadId)
    cliError("bb secret request must run from a bb thread.", "missing_thread");
  if (!ctx.cwd) {
    cliError(
      "bb secret request requires the invoking working directory.",
      "missing_cwd",
    );
  }
  const thread = threadHostSchema.parse(
    await bb.sdk.threads.get({
      threadId: ctx.threadId,
      include: "host",
    }),
  );
  const host = thread.host;
  if (!host?.id) cliError("The thread needs a live host.", "missing_host");
  const destinationPath = resolveHostPath(ctx.cwd, parsed.writeEnv);
  const fileArgs = { hostId: host.id, path: destinationPath };
  let snapshot = await readSnapshot(bb, fileArgs);
  assertNoDuplicateAssignments(snapshot.content, parsed.names);

  const result = await bb.ui.requestInput(
    {
      threadId: ctx.threadId,
      rendererId: SECRET_REQUEST_RENDERER_ID,
      title: "Add secrets",
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
      presentation: {
        label: {
          pending: clampToLength(
            `Requesting ${parsed.names.join(", ")}`,
            ROW_LABEL_MAX_LENGTH,
          ),
          completed: clampToLength(
            `Requested ${parsed.names.join(", ")}`,
            ROW_LABEL_MAX_LENGTH,
          ),
        },
      },
      describeSubmission: (value) => {
        const response = secretRequestResponseSchema.safeParse(value);
        const names = response.success
          ? Object.keys(response.data.values).sort()
          : [];
        return {
          title: clampToLength(
            `Provided ${names.join(", ")}`,
            ROW_TITLE_MAX_LENGTH,
          ),
          detail: [destinationPath, ...names.map((name) => `- ${name}`)].join(
            "\n",
          ),
        };
      },
    },
    { signal: ctx.signal },
  );
  if (result.outcome === "cancelled") {
    cliError(
      `Secret request cancelled (${result.reason}).`,
      "secret_request_cancelled",
    );
  }
  const response = secretRequestResponseSchema.parse(result.value);
  const responseNames = Object.keys(response.values).sort();
  if (responseNames.join("\0") !== [...parsed.names].sort().join("\0")) {
    cliError(
      "Secret response did not contain exactly the requested variables.",
      "unexpected_secret_response",
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
    if (attempt === 1) {
      cliError(
        "Dotenv file changed twice while secrets were being written; no write was applied.",
        "dotenv_write_conflict",
      );
    }
    snapshot = await readSnapshot(bb, fileArgs);
    assertNoDuplicateAssignments(snapshot.content, parsed.names);
  }
  cliError("Unreachable dotenv write state.", "unreachable_write_state");
}

export default function plugin(bb: BbPluginApi) {
  const cli = defineCli({
    name: "secret",
    summary: "Securely request credentials and write them to a dotenv file.",
    description:
      "Values are typed by the user into a secure form; they never reach the agent, argv, or logs.",
    commands: {
      request: cliCommand({
        summary: "Request one or more secrets in a secure user form.",
        description:
          "Batch every currently known variable into one request. Relative --write-env paths resolve from the CLI working directory; absolute paths may point anywhere on the thread's host.",
        positionals: [
          {
            name: "name",
            description:
              "Environment variable to request (letters, digits, underscores; must not start with a digit); repeat for each variable",
            required: true,
            variadic: true,
          },
        ],
        options: {
          "write-env": {
            type: "string",
            required: true,
            placeholder: "PATH",
            aliases: ["env-file", "dotenv", "write-env-file"],
            description:
              "Dotenv file the values are written to, with mode 0600 and existing assignments preserved",
          },
          purpose: {
            type: "string",
            placeholder: "TEXT",
            aliases: ["reason", "why"],
            description:
              "One line telling the user why these credentials are needed",
          },
          describe: {
            type: "string",
            repeatable: true,
            placeholder: "NAME=TEXT",
            aliases: ["description", "describe-variable"],
            description:
              "Short description of one requested variable, written as NAME=TEXT or as the two-token form NAME TEXT; repeat per variable",
          },
          json: {
            type: "boolean",
            description:
              "Report failures as a JSON envelope on stdout; the success line is always JSON",
          },
        },
        async run(input, ctx) {
          const parsed = parseRequest({
            names: input.positionals.name,
            purpose: input.options.purpose,
            describe: input.options.describe,
            writeEnv: input.options["write-env"],
          });
          try {
            return await runRequest(bb, parsed, ctx);
          } catch (error) {
            if (error instanceof PluginCliError) throw error;
            throw new PluginCliError(
              error instanceof Error ? error.message : String(error),
            );
          }
        },
      }),
    },
  });
  bb.cli.register({
    ...cli,
    run: (argv, ctx) => cli.run(foldDescribePairs(argv), ctx),
  });
}
