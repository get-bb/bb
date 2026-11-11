export type CliValueType =
  | "string"
  | "boolean"
  | "integer"
  | "number"
  | "strings";
export type CliContextField = "threadId" | "projectId" | "cwd";

declare const VALUE: unique symbol;

export interface CliContextFill {
  readonly field: string;
  readonly from: CliContextField;
}

export interface CliFlag<Value = unknown> {
  readonly flag: string;
  readonly type: CliValueType;
  readonly description: string;
  readonly placeholder?: string;
  readonly short?: string;
  readonly required?: boolean;
  readonly default?: string | number | readonly string[];
  readonly hidden?: boolean;
  readonly negatable?: boolean;
  readonly field?: string;
  readonly context?: CliContextFill;
  readonly [VALUE]?: { readonly value: Value };
}

export interface CliArg<Value = unknown> {
  readonly name: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly description?: string;
  readonly field?: string;
  readonly [VALUE]?: { readonly value: Value };
}

export interface CliFlagExtras {
  readonly type?: "integer" | "number" | "strings";
  readonly field?: string;
  readonly required?: boolean;
  readonly default?: string | number | readonly string[];
  readonly hidden?: boolean;
  readonly context?: CliContextFill;
}

type Present<Value, Extras> = Extras extends { required: true }
  ? Value
  : Extras extends { default: unknown }
    ? Value
    : Value | undefined;

export type CliFlagValue<
  Spec extends string,
  Extras,
> = Spec extends `${string} <${string}>`
  ? Extras extends { type: "strings" }
    ? string[]
    : Extras extends { type: "integer" | "number" }
      ? Present<number, Extras>
      : Present<string, Extras>
  : boolean;

export type CliArgValue<Spec extends string> = Spec extends
  | `<${string}...>`
  | `[${string}...]`
  ? string[]
  : Spec extends `<${string}>`
    ? string
    : string | undefined;

export type CliFlags = { readonly [key: string]: CliFlag };
export type CliArgs = { readonly [key: string]: CliArg };

type ValueOf<Declared> = Declared extends {
  readonly [VALUE]?: { readonly value: infer Value };
}
  ? Value
  : never;

export interface CliValues<
  Args extends CliArgs = CliArgs,
  Flags extends CliFlags = CliFlags,
> {
  readonly positionals: { readonly [Key in keyof Args]: ValueOf<Args[Key]> };
  readonly options: { readonly [Key in keyof Flags]: ValueOf<Flags[Key]> };
}

const FLAG_SPEC =
  /^(?:-(?<short>[A-Za-z]), )?--(?<negated>no-)?(?<flag>[a-z][a-z0-9-]*)(?: <(?<placeholder>[^>]+)>)?$/;

export function flag<
  const Spec extends string,
  const Extras extends CliFlagExtras = {},
>(
  spec: Spec,
  description: string,
  extras?: Extras,
): CliFlag<CliFlagValue<Spec, Extras>> {
  const match = FLAG_SPEC.exec(spec)?.groups;
  if (match?.flag === undefined) {
    throw new Error(`Unrecognized flag syntax: ${spec}`);
  }
  const { type, ...rest } = extras ?? {};
  const placeholder = match.placeholder;
  if (placeholder === undefined && type !== undefined) {
    throw new Error(`--${match.flag} takes a value, so it needs <value>`);
  }
  return {
    flag: match.flag,
    type: placeholder === undefined ? "boolean" : (type ?? "string"),
    description,
    ...(placeholder === undefined || placeholder === match.flag
      ? {}
      : { placeholder }),
    ...(match.short === undefined ? {} : { short: match.short }),
    ...(match.negated === undefined ? {} : { negatable: true }),
    ...rest,
  };
}

const ARG_SPEC =
  /^(?:<(?<required>[^>.]+)(?<rv>\.\.\.)?>|\[(?<optional>[^\].]+)(?<ov>\.\.\.)?\])$/;

export function arg<const Spec extends string>(
  spec: Spec,
  description?: string,
  extras: { readonly field?: string } = {},
): CliArg<CliArgValue<Spec>> {
  const match = ARG_SPEC.exec(spec)?.groups;
  const name = match?.required ?? match?.optional;
  if (match === undefined || name === undefined) {
    throw new Error(`Unrecognized argument syntax: ${spec}`);
  }
  return {
    name,
    required: match.required !== undefined,
    variadic: match.rv !== undefined || match.ov !== undefined,
    ...(description === undefined ? {} : { description }),
    ...extras,
  };
}

export interface CliDoorDeclined {
  message?: string;
  exitCode?: number;
  refusal?: string;
}

export type CliDoorPrinted = string | readonly string[] | null;

export interface CliDoorCommon<Args, Flags, Input, Output> {
  path: readonly string[];
  summary: string;
  description?: string;
  aliases?: readonly string[];
  hidden?: boolean;
  isDefault?: boolean;
  usage?: string;
  helpAfter?: string;
  positionals?: Args;
  options?: Flags;
  noJson?: boolean;
  interrupt?: string;
  confirm?(input: Input): string | null;
  declined?(input: Input): CliDoorDeclined;
  json?(output: Output, input: Input): unknown;
  print?(output: Output, input: Input): CliDoorPrinted;
  failure?(input: Input): string;
  exitCode?(output: Output, input: Input, json: boolean): number;
}

