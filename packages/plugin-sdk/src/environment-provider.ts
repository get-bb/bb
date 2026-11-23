import type { Environment, Host, Project } from "@bb/domain";
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
/** `ownsPath`: bb cloned this checkout, so a provider may own work there. */
interface ProjectCheckout {
  path: string;
  ownsPath: boolean;
}
type Checkout<R> = R extends { projectCheckout: true } | { gitCheckout: true }
  ? ProjectCheckout
  : ProjectCheckout | null;
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

export interface PluginEnvironmentProviderLocation {
  path: string;
  reuse: boolean;
}

export interface PluginEnvironmentProviderLocateContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> {
  host: Host;
  projectCheckout: Checkout<R>;
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

/** The environment a create or restore produces a workspace for. */
export interface PluginEnvironmentProviderEnvironment {
  id: string;
  name: string | null;
  projectId: string;
}

/** Core's create steps, which a provider calls in the order it needs. */
export interface PluginEnvironmentProviderSteps {
  /**
   * The name for a branch this operation makes. A thread's environment
   * resolves to `<prefix><slug(title)>-<threadId>` once the thread's title
   * settles (generated, provided, or the fallback); a thread-less one resolves
   * at once to `<prefix><slug(name)>-<id>`, or `<prefix><id>` without a name.
   * Core generates the title while create runs, so await it as late as
   * possible. Repeated calls return the same name.
   */
  branchName(): Promise<string>;
  /**
   * Claims `path` as this environment's provider-owned workspace and asks core
   * to run setup there; resolves once the request is recorded, while setup
   * runs alongside the rest of create. The environment becomes ready only
   * after create returns `created` with the same path and `ownsPath: true`.
   * Without a call, core runs setup after create returns.
   */
  setup(path: string): Promise<void>;
  /**
   * Hands this operation a ready environment this plugin holds, at once and
   * atomically: the environment becomes the one this create produces, keeps
   * its setup, and takes `resource`, which `remove()` receives if create never
   * returns. The hold is cleared when create returns. Rejects when the
   * environment is not a ready one this plugin holds on the same project and
   * machine; then nothing changed. Setup does not run again unless
   * `setup(path)` is called afterwards with the adopted path, which starts it
   * at once. A `created` result must name its path; any other outcome leaves
   * the environment in error, and its thread fails. If bb restarts before
   * create returns, the environment is removed and the thread is provisioned
   * again.
   */
  adopt(environmentId: string, resource: JsonValue): Promise<void>;
}

export interface PluginEnvironmentProviderCreateContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
>
  extends
    PluginEnvironmentProviderValidateContext<R, S>,
    PluginEnvironmentProviderSteps {
  environment: PluginEnvironmentProviderEnvironment;
  attempt: number;
  pathKey: string;
  report: PluginEnvironmentProviderProgress;
  signal: AbortSignal;
}

/** Rebuilds a thread's destroyed environment; `inputs` are the ones it was created with. */
export interface PluginEnvironmentProviderRestoreContext<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> extends PluginEnvironmentProviderCreateContext<R, S> {
  /** Resource is private to this provider; null after completed removal. */
  previous: { environment: Environment; resource: JsonValue | null };
}

export type PluginEnvironmentProviderCreateResult =
  | {
      status: "created";
      path: string;
      ownsPath: boolean;
      /** Ref the workspace's changes are compared against. Null clears the value recorded on a reused environment; omit to keep it. */
      mergeBaseBranch?: string | null;
      /**
       * Experimental: absolute paths of this environment's own extra folders,
       * such as sibling checkouts it created next to `path`. Threads in the
       * environment can read and write them. Core records them with the
       * environment; omit on a reused environment to keep the recorded list.
       * See docs/api_to_audit.md.
       */
      additionalPaths?: string[];
      /**
       * Experimental: the project's folders (`sdk.projects.sources.experimental_folders`)
       * this environment replaces, such as a folder it made a worktree of in
       * `additionalPaths`. Threads in the environment no longer get those
       * shared folders. Omit on a reused environment to keep the recorded
       * list. See docs/api_to_audit.md.
       */
      replacedProjectFolders?: string[];
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
  /**
   * Default per-environment: one key for the environment's workspace, stable
   * across retries. Core derives it from the driving thread when there is one
   * and from the environment otherwise, so thread workspaces keep their
   * names. Replacement environments use a fresh key to avoid dead paths.
   */
  pathKeys: "per-environment" | "per-attempt";
}

/**
 * Resource operations only. Core owns durable launches, retries and
 * retirement. Contexts carry the `environment` being created rather than a
 * thread, so core can also create environments before any thread exists.
 */
export interface PluginEnvironmentProviderDefinition<
  R extends PluginEnvironmentProviderRequirements =
    PluginEnvironmentProviderRequirements,
  S extends PluginEnvironmentProviderInputsSchema =
    PluginEnvironmentProviderInputsSchema,
> {
  /**
   * The context shape `create` and `restore` receive. Required: bb still runs
   * providers built before it with the earlier, thread-based contexts.
   */
  apiVersion: 2;
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
  /**
   * Where an environment for these inputs lives, if the provider knows before
   * creating anything; null asks for a new environment. Core claims the path
   * for the operation. With `reuse: true`, a thread joins the environment
   * recorded at `path` as it is. Otherwise create runs on a fresh
   * reservation, which core refuses while another live thread uses an
   * environment at `path`, and core folds the result into that environment
   * when create returns the same path.
   */
  locate?(
    context: PluginEnvironmentProviderLocateContext<R, S>,
  ):
    | PluginEnvironmentProviderLocation
    | null
    | Promise<PluginEnvironmentProviderLocation | null>;
  create(
    context: PluginEnvironmentProviderCreateContext<R, S>,
  ): Promise<PluginEnvironmentProviderCreateResult>;
  /** Experimental: rebuild a destroyed environment when a thread asks for it back. Without it, core never rebuilds this provider's destroyed environments: see docs/api_to_audit.md. */
  restore?(
    context: PluginEnvironmentProviderRestoreContext<R, S>,
  ): Promise<PluginEnvironmentProviderCreateResult>;
  remove(
    context: PluginEnvironmentProviderRemoveContext,
  ): Promise<PluginEnvironmentProviderRemoveResult>;
}
