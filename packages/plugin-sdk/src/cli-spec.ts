import type {
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
} from "./backend-contract.js";

/** Duration suffixes, shared with the core `bb` CLI grammar. */
export type PluginCliDurationUnit = "ms" | "s" | "m" | "h" | "d";

/**
 * Failure codes the parser itself emits in the `--json` error envelope.
 * A command raising `PluginCliError` may use any snake_case code.
 */
export type PluginCliErrorCode =
  | "unknown_command"
  | "missing_command"
  | "unknown_option"
  | "missing_required"
  | "invalid_value"
  | "unexpected_argument";

interface PluginCliOptionBase {
  /** One line shown in `--help`; state the limits agents keep hitting. */
  description: string;
  /** Extra spellings accepted silently and mapped onto this option. */
  aliases?: readonly string[];
  /** Single-character form, written without the second dash (`-f`). */
  short?: string;
  /** Kept out of `--help` and the generated usage line. */
  hidden?: boolean;
  /** Value placeholder in help and usage; defaults to the value type. */
  placeholder?: string;
  /**
   * Recognize `--<name>-stdin`. The `bb` CLI reads that value from stdin and
   * rewrites it to `--<name> <value>` before the plugin runs, so a command
   * that still sees it reports that instead of "unknown option".
   */
  stdin?: boolean;
}

/** A valueless flag; absent means `false`. */
export interface PluginCliBooleanOption extends PluginCliOptionBase {
  type: "boolean";
}

export interface PluginCliStringOption extends PluginCliOptionBase {
  type: "string";
  required?: boolean;
  repeatable?: boolean;
  /** Split each value on this separator, so `--tag a,b` is two tags. */
  split?: string;
  default?: string;
}

export interface PluginCliIntegerOption extends PluginCliOptionBase {
  type: "integer";
  min: number;
  max: number;
  required?: boolean;
  default?: number;
}

export interface PluginCliEnumOption extends PluginCliOptionBase {
  type: "enum";
  values: readonly string[];
  required?: boolean;
  repeatable?: boolean;
  /** Split each value on this separator, so `--kind a,b` is two values. */
  split?: string;
  default?: string;
}

/** A duration parsed to milliseconds with the core CLI's grammar. */
export interface PluginCliDurationOption extends PluginCliOptionBase {
  type: "duration";
  /** Unit assumed for a bare number when `bareUnits` is absent. */
  defaultUnit: PluginCliDurationUnit;
  /**
   * Units tried in order for a bare number, taking the first whose
   * milliseconds fall inside `min`/`max`. Declare it when two units are
   * plausible and their valid ranges do not overlap (`90` seconds versus
   * `1500` milliseconds); a number matching neither is rejected with both
   * forms named.
   */
  bareUnits?: readonly PluginCliDurationUnit[];
  /** Inclusive bounds in milliseconds. */
  min?: number;
  max?: number;
  required?: boolean;
  /** Default in milliseconds. */
  default?: number;
}

export type PluginCliOption =
  | PluginCliBooleanOption
  | PluginCliStringOption
  | PluginCliIntegerOption
  | PluginCliEnumOption
  | PluginCliDurationOption;

export interface PluginCliPositional {
  name: string;
  description: string;
  required?: boolean;
  /** Collects every remaining bare token into a string array. */
  variadic?: boolean;
}

/**
 * Relationships between options that the parser enforces before `run`.
 * Rules that depend on a value (which options a `--backend` choice allows)
 * belong in `run`, raised as `PluginCliError`.
 */
export type PluginCliConstraint =
  | { kind: "exactly-one"; options: readonly string[] }
  | { kind: "at-most-one"; options: readonly string[] }
  | { kind: "at-least-one"; options: readonly string[] }
  | { kind: "requires"; option: string; needs: readonly string[] };

type CliOptions = Record<string, PluginCliOption>;
type CliPositionals = readonly PluginCliPositional[];

type OptionValue<TOption> = TOption extends { type: "boolean" }
  ? boolean
  : TOption extends { type: "enum"; values: readonly (infer TValue)[] }
    ? TValue
    : TOption extends { type: "string" }
      ? string
      : number;

type OptionResolved<TOption> = TOption extends { type: "boolean" }
  ? boolean
  : TOption extends { repeatable: true }
    ? OptionValue<TOption>[]
    : TOption extends { required: true }
      ? OptionValue<TOption>
      : TOption extends { default: unknown }
        ? OptionValue<TOption>
        : OptionValue<TOption> | undefined;

