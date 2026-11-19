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

/**
 * The context shape a provider is written against. Version 1 contexts carry
 * the `thread` that drives the operation and cannot create an environment
 * before a thread exists. Version 2 contexts carry the `environment` being
 * created instead, so core can also create environments without a thread.
 */
export type PluginEnvironmentProviderApiVersion = 1 | 2;

/** The environment a version-2 create or restore produces a workspace for. */
export interface PluginEnvironmentProviderEnvironment {
  id: string;
  name: string | null;
  projectId: string;
}

export interface PluginEnvironmentProviderClaimPathOptions {
  /**
   * Also refuse while a live thread other than the one this operation serves
   * uses an environment at the path: the claim then rejects with "Cannot
   * checkout branch while another thread is using this workspace". Use it
   * before changing what the path has checked out.
   */
  exclusive: boolean;
}

interface PluginEnvironmentProviderOperationContext<
  R extends PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema,
> extends PluginEnvironmentProviderValidateContext<R, S> {
  attempt: number;
  pathKey: string;
  experimental_claimPath(
    path: string,
    options?: PluginEnvironmentProviderClaimPathOptions,
  ): Promise<boolean>;
  report: PluginEnvironmentProviderProgress;
  signal: AbortSignal;
}

interface PluginEnvironmentProviderSubjects {
  1: { thread: ThreadResponse };
  2: { environment: PluginEnvironmentProviderEnvironment };
}

type PluginEnvironmentProviderSubject<
  V extends PluginEnvironmentProviderApiVersion,
> = PluginEnvironmentProviderSubjects[V];

export type PluginEnvironmentProviderCreateContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
  V extends PluginEnvironmentProviderApiVersion = 1,
> = PluginEnvironmentProviderOperationContext<R, S> &
  PluginEnvironmentProviderSubject<V> & {
    /** `<prefix><slug>-<id>` from the thread title and id, or from the environment name and id; `<prefix><id>` without one. */
    suggestedBranchName: string;
  };

/** Rebuilds a thread's destroyed environment; `inputs` are the ones it was created with. */
export type PluginEnvironmentProviderRestoreContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
  V extends PluginEnvironmentProviderApiVersion = 1,
> = PluginEnvironmentProviderOperationContext<R, S> &
  PluginEnvironmentProviderSubject<V> & {
    /** Resource is private to this provider; null after completed removal. */
    previous: { environment: Environment; resource: JsonValue | null };
  };

export type PluginEnvironmentProviderCreateResult =
  | {
      status: "created";
      path: string;
      ownsPath: boolean;
      /** Ref the workspace's changes are compared against. Null clears the value recorded on a reused environment; omit to keep it. */
      mergeBaseBranch?: string | null;
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

interface PluginEnvironmentProviderPathKeys {
  1: "per-thread";
  2: "per-environment";
}

/** Core normalizes omitted policy members once at registration. */
export interface PluginEnvironmentProviderPolicy<
  V extends PluginEnvironmentProviderApiVersion = 1,
> {
  /** Default five minutes; null keeps the environment indefinitely. */
  retireGraceMs: number | null;
  /**
   * Version 1 defaults to per-thread and version 2 to per-environment: one
   * key for the environment's workspace, stable across retries. Core derives
   * it from the driving thread when there is one and from the environment
   * otherwise, so thread workspaces keep their names. Replacement
   * environments use a fresh key to avoid dead paths.
   */
  pathKeys: PluginEnvironmentProviderPathKeys[V] | "per-attempt";
}

interface PluginEnvironmentProviderDefinitionShape<
  R extends PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema,
  V extends PluginEnvironmentProviderApiVersion,
> {
  /**
   * The context shape `create` and `restore` receive. Omitted means 1. Bumps
   * only for breaking context changes; additive fields keep the version.
   */
  apiVersion?: V;
  id: string;
  displayName: string;
  /** Short explanation shown in environment choices. */
  description: string;
  /** Host glyph, plugin-relative icon path, or this plugin’s declared namespaced icon. */
  icon: string;
  requires?: R;
  inputs?: S;
  policy?: Partial<PluginEnvironmentProviderPolicy<V>>;
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
    context: PluginEnvironmentProviderCreateContext<R, S, V>,
  ): Promise<PluginEnvironmentProviderCreateResult>;
  /** Experimental: rebuild a destroyed environment when a thread asks for it back. Without it, core never rebuilds this provider's destroyed environments: see docs/api_to_audit.md. */
  restore?(
    context: PluginEnvironmentProviderRestoreContext<R, S, V>,
  ): Promise<PluginEnvironmentProviderCreateResult>;
  remove(
    context: PluginEnvironmentProviderRemoveContext,
  ): Promise<PluginEnvironmentProviderRemoveResult>;
}

/**
 * Resource operations only. Core owns durable launches, retries and
 * retirement. Version 2 (`apiVersion: 2`) contexts carry the `environment`
 * instead of a thread, so core can create environments before any thread
 * exists; version 1 providers are refused there.
 */
export type PluginEnvironmentProviderDefinition<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
  V extends PluginEnvironmentProviderApiVersion = 1,
> = PluginEnvironmentProviderDefinitionShape<R, S, V> &
  PluginEnvironmentProviderVersionMarkers[V];

interface PluginEnvironmentProviderVersionMarkers {
  1: { apiVersion?: 1 };
  2: { apiVersion: 2 };
}
