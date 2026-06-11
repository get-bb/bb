// Ambient declarations for bb workflow authors: editor types for the globals
// injected into a *.workflow.js file (the file runs in a sandbox with no
// imports). Reference it from a workflow file with a triple-slash path
// reference, or ship it beside authored workflows (the bb-workflows skill
// distributes it).
//
// This file is SELF-CONTAINED on purpose: it must not import anything, and it
// deliberately sits outside the package's tsconfig include so these globals
// never leak into @bb/workflow-runtime's own compilation. The unions below are
// inlined copies of the ones in src/dsl-types.ts (WorkflowGlobals et al.);
// keep them in sync — a package test asserts the declared names, that the file
// parses, and that each union's members match the source enums exactly.

declare global {
  type WorkflowProviderId = "codex" | "claude-code" | "pi";

  type WorkflowSandbox = "read-only" | "workspace-write" | "danger-full-access";

  type WorkflowEffort =
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "ultracode"
    | "max";

  /** A plain JSON Schema object for `agent({ schema })` structured output. */
  type WorkflowJSONSchema = Record<string, unknown>;

  /** A JSON value — what agent() resolves to and what `args` carries. */
  type WorkflowJsonValue =
    | string
    | number
    | boolean
    | null
    | WorkflowJsonValue[]
    | { [key: string]: WorkflowJsonValue };

  /** Options an author passes to `agent()`. All optional; omitted fields inherit the run defaults. */
  interface WorkflowAgentOpts {
    provider?: WorkflowProviderId;
    label?: string;
    phase?: string;
    model?: string;
    effort?: WorkflowEffort;
    cwd?: string;
    sandbox?: WorkflowSandbox;
    instructions?: string;
    schema?: WorkflowJSONSchema;
    /** Run in an isolated git worktree (the branch name is runtime-derived). */
    worktree?: boolean;
    /** Pin a stable resume cache key; otherwise the chained key is used. */
    key?: string;
  }

  type WorkflowPipelineStage = (
    prev: unknown,
    item: unknown,
    index: number,
  ) => unknown | Promise<unknown>;

  /**
   * Run one agent turn (provider per opts.provider, else the run default).
   * Resolves to the final text, or the validated value when opts.schema is set.
   */
  function agent(
    prompt: string,
    opts?: WorkflowAgentOpts,
  ): Promise<WorkflowJsonValue>;

  /**
   * Run thunks concurrently (under the cap) and await all. Wrap each call:
   * () => agent(...). A failed branch degrades to null.
   */
  function parallel<T>(
    thunks: ReadonlyArray<() => Promise<T>>,
  ): Promise<Array<T | null>>;

  /** Stream each item through all stages independently (no barrier). Stages get (prev, item, i). */
  function pipeline(
    items: unknown[],
    ...stages: WorkflowPipelineStage[]
  ): Promise<unknown[]>;

  /** Open a named progress group; subsequent agent() calls render under it. */
  function phase(title: string): void;

  /** Emit a narrator line to the run's progress feed. */
  function log(msg: string): void;

  /** Journal-seeded clock (use instead of Date.now(), which throws). */
  function now(): number;

  /** Journal-seeded RNG (use instead of Math.random(), which throws). */
  function random(): number;

  /** Output-token budget for the run (`total` is null when unbounded). */
  const budget: {
    total: number | null;
    spent(): number;
    remaining(): number;
  };

  /** The launch-time args (parsed JSON); undefined when launched without args. */
  const args: WorkflowJsonValue | undefined;
}

export {};
