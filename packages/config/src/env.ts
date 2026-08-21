import { homedir } from "node:os";
import { resolveRuntimeMode, type BbRuntimeMode } from "./runtime.js";

interface EnvReaderContext {
  homeDir: string;
}

export interface EnvVarParseArgs {
  context: EnvReaderContext;
  name: string;
  value: string;
}

export interface EnvVarDefinition<TValue> {
  description: string;
  name: string;
  parse(args: EnvVarParseArgs): TValue;
}

export interface EnvLoaderArgs {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  mode?: BbRuntimeMode;
}

interface ResolvedEnvLoader {
  context: EnvReaderContext;
  env: NodeJS.ProcessEnv;
  mode: BbRuntimeMode;
}

interface ReadEnvVarArgs<TValue> {
  context: EnvReaderContext;
  definition: EnvVarDefinition<TValue>;
  env: NodeJS.ProcessEnv;
}

interface ReadEnvVarWithDefaultArgs<TValue> extends ReadEnvVarArgs<TValue> {
  defaultValue: TValue;
}

export function defineEnvVar<TValue>(
  definition: EnvVarDefinition<TValue>,
): EnvVarDefinition<TValue> {
  return definition;
}

export function resolveEnvLoader(args: EnvLoaderArgs = {}): ResolvedEnvLoader {
  const env = args.env ?? process.env;
  return {
    context: {
      homeDir: args.homeDir ?? homedir(),
    },
    env,
    mode: args.mode ?? resolveRuntimeMode(env.NODE_ENV),
  };
}

export function readRequiredEnvVar<TValue>(
  args: ReadEnvVarArgs<TValue>,
): TValue {
  const rawValue = args.env[args.definition.name];
  if (rawValue === undefined) {
    throw new Error(`${args.definition.name} is required`);
  }

  return args.definition.parse({
    context: args.context,
    name: args.definition.name,
    value: rawValue,
  });
}

export function readOptionalEnvVar<TValue>(
  args: ReadEnvVarArgs<TValue>,
): TValue | undefined {
  const rawValue = args.env[args.definition.name];
  if (rawValue === undefined) {
    return undefined;
  }

  return args.definition.parse({
    context: args.context,
    name: args.definition.name,
    value: rawValue,
  });
}

export function readEnvVarWithDefault<TValue>(
  args: ReadEnvVarWithDefaultArgs<TValue>,
): TValue {
  const rawValue = args.env[args.definition.name];
  if (rawValue === undefined) {
    return args.defaultValue;
  }

  return args.definition.parse({
    context: args.context,
    name: args.definition.name,
    value: rawValue,
  });
}