export const JSON_FLAG_DESCRIPTION = "Print machine-readable JSON output";
export const YES_FLAG_DESCRIPTION = "Skip the confirmation prompt";

export class CliDoorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliDoorUsageError";
  }
}

export interface MountedFlag extends CliFlag {
  readonly key: string;
}

export interface MountedArg extends CliArg {
  readonly key: string;
}

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

const reservedFlag = (key: string, description: string): MountedFlag => ({
  key,
  flag: key,
  type: "boolean",
  description,
});

export interface MountedFlags {
  flags: MountedFlag[];
  hasJson: boolean;
  hasYes: boolean;
}

export function mountedFlags(
  declared: CliFlags,
  { json, confirm }: { json: boolean; confirm: boolean },
): MountedFlags {
  const flags = Object.entries(declared).map(([key, value]) => ({
    ...value,
    key,
  }));
  for (const reserved of ["json", "yes"]) {
    const found = flags.find((entry) => entry.flag === reserved);
    if (found !== undefined && found.type !== "boolean") {
      throw new Error(`--${reserved} must be declared as a boolean flag`);
    }
  }
  const hasYes = confirm || flags.some((entry) => entry.flag === "yes");
  if (hasYes && !flags.some((entry) => entry.flag === "yes")) {
    flags.push(reservedFlag("yes", YES_FLAG_DESCRIPTION));
  }
  if (json && !flags.some((entry) => entry.flag === "json")) {
    flags.push(reservedFlag("json", JSON_FLAG_DESCRIPTION));
  }
  return { flags, hasJson: json, hasYes };
}

export function mountedArgs(declared: CliArgs): MountedArg[] {
  return Object.entries(declared).map(([key, value]) => ({ ...value, key }));
}

export function commanderFlagName(entry: CliFlag): string {
  return camelCase(entry.flag);
}

export function flagValue(entry: CliFlag, raw: unknown): unknown {
  if (entry.type === "boolean") {
    return entry.negatable === true ? raw !== false : raw === true;
  }
  if (entry.type === "strings") {
    if (Array.isArray(raw)) return raw;
    return typeof raw === "string" ? [raw] : [];
  }
  if (raw === undefined) return undefined;
  if (entry.type === "string") return String(raw);
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (entry.type === "number") {
    if (!Number.isFinite(parsed)) {
      throw new CliDoorUsageError(`--${entry.flag} must be a number`);
    }
    return parsed;
  }
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliDoorUsageError(`--${entry.flag} must be a positive integer`);
  }
  return parsed;
}

function assign(
  target: Record<string, unknown>,
  field: string,
  value: unknown,
): void {
  const keys = field.split(".");
  const last = keys.pop();
  if (last === undefined) return;
  let cursor = target;
  for (const key of keys) {
    const existing = cursor[key];
    if (typeof existing === "object" && existing !== null) {
      cursor = existing as Record<string, unknown>;
      continue;
    }
    const created: Record<string, unknown> = {};
    cursor[key] = created;
    cursor = created;
  }
  cursor[last] = value;
}

export interface ContextResolver {
  (
    field: CliContextField,
    explicit: string | undefined,
    requested: boolean,
  ): string;
}

export interface InputMapping {
  fixed: Readonly<Record<string, unknown>>;
  args: readonly MountedArg[];
  flags: readonly MountedFlag[];
}

export function mappedFields(mapping: InputMapping): string[] {
  const fields: string[] = [];
  for (const entry of mapping.args) fields.push(entry.field ?? entry.key);
  for (const entry of mapping.flags) {
    if (entry.flag === "json" || entry.flag === "yes") continue;
    fields.push(entry.context?.field ?? entry.field ?? entry.key);
  }
  return fields.map((field) => field.split(".")[0] ?? field);
}

export function mapInput(
  mapping: InputMapping,
  values: CliValues,
  resolveContext: ContextResolver,
): Record<string, unknown> {
  const input = structuredClone({ ...mapping.fixed });
  const filled = new Set(
    mapping.flags.flatMap((entry) =>
      entry.context === undefined ? [] : [entry.context.field],
    ),
  );
  for (const entry of mapping.args) {
    const field = entry.field ?? entry.key;
    if (filled.has(field)) continue;
    const value = values.positionals[entry.key];
    if (value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    assign(input, field, value);
  }
  for (const entry of mapping.flags) {
    if (entry.flag === "json" || entry.flag === "yes") continue;
    const value = values.options[entry.key];
    if (entry.context !== undefined) {
      const { field, from } = entry.context;
      const named = mapping.args.find(
        (candidate) => (candidate.field ?? candidate.key) === field,
      );
      const given =
        named === undefined ? undefined : values.positionals[named.key];
      assign(
        input,
        field,
        resolveContext(
          from,
          typeof given === "string" ? given : undefined,
          value === true,
        ),
      );
      continue;
    }
    if (value === undefined || value === "") continue;
    if (value === false && entry.negatable !== true) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    assign(input, entry.field ?? entry.key, value);
  }
  return input;
}
