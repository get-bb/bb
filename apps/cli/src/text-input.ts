import { readFile } from "node:fs/promises";
import { CliUsageError } from "./cli-usage-error.js";

export const TEXT_FILE_HELP_SUFFIX =
  "use - to read stdin. Prefer this for multi-line text: inside double quotes the shell runs `backticks` and $(...) before bb sees them";

export interface ResolveTextInputArgs {
  file: string | undefined;
  fileLabel: string;
  inline: string | undefined;
  inlineLabel: string;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function resolveTextInput(
  args: ResolveTextInputArgs,
): Promise<string | undefined> {
  if (args.file === undefined) return args.inline;
  if (args.inline !== undefined) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: null,
      message: `Provide only one of ${args.inlineLabel} or ${args.fileLabel}.`,
    });
  }
  const stdin = args.stdin ?? process.stdin;
  if (args.file === "-" && stdin.isTTY) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: `Pipe the text in, for example: cat prompt.md | bb ... ${args.fileLabel} -`,
      message: `${args.fileLabel} - reads stdin, but stdin is a terminal.`,
    });
  }
  const raw =
    args.file === "-"
      ? await readStream(stdin)
      : await readFile(args.file, "utf8").catch((error: unknown) => {
          throw new CliUsageError({
            code: "invalid_value",
            hint: null,
            message: `Could not read ${args.fileLabel} '${args.file}': ${error instanceof Error ? error.message : String(error)}`,
          });
        });
  const text = raw.replace(/\r?\n+$/u, "");
  if (text.trim().length === 0) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: null,
      message: `${args.fileLabel} ${args.file === "-" ? "stdin" : `'${args.file}'`} is empty.`,
    });
  }
  return text;
}

export async function requireTextInput(
  args: ResolveTextInputArgs,
): Promise<string> {
  const text = await resolveTextInput(args);
  if (text !== undefined) return text;
  throw new CliUsageError({
    code: "missing_required",
    hint: `Pass ${args.inlineLabel}, or ${args.fileLabel} <path> (use - to read stdin).`,
    message: `Missing ${args.inlineLabel}.`,
  });
}