/** Validated option values, keyed by the spec's option names. */
export type PluginCliOptionValues<TOptions extends CliOptions> = {
  [TName in keyof TOptions]: OptionResolved<TOptions[TName]>;
};

/** Validated positional values, keyed by the spec's positional names. */
export type PluginCliPositionalValues<TPositionals extends CliPositionals> = {
  [TEntry in TPositionals[number] as TEntry["name"]]: TEntry extends {
    variadic: true;
  }
    ? string[]
    : TEntry extends { required: true }
      ? string
      : string | undefined;
};

/** What a command's `run` receives once every value has been validated. */
export interface PluginCliRunInput<
  TOptions extends CliOptions = CliOptions,
  TPositionals extends CliPositionals = CliPositionals,
> {
  options: PluginCliOptionValues<TOptions>;
  positionals: PluginCliPositionalValues<TPositionals>;
  /** Tokens after `--` when the command declares `passthrough`. */
  passthrough: string[];
  /** This command's rendered `--help` text. */
  help: string;
}

type ErasedOptionValue = string | number | boolean | string[] | undefined;

interface ErasedRunInput {
  options: Record<string, ErasedOptionValue>;
  positionals: Record<string, string | string[] | undefined>;
  passthrough: string[];
  help: string;
}

/**
 * One command as `defineCli` consumes it. Build it with
 * `cliCommand` so `run` receives typed values. The declaration
 * is inert data: help and usage render from it without running the command.
 */
export interface PluginCliCommand {
  summary: string;
  description?: string;
  /** Extra invocation paths that run this command, hidden from help. */
  aliases?: readonly string[];
  /** Mistyped command names that should suggest this command. */
  suggestFor?: readonly string[];
  hidden?: boolean;
  options?: CliOptions;
  positionals?: CliPositionals;
  constraints?: readonly PluginCliConstraint[];
  /** Put tokens after `--` in `input.passthrough` instead of positionals. */
  passthrough?: boolean;
  /** Hint added when an unexpected bare token is passed. */
  unexpectedPositionalHint?: string;
  run(
    input: ErasedRunInput,
    ctx: PluginCliContext,
  ): PluginCliResult | Promise<PluginCliResult>;
}

/** The declarative CLI a plugin hands to `bb.cli.register`. */
export interface PluginCliSpec {
  /** Top-level command name (`bb <name> …`): lowercase `[a-z0-9-]+`. */
  name: string;
  summary: string;
  /** Prose printed under the summary in top-level help. */
  description?: string;
  /** Runs when the invocation names no command (`bb connect --code …`). */
  root?: PluginCliCommand;
  /** Commands keyed by invocation path (`"add"`, `"account add"`). */
  commands: Record<string, PluginCliCommand>;
  /** Exit code for usage errors; defaults to 1. */
  usageErrorExitCode?: number;
}

/**
 * A failure a command raises itself, reported exactly like a parse error:
 * human text on stderr, plus the `{ ok: false, error }` envelope on stdout
 * when the invocation carries `--json`.
 */
export class PluginCliError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(
    message: string,
    options?: { code?: string; hint?: string; exitCode?: number },
  ) {
    super(message);
    this.name = "CliError";
    this.code = options?.code ?? "command_failed";
    this.hint = options?.hint;
    this.exitCode = options?.exitCode ?? 1;
  }
}

/**
 * Declares one command. Inference flows from `options` and `positionals`
 * into `run`, so `input.options.scope` is the declared enum union and a
 * required option is never `undefined`.
 */
export function cliCommand<
  const TOptions extends CliOptions = Record<string, never>,
  const TPositionals extends CliPositionals = readonly [],
>(command: {
  summary: string;
  description?: string;
  aliases?: readonly string[];
  suggestFor?: readonly string[];
  hidden?: boolean;
  options?: TOptions;
  positionals?: TPositionals;
  constraints?: readonly PluginCliConstraint[];
  passthrough?: boolean;
  unexpectedPositionalHint?: string;
  run(
    input: PluginCliRunInput<TOptions, TPositionals>,
    ctx: PluginCliContext,
  ): PluginCliResult | Promise<PluginCliResult>;
}): PluginCliCommand {
  return command;
}

const DURATION_UNIT_MS: Record<PluginCliDurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_UNIT_LABEL: Record<PluginCliDurationUnit, string> = {
  ms: "milliseconds",
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
};

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;

interface UsageFailure {
  code: string;
  message: string;
  hint?: string;
  usage?: string;
  detail?: string;
  exitCode: number;
}

