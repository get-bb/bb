// The hardened sandbox: run a parsed workflow body (see `parseWorkflow` in meta-parser.ts) as a
// live async coroutine inside a node:vm context with code generation disabled (no eval/Function),
// dynamic import blocked, and Date.now/Math.random/new Date() shimmed to throw.
//
// This module is the only place in @bb/workflow-runtime that touches node:vm, and it runs only in
// the workflow-runner child process — never in the server or daemon (plan section 5). Everything
// validation needs (parseWorkflow, parseMeta, determinismLint) lives in vm-free modules exposed
// via the `@bb/workflow-runtime/validation` subpath, so the server's module graph never loads
// this file.

import { createContext, Script, type Context } from "node:vm";
import type { WorkflowGlobals } from "./dsl-types.js";
import { WorkflowSyntaxError } from "./meta-parser.js";

const DETERMINISM_PRELUDE = `
"use strict";
(function () {
  var RealDate = Date;
  var NOW_ERR = "Date.now()/new Date() are unavailable in workflows (breaks resume). Use now().";
  var RND_ERR = "Math.random() is unavailable in workflows (breaks resume). Use random().";
  Math.random = function random() { throw new Error(RND_ERR); };
  function ShimDate() {
    if (!(this instanceof ShimDate)) throw new Error(NOW_ERR);
    if (arguments.length === 0) throw new Error(NOW_ERR);
    return Reflect.construct(RealDate, Array.prototype.slice.call(arguments), ShimDate);
  }
  ShimDate.now = function () { throw new Error(NOW_ERR); };
  ShimDate.parse = RealDate.parse;
  ShimDate.UTC = RealDate.UTC;
  ShimDate.prototype = RealDate.prototype;
  // Close the (new Date(x)).constructor backdoor that would otherwise reach RealDate.now,
  // then freeze so the shims can't be reassigned. (Date/Math methods remain callable.)
  try { Object.defineProperty(RealDate.prototype, "constructor", { value: ShimDate, writable: false, configurable: false }); } catch (e) {}
  try { Object.freeze(RealDate); } catch (e) {}
  try { Object.freeze(Math); } catch (e) {}
  globalThis.Date = ShimDate;
  try { Object.freeze(globalThis.Date); } catch (e) {}
})();
`;

export interface RunInSandboxOptions {
  body: string;
  filename: string;
  globals: WorkflowGlobals;
  /** Bounds the synchronous portion (until the first await). Default 30s. */
  syncTimeoutMs?: number;
  /** Aborts the whole run (including after the first await) — e.g. cancel. */
  signal?: AbortSignal;
  /** Hard ceiling on total async execution. Default: unbounded (0). */
  execTimeoutMs?: number;
}

export class WorkflowAbortedError extends Error {
  constructor(message = "workflow aborted") {
    super(message);
    this.name = "WorkflowAbortedError";
  }
}

export class WorkflowTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowTimeoutError";
  }
}

/** Run the workflow body and resolve with its return value (unknowable: author-defined). */
export async function runInSandbox(
  opts: RunInSandboxOptions,
): Promise<unknown> {
  // An already-aborted signal must not execute even the synchronous portion of the workflow.
  if (opts.signal?.aborted) throw new WorkflowAbortedError();
  const sandbox = {
    agent: opts.globals.agent,
    parallel: opts.globals.parallel,
    pipeline: opts.globals.pipeline,
    phase: opts.globals.phase,
    log: opts.globals.log,
    now: opts.globals.now,
    random: opts.globals.random,
    budget: opts.globals.budget,
    args: opts.globals.args,
    console,
    setTimeout,
    clearTimeout,
  };
  const context: Context = createContext(sandbox, {
    name: opts.filename,
    codeGeneration: { strings: false, wasm: false },
  });

  // Determinism shims (Date/Math) before user code.
  new Script(DETERMINISM_PRELUDE, { filename: "prelude.js" }).runInContext(
    context,
  );

  // The prefix has NO newlines so the body keeps its original line numbers (parseWorkflow already
  // replaced the stripped meta region with blank lines). Workflow stack traces then point true.
  const wrapped = `(async () => { "use strict"; ${opts.body}\n})()`;
  let script: Script;
  try {
    script = new Script(wrapped, {
      filename: opts.filename,
      // Block dynamic import inside workflows.
      importModuleDynamically: () => {
        throw new Error("import() is not available in workflows");
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowSyntaxError(
      `${message}. Workflow files are plain JavaScript — no TypeScript syntax, no imports.`,
    );
  }

  // The vm `timeout` bounds ONLY synchronous execution (until the first await). Async hangs
  // (`await new Promise(() => {})`) would otherwise run forever, so race the workflow promise
  // against the abort signal and an optional execution-time ceiling.
  const promise: Promise<unknown> = script.runInContext(context, {
    timeout: opts.syncTimeoutMs ?? 30_000,
  });
  return await raceLifecycle(promise, opts.signal, opts.execTimeoutMs);
}

function raceLifecycle(
  work: Promise<unknown>,
  signal?: AbortSignal,
  execTimeoutMs?: number,
): Promise<unknown> {
  if (!signal && !execTimeoutMs) return work;
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = (): void =>
      finish(() => reject(new WorkflowAbortedError()));

    if (signal) {
      if (signal.aborted) {
        // The work promise keeps running (a vm can't be killed); consume its eventual
        // rejection so it never surfaces as an unhandledRejection crash.
        work.then(undefined, () => {});
        reject(new WorkflowAbortedError());
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    if (execTimeoutMs && execTimeoutMs > 0) {
      timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new WorkflowTimeoutError(`workflow exceeded ${execTimeoutMs}ms`),
            ),
          ),
        execTimeoutMs,
      );
      timer.unref();
    }
    work.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });
}
