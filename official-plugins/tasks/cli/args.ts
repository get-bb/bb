export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export interface ParsedArgs {
  readonly positionals: string[];
  readonly options: ReadonlyMap<string, string[]>;
  readonly flags: ReadonlySet<string>;
}

const VALUELESS_FLAGS = new Set([
  "active",
  "help",
  "json",
  "no-due",
  "no-folder",
  "no-parent",
  "notify",
  "unlink-bb-project",
  "yes",
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    if (name.length === 0) throw new CliError('invalid option "--"');
    if (VALUELESS_FLAGS.has(name)) {
      if (flags.has(name))
        throw new CliError(`--${name} may only be used once`);
      flags.add(name);
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`--${name} requires a value`);
    }
    const values = options.get(name) ?? [];
    values.push(value);
    options.set(name, values);
    index += 1;
  }

  return { positionals, options, flags };
}

export function assertAllowed(
  args: ParsedArgs,
  allowedOptions: readonly string[],
  allowedFlags: readonly string[] = [],
): void {
  const optionNames = new Set(allowedOptions);
  const flagNames = new Set(["help", "json", ...allowedFlags]);
  for (const name of args.options.keys()) {
    if (!optionNames.has(name)) throw new CliError(`unknown option --${name}`);
  }
  for (const name of args.flags) {
    if (!flagNames.has(name)) throw new CliError(`unknown option --${name}`);
  }
}

export function option(args: ParsedArgs, name: string): string | undefined {
  const values = args.options.get(name);
  if (!values || values.length === 0) return undefined;
  if (values.length > 1) throw new CliError(`--${name} may only be used once`);
  return values[0];
}

export function options(args: ParsedArgs, name: string): string[] {
  return [...(args.options.get(name) ?? [])];
}

export function requireOption(args: ParsedArgs, name: string): string {
  const value = option(args, name);
  if (value === undefined) throw new CliError(`missing required --${name}`);
  return value;
}

export function requirePositionals(
  args: ParsedArgs,
  count: number,
  usage: string,
): string[] {
  if (args.positionals.length !== count) throw new CliError(`Usage: ${usage}`);
  return args.positionals;
}