class UsageError extends Error {
  readonly failure: UsageFailure;

  constructor(failure: UsageFailure) {
    super(failure.message);
    this.name = "CliUsageError";
    this.failure = failure;
  }
}

interface ResolvedCommand {
  path: string;
  command: PluginCliCommand;
  words: number;
}

function editDistance(left: string, right: string): number {
  const columns = right.length + 1;
  let previous = Array.from({ length: columns }, (_unused, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column < columns; column += 1) {
      const substitution =
        (previous[column - 1] ?? 0) +
        (left[row - 1] === right[column - 1] ? 0 : 1);
      const deletion = (previous[column] ?? 0) + 1;
      const insertion = (current[column - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[columns - 1] ?? Math.max(left.length, right.length);
}

function nearest(input: string, candidates: readonly string[]): string | null {
  let best: { name: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = editDistance(input, candidate);
    const related =
      score <= 2 ||
      (input.length >= 3 && candidate.startsWith(input)) ||
      (candidate.length >= 3 && input.startsWith(candidate));
    if (!related) continue;
    if (best === null || score < best.score) best = { name: candidate, score };
  }
  return best?.name ?? null;
}

function isRequired(option: PluginCliOption): boolean {
  return option.type !== "boolean" && option.required === true;
}

function isRepeatable(option: PluginCliOption): boolean {
  if (option.type === "string" || option.type === "enum") {
    return option.repeatable === true;
  }
  return false;
}

function defaultOf(option: PluginCliOption): string | number | undefined {
  return option.type === "boolean" ? undefined : option.default;
}

function optionPlaceholder(option: PluginCliOption): string {
  if (option.placeholder !== undefined) return option.placeholder;
  switch (option.type) {
    case "boolean":
      return "";
    case "enum":
      return option.values.join("|");
    case "integer":
      return `${option.min}-${option.max}`;
    case "duration":
      return "duration";
    default:
      return "value";
  }
}

function optionSignature(name: string, option: PluginCliOption): string {
  const placeholder = optionPlaceholder(option);
  return placeholder ? `--${name} <${placeholder}>` : `--${name}`;
}

function visibleOptions(
  command: PluginCliCommand,
): Array<[string, PluginCliOption]> {
  return Object.entries(command.options ?? {}).filter(
    ([, option]) => option.hidden !== true,
  );
}

function visibleCommands(
  spec: PluginCliSpec,
): Array<[string, PluginCliCommand]> {
  return Object.entries(spec.commands).filter(
    ([, command]) => command.hidden !== true,
  );
}

function usageLine(
  cliName: string,
  path: string,
  command: PluginCliCommand,
): string {
  const parts = [path ? `bb ${cliName} ${path}` : `bb ${cliName}`];
  for (const positional of command.positionals ?? []) {
    const token = positional.variadic
      ? `<${positional.name}...>`
      : `<${positional.name}>`;
    parts.push(positional.required ? token : `[${token}]`);
  }
  for (const [name, option] of visibleOptions(command)) {
    const signature = optionSignature(name, option);
    if (isRequired(option)) parts.push(signature);
    else if (isRepeatable(option)) parts.push(`[${signature}]...`);
    else parts.push(`[${signature}]`);
  }
  if (command.passthrough === true) parts.push("-- <command...>");
  return parts.join(" ");
}

function padColumns(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = rows.reduce(
    (longest, [left]) =>
      left.length <= 34 ? Math.max(longest, left.length) : longest,
    0,
  );
  return rows.map(([left, right]) =>
    `  ${left.padEnd(width)}  ${right}`.trimEnd(),
  );
}

function optionHelpRow(
  name: string,
  option: PluginCliOption,
): [string, string] {
  const markers: string[] = [];
  if (isRequired(option)) markers.push("required");
  if (isRepeatable(option)) markers.push("repeatable");
  const fallback = defaultOf(option);
  if (fallback !== undefined) markers.push(`default: ${fallback}`);
  if (option.stdin === true) markers.push(`or --${name}-stdin from the bb CLI`);
  const suffix = markers.length > 0 ? ` (${markers.join(", ")})` : "";
  return [optionSignature(name, option), `${option.description}${suffix}`];
}

function constraintRows(command: PluginCliCommand): Array<[string, string]> {
  return (command.constraints ?? []).map((constraint) => {
    if (constraint.kind === "requires") {
      return [
        `--${constraint.option}`,
        `requires ${constraint.needs.map((need) => `--${need}`).join(", ")}`,
      ];
    }
    const label =
      constraint.kind === "exactly-one"
        ? "Exactly one of:"
        : constraint.kind === "at-most-one"
          ? "At most one of:"
          : "At least one of:";
    return [label, constraint.options.map((name) => `--${name}`).join(", ")];
  });
}

function optionsSection(command: PluginCliCommand): string[] {
  const options = visibleOptions(command);
  if (options.length === 0) return [];
  const rows: Array<[string, string]> = options.map(([name, option]) =>
    optionHelpRow(name, option),
  );
  rows.push(["--help, -h", "Show this help and exit"]);
  return ["", "Options:", ...padColumns(rows)];
}

function positionalsSection(command: PluginCliCommand): string[] {
  const positionals = command.positionals ?? [];
  if (positionals.length === 0) return [];
  return [
    "",
    "Arguments:",
    ...padColumns(
      positionals.map((positional) => [
        positional.variadic
          ? `<${positional.name}...>`
          : `<${positional.name}>`,
        `${positional.description}${positional.required === true ? " (required)" : ""}`,
      ]),
    ),
  ];
}

function rulesSection(command: PluginCliCommand): string[] {
  const rows = constraintRows(command);
  if (rows.length === 0) return [];
  return ["", "Rules:", ...padColumns(rows)];
}

function commandRows(spec: PluginCliSpec): Array<[string, string]> {
  return visibleCommands(spec).map(([path, command]) => [
    `bb ${spec.name} ${path}`,
    command.summary,
  ]);
}

function renderTopLevelHelp(spec: PluginCliSpec): string {
  const lines = [`bb ${spec.name} — ${spec.summary}`];
  if (spec.description !== undefined) lines.push("", spec.description);
  lines.push("", "Usage:");
  if (spec.root) lines.push(`  ${usageLine(spec.name, "", spec.root)}`);
  lines.push(`  bb ${spec.name} <command> [options]`);
  const rows = commandRows(spec);
  if (rows.length > 0) lines.push("", "Commands:", ...padColumns(rows));
  if (spec.root) {
    lines.push(...positionalsSection(spec.root), ...optionsSection(spec.root));
  }
  lines.push(
    "",
    `Run \`bb ${spec.name} <command> --help\` for a command's arguments and options.`,
  );
  return `${lines.join("\n")}\n`;
}

function renderHelp(
  spec: PluginCliSpec,
  resolved: ResolvedCommand | null,
): string {
  if (resolved === null) return renderTopLevelHelp(spec);
  const { path, command } = resolved;
  const lines = [
    `bb ${spec.name} ${path} — ${command.summary}`,
    "",
    "Usage:",
    `  ${usageLine(spec.name, path, command)}`,
  ];
  if (command.description !== undefined) lines.push("", command.description);
  lines.push(
    ...positionalsSection(command),
    ...optionsSection(command),
    ...rulesSection(command),
  );
  return `${lines.join("\n")}\n`;
}

function commandListBlock(spec: PluginCliSpec): string {
  return ["Commands:", ...padColumns(commandRows(spec))].join("\n");
}

function leadingWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  return words;
}

function resolveCommand(
  spec: PluginCliSpec,
  words: readonly string[],
): ResolvedCommand | null {
  const candidates: Array<{ path: string; words: string[] }> = [];
  for (const [path, command] of Object.entries(spec.commands)) {
    candidates.push({ path, words: path.split(" ") });
    for (const alias of command.aliases ?? []) {
      candidates.push({ path, words: alias.split(" ") });
    }
  }
  candidates.sort((left, right) => right.words.length - left.words.length);
  for (const candidate of candidates) {
    if (candidate.words.length > words.length) continue;
    if (!candidate.words.every((word, index) => words[index] === word)) {
      continue;
    }
    const command = spec.commands[candidate.path];
    if (command) {
      return {
        path: candidate.path,
        command,
        words: candidate.words.length,
      };
    }
  }
  return null;
}

function unknownCommandError(
  spec: PluginCliSpec,
  words: readonly string[],
): UsageError {
  const suggestions = new Map<string, string>();
  for (const [path, command] of Object.entries(spec.commands)) {
    for (const alias of command.aliases ?? []) suggestions.set(alias, path);
    for (const near of command.suggestFor ?? []) suggestions.set(near, path);
  }
  const visiblePaths = visibleCommands(spec).map(([path]) => path.split(" "));
  let shared = 0;
  while (
    shared < words.length &&
    visiblePaths.some(
      (path) =>
        path.length > shared + 1 &&
        path.slice(0, shared + 1).every((word, index) => words[index] === word),
    )
  ) {
    shared += 1;
  }
  const prefix = words.slice(0, shared);
  const siblings = [
    ...new Set(
      visiblePaths
        .filter(
          (path) =>
            path.length > shared &&
            prefix.every((word, index) => path[index] === word),
        )
        .map((path) => path[shared] ?? ""),
    ),
  ];
  const attemptedWord = words[shared];
  if (attemptedWord === undefined) {
    return new UsageError({
      code: "missing_command",
      message: `missing command after '${prefix.join(" ")}'`,
      hint: `Expected one of: ${siblings.join(", ")}`,
      detail: commandListBlock(spec),
      exitCode: spec.usageErrorExitCode ?? 1,
    });
  }
  const attempted = [...prefix, attemptedWord].join(" ");
  const nearestSibling = nearest(attemptedWord, siblings);
  const suggestion =
    suggestions.get(attempted) ??
    suggestions.get(attemptedWord) ??
    (nearestSibling === null ? null : [...prefix, nearestSibling].join(" "));
  return new UsageError({
    code: "unknown_command",
    message: `unknown command '${attempted}'`,
    ...(suggestion === null || suggestion === undefined
      ? {}
      : { hint: `Did you mean ${suggestion}?` }),
    detail: commandListBlock(spec),
    exitCode: spec.usageErrorExitCode ?? 1,
  });
}

interface ParsedTokens {
  values: Map<string, string[]>;
  flags: Set<string>;
  positionals: string[];
  passthrough: string[];
}

function usageFailure(
  spec: PluginCliSpec,
  path: string,
  command: PluginCliCommand,
  failure: Omit<UsageFailure, "exitCode" | "usage">,
): UsageError {
  return new UsageError({
    ...failure,
    usage: `Usage:\n  ${usageLine(spec.name, path, command)}`,
    exitCode: spec.usageErrorExitCode ?? 1,
  });
}

function namesDeclaredOption(
  token: string,
  byName: ReadonlyMap<string, string>,
  byShort: ReadonlyMap<string, string>,
): boolean {
  if (token === "--" || token === "--help" || token === "-h") return true;
  if (token.startsWith("--")) {
    const spelled = token.slice(2).split("=")[0] ?? "";
    return (
      byName.has(spelled) ||
      (spelled.endsWith("-stdin") &&
        byName.has(spelled.slice(0, -"-stdin".length)))
    );
  }
  if (token.startsWith("-") && token.length > 1) {
    return byShort.has(token.slice(1).split("=")[0] ?? "");
  }
  return false;
}

function tokenize(
  spec: PluginCliSpec,
  path: string,
  command: PluginCliCommand,
  argv: readonly string[],
): ParsedTokens {
  const options = command.options ?? {};
  const byName = new Map<string, string>();
  const byShort = new Map<string, string>();
  for (const [name, option] of Object.entries(options)) {
    byName.set(name, name);
    for (const alias of option.aliases ?? []) byName.set(alias, name);
    if (option.short !== undefined) byShort.set(option.short, name);
  }
  const parsed: ParsedTokens = {
    values: new Map(),
    flags: new Set(),
    positionals: [],
    passthrough: [],
  };
  const fail = (failure: Omit<UsageFailure, "exitCode" | "usage">) =>
    usageFailure(spec, path, command, failure);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      const rest = argv.slice(index + 1);
      if (command.passthrough === true) parsed.passthrough.push(...rest);
      else parsed.positionals.push(...rest);
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      parsed.positionals.push(token);
      continue;
    }
    const long = token.startsWith("--");
    const body = long ? token.slice(2) : token.slice(1);
    const separator = body.indexOf("=");
    const spelled = separator === -1 ? body : body.slice(0, separator);
    const inline = separator === -1 ? undefined : body.slice(separator + 1);
    const name = long ? byName.get(spelled) : byShort.get(spelled);
    const option = name === undefined ? undefined : options[name];
    if (name === undefined || option === undefined) {
      const stdinTarget = spelled.endsWith("-stdin")
        ? byName.get(spelled.slice(0, -"-stdin".length))
        : undefined;
      if (stdinTarget !== undefined && options[stdinTarget]?.stdin === true) {
        throw fail({
          code: "invalid_value",
          message: `--${spelled} is read by the bb CLI, which rewrites it to --${stdinTarget} <value> before this command runs`,
          hint: `Pass --${stdinTarget} <value> here, or run this through the bb CLI.`,
        });
      }
      const suggestion = nearest(
        spelled,
        visibleOptions(command).map(([optionName]) => optionName),
      );
      throw fail({
        code: "unknown_option",
        message: `unknown option '${long ? "--" : "-"}${spelled}'`,
        ...(suggestion === null
          ? {}
          : { hint: `Did you mean --${suggestion}?` }),
      });
    }
    if (option.type === "boolean") {
      if (inline !== undefined && inline !== "true" && inline !== "false") {
        throw fail({
          code: "invalid_value",
          message: `invalid value '${inline}' for --${name}. Expected one of: true, false`,
        });
      }
      if (parsed.flags.has(name)) {
        throw fail({
          code: "unexpected_argument",
          message: `--${name} was given more than once`,
        });
      }
      if (inline !== "false") parsed.flags.add(name);
      continue;
    }
    const existing = parsed.values.get(name);
    if (existing !== undefined && !isRepeatable(option)) {
      throw fail({
        code: "unexpected_argument",
        message: `--${name} was given more than once; it takes a single value`,
      });
    }
    if (inline !== undefined) {
      parsed.values.set(name, [...(existing ?? []), inline]);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || namesDeclaredOption(next, byName, byShort)) {
      throw fail({
        code: "invalid_value",
        message: `--${name} requires a value`,
        hint: `Write --${name}=<value> when the value is itself an option name.`,
      });
    }
    parsed.values.set(name, [...(existing ?? []), next]);
    index += 1;
  }
  return parsed;
}

function parseIntegerValue(
  name: string,
  option: PluginCliIntegerOption,
  raw: string,
): number {
  const expected = `Expected an integer between ${option.min} and ${option.max}`;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`invalid value '${raw}' for --${name}. ${expected}`);
  }
  const value = Number(raw);
  if (value < option.min || value > option.max) {
    throw new Error(`invalid value '${raw}' for --${name}. ${expected}`);
  }
  return value;
}

