import type { Environment, Host, Project } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import type {
  JsonValue,
  PluginEnvironmentProviderRequirements,
  PluginEnvironmentValidateDecision,
  StandardSchemaV1,
  StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";

export type PluginEnvironmentProviderInputsSchema =
  | StandardSchemaV1
  | undefined;
type Fact<R, K extends PropertyKey, T> =
  R extends Record<K, true> ? T : T | null;
type Checkout<R> = R extends { projectCheckout: true } | { gitCheckout: true }
  ? { path: string; experimental_ownsPath: boolean }
  : { path: string; experimental_ownsPath: boolean } | null;
type InputsValue<S> = S extends StandardSchemaV1
  ? StandardSchemaV1InferOutput<S>
  : null;

/** Attempt-scoped updates; core persists each update before this call returns. */
export interface PluginEnvironmentProviderProgress {
  step(text: string): void;
  log(text: string): void;
}

export interface PluginEnvironmentProviderValidateContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> {
  project: Project;
  host: Host;
  projectCheckout: Checkout<R>;
  gitRemote: Fact<R, "gitRemote", string>;
  inputs: InputsValue<S>;
}

export interface PluginEnvironmentProviderAvailabilityContext {
  project: Project;
  host: Host;
  projectCheckout: { path: string } | null;
  gitRemote: string | null;
}

export type PluginEnvironmentProviderAvailability =
  | { status: "available" }
  | { status: "setup-required"; message: string }
  | { status: "unavailable"; message: string };

export interface PluginEnvironmentProviderCreateContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> extends PluginEnvironmentProviderValidateContext<R, S> {
  thread: ThreadResponse;
  suggestedBranchName: string;
  attempt: number;
  pathKey: string;
  experimental_claimPath(path: string): Promise<boolean>;
  report: PluginEnvironmentProviderProgress;
  signal: AbortSignal;
}

/** Rebuilds a thread's destroyed environment; `inputs` are the ones it was created with. */
export interface PluginEnvironmentProviderRestoreContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> extends PluginEnvironmentProviderValidateContext<R, S> {
  thread: ThreadResponse;
  attempt: number;
  pathKey: string;
  experimental_claimPath(path: string): Promise<boolean>;
  /** Resource is private to this provider; null after completed removal. */
  previous: { environment: Environment; resource: JsonValue | null };
  report: PluginEnvironmentProviderProgress;
  signal: AbortSignal;
}

export type PluginEnvironmentProviderCreateResult =
  | {
      status: "created";
      path: string;
      ownsPath: boolean;
      mergeBaseBranch?: string;
      resource?: JsonValue;
    }
  | { status: "failed"; message: string };

export interface PluginEnvironmentProviderRemoveContext {
  environment: Environment | null;
  hostId: string | null;
  path: string | null;
  pathKey: string;
  resource: JsonValue | null;
  attempt: number;
  report: PluginEnvironmentProviderProgress;
  signal: AbortSignal;
}

export type PluginEnvironmentProviderRemoveResult =
  | { status: "removed" }
  | { status: "failed"; message: string };

/** Core normalizes omitted policy members once at registration. */
export interface PluginEnvironmentProviderPolicy {
  /** Default five minutes; null keeps the environment indefinitely. */
  retireGraceMs: number | null;
  /** Default per-thread; replacement environments use a fresh key to avoid dead paths. */
  pathKeys: "per-thread" | "per-attempt";
}

/** Resource operations only. Core owns durable launches, retries and retirement. */
export interface PluginEnvironmentProviderDefinition<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> {
  id: string;
  displayName: string;
  /** Short explanation shown in environment choices. */
  description: string;
  /** Host glyph, plugin-relative icon path, or this plugin’s declared namespaced icon. */
  icon: string;
  requires?: R;
  inputs?: S;
  policy?: Partial<PluginEnvironmentProviderPolicy>;
  /** Experimental per-machine availability, probed in the background for pickers and again at thread creation: see docs/api_to_audit.md. */
  availability?(
    context: PluginEnvironmentProviderAvailabilityContext,
  ):
    | PluginEnvironmentProviderAvailability
    | Promise<PluginEnvironmentProviderAvailability>;
  validate?(
    context: PluginEnvironmentProviderValidateContext<R, S>,
  ):
    | PluginEnvironmentValidateDecision
    | Promise<PluginEnvironmentValidateDecision>;
  /** Pure path selection from parsed inputs. Core reuses a recorded environment on the selected host before calling create; null requests normal creation. */
  experimental_existingPath?(inputs: InputsValue<S>): string | null;
  create(
    context: PluginEnvironmentProviderCreateContext<R, S>,
  ): Promise<PluginEnvironmentProviderCreateResult>;
  /** Experimental: rebuild a destroyed environment when its thread asks for it back. Without it, core never rebuilds this provider's destroyed environments: see docs/api_to_audit.md. */
  restore?(
    context: PluginEnvironmentProviderRestoreContext<R, S>,
  ): Promise<PluginEnvironmentProviderCreateResult>;
  remove(
    context: PluginEnvironmentProviderRemoveContext,
  ): Promise<PluginEnvironmentProviderRemoveResult>;
}