function durationExpectation(option: PluginCliDurationOption): string {
  const forms = (option.bareUnits ?? [option.defaultUnit]).map((unit) => {
    const unitMs = DURATION_UNIT_MS[unit];
    const low =
      option.min === undefined ? null : Math.ceil(option.min / unitMs);
    const high =
      option.max === undefined ? null : Math.floor(option.max / unitMs);
    const range = low !== null && high !== null ? ` (${low}-${high})` : "";
    return `a bare number of ${DURATION_UNIT_LABEL[unit]}${range}`;
  });
  return `Expected a duration with a unit (1500ms, 90s, 5m, 2h) or ${forms.join(", or ")}`;
}

function parseDurationValue(
  name: string,
  option: PluginCliDurationOption,
  raw: string,
): number {
  const invalid = () =>
    new Error(
      `invalid value '${raw}' for --${name}. ${durationExpectation(option)}`,
    );
  const match = DURATION_PATTERN.exec(raw.trim().toLowerCase());
  if (match === null) throw invalid();
  const amount = Number.parseFloat(match[1] ?? "");
  const unit = match[2];
  const inRange = (value: number) =>
    (option.min === undefined || value >= option.min) &&
    (option.max === undefined || value <= option.max);
  if (unit !== undefined) {
    const value = Math.round(
      amount * DURATION_UNIT_MS[unit as PluginCliDurationUnit],
    );
    if (!inRange(value)) throw invalid();
    return value;
  }
  for (const candidate of option.bareUnits ?? [option.defaultUnit]) {
    const value = Math.round(amount * DURATION_UNIT_MS[candidate]);
    if (inRange(value)) return value;
  }
  throw invalid();
}

function parseOptionValue(
  name: string,
  option: PluginCliOption,
  raw: string,
): string | number {
  switch (option.type) {
    case "enum": {
      if (!option.values.includes(raw)) {
        throw new Error(
          `invalid value '${raw}' for --${name}. Expected one of: ${option.values.join(", ")}`,
        );
      }
      return raw;
    }
    case "integer":
      return parseIntegerValue(name, option, raw);
    case "duration":
      return parseDurationValue(name, option, raw);
    default:
      return raw;
  }
}

function splitValues(
  option: PluginCliOption,
  values: readonly string[],
): string[] {
  const separator =
    option.type === "string" || option.type === "enum"
      ? option.split
      : undefined;
  if (separator === undefined) return [...values];
  return values.flatMap((value) =>
    value
      .split(separator)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

function buildOptionValues(
  spec: PluginCliSpec,
  path: string,
  command: PluginCliCommand,
  parsed: ParsedTokens,
): { values: Record<string, ErasedOptionValue>; missing: string[] } {
  const values: Record<string, ErasedOptionValue> = {};
  const missing: string[] = [];
  for (const [name, option] of Object.entries(command.options ?? {})) {
    if (option.type === "boolean") {
      values[name] = parsed.flags.has(name);
      continue;
    }
    const raw = splitValues(option, parsed.values.get(name) ?? []);
    if (raw.length === 0) {
      if (option.required === true) missing.push(`--${name}`);
      if (isRepeatable(option)) values[name] = [];
      else values[name] = option.default;
      continue;
    }
    try {
      if (isRepeatable(option)) {
        values[name] = raw.map((value) =>
          String(parseOptionValue(name, option, value)),
        );
        continue;
      }
      values[name] = parseOptionValue(name, option, raw[0] ?? "");
    } catch (error) {
      throw usageFailure(spec, path, command, {
        code: "invalid_value",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { values, missing };
}

function buildPositionalValues(
  spec: PluginCliSpec,
  path: string,
  command: PluginCliCommand,
  parsed: ParsedTokens,
): {
  values: Record<string, string | string[] | undefined>;
  missing: string[];
} {
  const values: Record<string, string | string[] | undefined> = {};
  const missing: string[] = [];
  const tokens = [...parsed.positionals];
  for (const positional of command.positionals ?? []) {
    if (positional.variadic === true) {
      const rest = tokens.splice(0, tokens.length);
      values[positional.name] = rest;
      if (positional.required === true && rest.length === 0) {
        missing.push(`<${positional.name}>`);
      }
      continue;
    }
    const token = tokens.shift();
    values[positional.name] = token;
    if (positional.required === true && token === undefined) {
      missing.push(`<${positional.name}>`);
    }
  }
  if (tokens.length > 0) {
    throw usageFailure(spec, path, command, {
      code: "unexpected_argument",
      message: `unexpected argument '${tokens[0]}'`,
      ...(command.unexpectedPositionalHint === undefined
        ? {}
        : { hint: command.unexpectedPositionalHint }),
    });
  }
  return { values, missing };
}

function isPresent(
  command: PluginCliCommand,
  parsed: ParsedTokens,
  name: string,
): boolean {
  if (command.options?.[name]?.type === "boolean")
    return parsed.flags.has(name);
  return (parsed.values.get(name) ?? []).length > 0;
}

function checkConstraints(
  spec: PluginCliSpec,
  path: string,
  command: PluginCliCommand,
  parsed: ParsedTokens,
): void {
  for (const constraint of command.constraints ?? []) {
    if (constraint.kind === "requires") {
      if (!isPresent(command, parsed, constraint.option)) continue;
      const absent = constraint.needs.filter(
        (need) => !isPresent(command, parsed, need),
      );
      if (absent.length === 0) continue;
      throw usageFailure(spec, path, command, {
        code: "missing_required",
        message: `--${constraint.option} requires ${absent
          .map((need) => `--${need}`)
          .join(", ")}`,
      });
    }
    const given = constraint.options.filter((name) =>
      isPresent(command, parsed, name),
    );
    const list = constraint.options.map((name) => `--${name}`).join(", ");
    if (given.length > 1 && constraint.kind !== "at-least-one") {
      throw usageFailure(spec, path, command, {
        code: "unexpected_argument",
        message: `${given.map((name) => `--${name}`).join(" and ")} cannot be combined`,
        hint: `${
          constraint.kind === "exactly-one"
            ? "Pass exactly one of"
            : "Pass at most one of"
        }: ${list}`,
      });
    }
    if (given.length === 0 && constraint.kind !== "at-most-one") {
      throw usageFailure(spec, path, command, {
        code: "missing_required",
        message: `missing required options: one of ${list}`,
      });
    }
  }
}

function renderErrorText(failure: UsageFailure): string {
  const blocks = [
    failure.hint === undefined
      ? failure.message
      : `${failure.message} (${failure.hint})`,
  ];
  if (failure.detail !== undefined) blocks.push(failure.detail);
  if (failure.usage !== undefined) blocks.push(failure.usage);
  return `${blocks.join("\n\n")}\n`;
}

function renderErrorJson(failure: UsageFailure): string {
  const hint = failure.hint ?? failure.usage?.replace(/^Usage:\n {2}/, "");
  return `${JSON.stringify(
    {
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        ...(hint === undefined ? {} : { hint }),
      },
    },
    null,
    2,
  )}\n`;
}

function wantsJsonOutput(argv: readonly string[]): boolean {
  const terminator = argv.indexOf("--");
  const scanned = terminator === -1 ? argv : argv.slice(0, terminator);
  return scanned.includes("--json");
}

function failureResult(
  failure: UsageFailure,
  wantsJson: boolean,
): PluginCliResult {
  const stderr = renderErrorText(failure);
  if (!wantsJson) return { exitCode: failure.exitCode, stderr };
  return {
    exitCode: failure.exitCode,
    stdout: renderErrorJson(failure),
    stderr,
  };
}

/**
 * Turns a declarative spec into a `PluginCliRegistration`, so every plugin
 * CLI parses argv, renders `--help`, and fails the same way.
 *
 * `--help`, `-h` and a leading `help` word exit 0 at any level and never run
 * a command. Unknown commands and options suggest the nearest declared name,
 * every missing required value is reported in one error, and an invocation
 * carrying `--json` adds the `{ ok: false, error: { code, message, hint? } }`
 * envelope on stdout while stderr keeps the human-readable text.
 */
export function defineCli(spec: PluginCliSpec): PluginCliRegistration {
  const commands: PluginCliCommandInfo[] = visibleCommands(spec).map(
    ([path, command]) => ({
      name: path.replaceAll(" ", "-"),
      summary: command.summary,
      usage: usageLine(spec.name, path, command),
    }),
  );

  return {
    name: spec.name,
    summary: spec.summary,
    commands,
    rendersHelp: true,
    async run(argv, ctx): Promise<PluginCliResult> {
      const wantsJson = wantsJsonOutput(argv);
      const asked = argv[0] === "help" ? argv.slice(1) : argv;
      const terminator = asked.indexOf("--");
      const scanned = terminator === -1 ? asked : asked.slice(0, terminator);
      const helpRequested =
        argv[0] === "help" ||
        scanned.some((token) => token === "--help" || token === "-h");
      try {
        const words = leadingWords(scanned);
        const resolved = resolveCommand(spec, words);
        if (helpRequested) {
          if (resolved === null && words.length > 0) {
            throw unknownCommandError(spec, words);
          }
          return { exitCode: 0, stdout: renderHelp(spec, resolved) };
        }
        if (resolved === null) {
          const root = spec.root;
          if (root === undefined || (words.length > 0 && !root.positionals)) {
            if (words.length > 0) {
              throw unknownCommandError(spec, words);
            }
            const failure: UsageFailure = {
              code: "missing_command",
              message: "missing command",
              hint: `Run \`bb ${spec.name} --help\` for the command list.`,
              exitCode: spec.usageErrorExitCode ?? 1,
            };
            if (!wantsJson) {
              return {
                exitCode: failure.exitCode,
                stdout: renderTopLevelHelp(spec),
              };
            }
            return {
              exitCode: failure.exitCode,
              stdout: renderErrorJson(failure),
              stderr: renderTopLevelHelp(spec),
            };
          }
        }
        const path = resolved?.path ?? "";
        const command = resolved?.command ?? spec.root;
        if (command === undefined) {
          throw unknownCommandError(spec, words);
        }
        const tail = asked.slice(resolved?.words ?? 0);
        const parsed = tokenize(spec, path, command, tail);
        const options = buildOptionValues(spec, path, command, parsed);
        const positionals = buildPositionalValues(spec, path, command, parsed);
        const missing = [
          ...(positionals.missing.length > 0
            ? [`missing required arguments: ${positionals.missing.join(", ")}`]
            : []),
          ...(options.missing.length > 0
            ? [`missing required options: ${options.missing.join(", ")}`]
            : []),
        ];
        if (missing.length > 0) {
          throw usageFailure(spec, path, command, {
            code: "missing_required",
            message: missing.join("; "),
          });
        }
        checkConstraints(spec, path, command, parsed);
        return await command.run(
          {
            options: options.values,
            positionals: positionals.values,
            passthrough: parsed.passthrough,
            help: renderHelp(spec, resolved),
          },
          ctx,
        );
      } catch (error) {
        if (error instanceof UsageError) {
          return failureResult(error.failure, wantsJson);
        }
        if (error instanceof PluginCliError) {
          return failureResult(
            {
              code: error.code,
              message: error.message,
              ...(error.hint === undefined ? {} : { hint: error.hint }),
              exitCode: error.exitCode,
            },
            wantsJson,
          );
        }
        throw error;
      }
    },
  };
}
