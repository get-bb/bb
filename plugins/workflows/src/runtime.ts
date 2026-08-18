import SINGLEFILE_RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
} from "quickjs-emscripten-core";
import { assertJsonValue } from "./json-value.js";
import type {
  ExecuteWorkflowScriptArgs,
  JsonValue,
  WorkflowAgentOptions,
  WorkflowBudgetSnapshot,
  WorkflowExecutionScheduler,
  WorkflowReference,
  WorkflowRuntimeLimits,
} from "./types.js";
import { parseAgentOptions } from "./validation.js";

const DEFAULT_LIMITS: WorkflowRuntimeLimits = {
  memoryLimitBytes: 32 * 1024 * 1024,
  maxStackBytes: 512 * 1024,
  synchronousDeadlineMs: 1_000,
  maxAgentCalls: 100,
  maxConcurrentAgents: 8,
};

const LIMIT_MAXIMUMS: WorkflowRuntimeLimits = {
  memoryLimitBytes: 128 * 1024 * 1024,
  maxStackBytes: 8 * 1024 * 1024,
  synchronousDeadlineMs: 10_000,
  maxAgentCalls: 1_000,
  maxConcurrentAgents: 64,
};

const quickJsModule = newQuickJSWASMModuleFromVariant(SINGLEFILE_RELEASE_SYNC);

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function parseWorkflowReference(value: JsonValue): WorkflowReference {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error("workflow nameOrRef string must not be empty");
    }
    return value;
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(
      "workflow nameOrRef must be a non-empty string or a reference object",
    );
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    throw new Error(
      "workflow reference must contain exactly one of name, script, or scriptPath",
    );
  }
  const key = keys[0];
  if (key !== "name" && key !== "script" && key !== "scriptPath") {
    throw new Error(
      "workflow reference must contain exactly one of name, script, or scriptPath",
    );
  }
  const referenceValue = value[key];
  if (typeof referenceValue !== "string" || referenceValue.length === 0) {
    throw new Error(`workflow reference ${key} must be a non-empty string`);
  }
  if (key === "name") return { name: referenceValue };
  if (key === "script") return { script: referenceValue };
  return { scriptPath: referenceValue };
}

function normalizeLimits(
  overrides: Partial<WorkflowRuntimeLimits> | undefined,
): WorkflowRuntimeLimits {
  if (overrides === undefined) return { ...DEFAULT_LIMITS };
  if (
    typeof overrides !== "object" ||
    overrides === null ||
    Array.isArray(overrides) ||
    Object.getPrototypeOf(overrides) !== Object.prototype
  ) {
    throw new Error("Workflow runtime limits must be a plain object");
  }
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) {
      throw new Error(`Unknown workflow runtime limit ${JSON.stringify(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`Workflow runtime limit ${key} must be a data property`);
    }
  }
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<
    keyof WorkflowRuntimeLimits
  >) {
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
    const value =
      descriptor !== undefined && "value" in descriptor
        ? descriptor.value
        : undefined;
    if (value === undefined) continue;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new Error(
        `Workflow runtime limit ${key} must be a positive finite integer`,
      );
    }
    if (value > LIMIT_MAXIMUMS[key]) {
      throw new Error(
        `Workflow runtime limit ${key} cannot exceed ${LIMIT_MAXIMUMS[key]}`,
      );
    }
    limits[key] = value;
  }
  return limits;
}

function jsonToHandle(vm: QuickJSContext, value: JsonValue): QuickJSHandle {
  if (value === null) return vm.null;
  if (typeof value === "string") return vm.newString(value);
  if (typeof value === "number") return vm.newNumber(value);
  if (typeof value === "boolean") return value ? vm.true : vm.false;
  if (Array.isArray(value)) {
    const array = vm.newArray();
    for (let index = 0; index < value.length; index += 1) {
      const child = jsonToHandle(vm, value[index]!);
      vm.setProp(array, index, child);
      child.dispose();
    }
    return array;
  }
  const object = vm.newObject();
  for (const [key, childValue] of Object.entries(value)) {
    const child = jsonToHandle(vm, childValue);
    vm.setProp(object, key, child);
    child.dispose();
  }
  return object;
}

function dumpJson(
  vm: QuickJSContext,
  handle: QuickJSHandle,
  path: string,
): JsonValue {
  const value: unknown = vm.dump(handle);
  assertJsonValue(value, path);
  return value;
}

function installJsonGlobal(
  vm: QuickJSContext,
  name: string,
  value: JsonValue,
): void {
  const handle = jsonToHandle(vm, value);
  vm.setProp(vm.global, name, handle);
  handle.dispose();
}

interface ScheduledAgentCall {
  abort: () => void;
  reject: (error: unknown) => void;
  resolve: (value: JsonValue) => void;
  run: () => Promise<JsonValue>;
  signal: AbortSignal;
  state: "queued" | "active" | "settled";
}

class SharedWorkflowScheduler implements WorkflowExecutionScheduler {
  readonly limits: Readonly<WorkflowRuntimeLimits>;
  private readonly queue: ScheduledAgentCall[] = [];
  private activeAgents = 0;
  private agentCalls = 0;

  constructor(limits: Readonly<WorkflowRuntimeLimits>) {
    this.limits = limits;
  }

  schedule(
    run: () => Promise<JsonValue>,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    this.agentCalls += 1;
    if (this.agentCalls > this.limits.maxAgentCalls) {
      return Promise.reject(
        new Error(
          `Workflow exceeded the ${this.limits.maxAgentCalls} agent-call limit`,
        ),
      );
    }
    if (signal.aborted) return Promise.reject(new Error("Workflow cancelled"));

    return new Promise((resolve, reject) => {
      const call: ScheduledAgentCall = {
        abort: () => {
          if (call.state !== "queued") return;
          call.state = "settled";
          const index = this.queue.indexOf(call);
          if (index >= 0) this.queue.splice(index, 1);
          signal.removeEventListener("abort", call.abort);
          reject(new Error("Workflow cancelled"));
          this.drain();
        },
        reject,
        resolve,
        run,
        signal,
        state: "queued",
      };
      signal.addEventListener("abort", call.abort, { once: true });
      this.queue.push(call);
      this.drain();
    });
  }

  budget(): WorkflowBudgetSnapshot {
    return {
      agentCalls: this.agentCalls,
      activeAgents: this.activeAgents,
      queuedAgents: this.queue.length,
      maxAgentCalls: this.limits.maxAgentCalls,
      maxConcurrentAgents: this.limits.maxConcurrentAgents,
      totalTokens: null,
    };
  }

  private drain(): void {
    while (
      this.activeAgents < this.limits.maxConcurrentAgents &&
      this.queue.length > 0
    ) {
      const call = this.queue.shift();
      if (call === undefined || call.state !== "queued") continue;
      call.state = "active";
      this.activeAgents += 1;
      void Promise.resolve()
        .then(call.run)
        .then(
          (value) => this.finish(call, { value }),
          (error) => this.finish(call, { error }),
        );
    }
  }

  private finish(
    call: ScheduledAgentCall,
    settlement: { value: JsonValue } | { error: unknown },
  ): void {
    if (call.state !== "active") return;
    call.state = "settled";
    call.signal.removeEventListener("abort", call.abort);
    this.activeAgents -= 1;
    if ("value" in settlement) call.resolve(settlement.value);
    else call.reject(settlement.error);
    this.drain();
  }
}

interface PendingAgentCall {
  controller: AbortController;
  deferred: QuickJSDeferredPromise;
}

function installAgentFunction(
  vm: QuickJSContext,
  runtime: QuickJSRuntime,
  capabilities: ExecuteWorkflowScriptArgs["capabilities"],
  scheduler: SharedWorkflowScheduler,
  enterVm: () => void,
  signal: AbortSignal | undefined,
  currentPhase: () => string | null,
): { close(reason?: string): void } {
  const pending = new Set<PendingAgentCall>();
  let closed = false;

  const pump = () => {
    if (closed) return;
    enterVm();
    vm.unwrapResult(runtime.executePendingJobs());
  };

  const finish = (
    call: PendingAgentCall,
    settlement: { value: JsonValue } | { error: unknown },
  ) => {
    if (closed || !pending.delete(call)) return;
    if ("value" in settlement) {
      const handle = jsonToHandle(vm, settlement.value);
      call.deferred.resolve(handle);
      handle.dispose();
    } else {
      const handle = vm.newError(errorMessage(settlement.error));
      call.deferred.reject(handle);
      handle.dispose();
    }
    call.deferred.dispose();
    pump();
  };

  const rejectImmediately = (message: string): QuickJSHandle => {
    const deferred = vm.newPromise();
    const promise = deferred.handle.dup();
    const error = vm.newError(message);
    deferred.reject(error);
    error.dispose();
    deferred.dispose();
    return promise;
  };

  const fn = vm.newFunction("agent", (...handles) => {
    if (closed) return rejectImmediately("Workflow is no longer running");
    const promptValue = handles[0] ? vm.dump(handles[0]) : "";
    const prompt =
      typeof promptValue === "string" ? promptValue : String(promptValue);
    const parsedOptions = parseAgentOptions(
      handles[1] ? dumpJson(vm, handles[1], "agent options") : undefined,
    );
    const options: WorkflowAgentOptions = {
      ...parsedOptions,
      phase: parsedOptions.phase ?? currentPhase(),
    };
    const call: PendingAgentCall = {
      controller: new AbortController(),
      deferred: vm.newPromise(),
    };
    const agentSignal = call.controller.signal;
    const runAgent = () => capabilities.agent(prompt, options, agentSignal);
    pending.add(call);
    void scheduler
      .schedule(runAgent, agentSignal)
      .then(
        (value) => {
          assertJsonValue(value, "agent result");
          finish(call, { value });
        },
        (error) => finish(call, { error }),
      )
      .catch((error) => finish(call, { error }));
    return call.deferred.handle;
  });
  vm.setProp(vm.global, "agent", fn);
  fn.dispose();

  const close = (reason?: string) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    for (const call of pending) {
      call.controller.abort(reason);
      if (reason !== undefined && call.deferred.alive) {
        const error = vm.newError(reason);
        call.deferred.reject(error);
        error.dispose();
      }
      call.deferred.dispose();
    }
    pending.clear();
    if (reason !== undefined) {
      enterVm();
      vm.unwrapResult(runtime.executePendingJobs());
    }
  };
  const abort = () => close("Workflow cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted === true) abort();
  return { close };
}

interface PendingWorkflowCall {
  controller: AbortController;
  deferred: QuickJSDeferredPromise;
}

function installWorkflowFunction(
  vm: QuickJSContext,
  runtime: QuickJSRuntime,
  capabilities: ExecuteWorkflowScriptArgs["capabilities"],
  limits: Readonly<WorkflowRuntimeLimits>,
  scheduler: SharedWorkflowScheduler,
  depth: 0 | 1,
  enterVm: () => void,
  signal: AbortSignal | undefined,
): { close(reason?: string): void } {
  const pending = new Set<PendingWorkflowCall>();
  let closed = false;

  const rejectImmediately = (message: string): QuickJSHandle => {
    const deferred = vm.newPromise();
    const promise = deferred.handle.dup();
    const error = vm.newError(message);
    deferred.reject(error);
    error.dispose();
    deferred.dispose();
    return promise;
  };

  const finish = (
    call: PendingWorkflowCall,
    settlement: { value: JsonValue } | { error: unknown },
  ) => {
    if (closed || !pending.delete(call)) return;
    if ("value" in settlement) {
      const handle = jsonToHandle(vm, settlement.value);
      call.deferred.resolve(handle);
      handle.dispose();
    } else {
      const handle = vm.newError(errorMessage(settlement.error));
      call.deferred.reject(handle);
      handle.dispose();
    }
    call.deferred.dispose();
    enterVm();
    vm.unwrapResult(runtime.executePendingJobs());
  };

  const fn = vm.newFunction("__bbWorkflow", (...handles) => {
    if (closed) return rejectImmediately("Workflow is no longer running");
    if (depth >= 1) {
      return rejectImmediately(
        "Nested workflow depth limit exceeded: workflows may invoke one child level only",
      );
    }
    if (capabilities.workflow === undefined) {
      return rejectImmediately(
        "workflow() is unavailable: configure the workflow host capability to run nested workflows",
      );
    }
    const referenceValue = handles[0]
      ? dumpJson(vm, handles[0], "workflow reference")
      : null;
    const reference = parseWorkflowReference(referenceValue);
    const childArgs = handles[1]
      ? dumpJson(vm, handles[1], "workflow args")
      : null;
    const call: PendingWorkflowCall = {
      controller: new AbortController(),
      deferred: vm.newPromise(),
    };
    pending.add(call);
    void Promise.resolve()
      .then(() =>
        capabilities.workflow!(reference, childArgs, {
          signal: call.controller.signal,
          limits,
          scheduler,
          depth: 1,
        }),
      )
      .then(
        (value) => {
          assertJsonValue(value, "nested workflow result");
          finish(call, { value });
        },
        (error) => finish(call, { error }),
      )
      .catch((error) => finish(call, { error }));
    return call.deferred.handle;
  });
  vm.setProp(vm.global, "__bbWorkflow", fn);
  fn.dispose();

  const close = (reason?: string) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    for (const call of pending) {
      call.controller.abort(reason);
      if (reason !== undefined && call.deferred.alive) {
        const error = vm.newError(reason);
        call.deferred.reject(error);
        error.dispose();
      }
      call.deferred.dispose();
    }
    pending.clear();
    if (reason !== undefined) {
      enterVm();
      vm.unwrapResult(runtime.executePendingJobs());
    }
  };
  const abort = () => close("Workflow cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted === true) abort();
  return { close };
}

function installHostVoidFunction(
  vm: QuickJSContext,
  name: string,
  invoke: (args: readonly QuickJSHandle[]) => void,
): void {
  const fn = vm.newFunction(name, (...handles) => {
    invoke(handles);
    return vm.undefined;
  });
  vm.setProp(vm.global, name, fn);
  fn.dispose();
}

const HARDENING_SOURCE = `
(() => {
  const forbidden = (name) => () => { throw new Error(name + " is unavailable in workflows"); };
  const blockedConstructor = forbidden("dynamic code generation");
  const constructors = [
    (() => {}).constructor,
    (async () => {}).constructor,
    (function* () {}).constructor,
    (async function* () {}).constructor,
  ];
  for (const constructor of constructors) {
    Object.defineProperty(constructor.prototype, "constructor", {
      value: blockedConstructor,
      configurable: false,
      writable: false,
    });
  }
  Object.defineProperty(globalThis, "eval", { value: undefined, configurable: false, writable: false });
  Object.defineProperty(globalThis, "Function", { value: undefined, configurable: false, writable: false });
  Object.defineProperty(Math, "random", { value: forbidden("Math.random"), configurable: false, writable: false });
  Object.defineProperty(globalThis, "Date", { value: undefined, configurable: false, writable: false });
  Object.freeze(Math);
  Object.freeze(JSON);
})();
`;

const DSL_SOURCE = `
(() => {
  const readBudget = globalThis.__bbWorkflowBudget;
  const callWorkflow = globalThis.__bbWorkflow;
  delete globalThis.__bbWorkflowBudget;
  delete globalThis.__bbWorkflow;
  const maximumCollectionSize = 4096;
  const validateWorkflowReference = (reference) => {
    if (typeof reference === "string") {
      if (reference.length === 0) throw new TypeError("workflow nameOrRef string must not be empty");
      return;
    }
    if (reference === null || typeof reference !== "object" || Array.isArray(reference)) {
      throw new TypeError("workflow nameOrRef must be a non-empty string or a reference object");
    }
    const prototype = Object.getPrototypeOf(reference);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("workflow reference must be a plain JSON object");
    }
    if (Object.getOwnPropertySymbols(reference).length !== 0) {
      throw new TypeError("workflow reference must not contain symbol properties");
    }
    const keys = Object.getOwnPropertyNames(reference);
    if (keys.length !== 1 || !["name", "script", "scriptPath"].includes(keys[0])) {
      throw new TypeError("workflow reference must contain exactly one of name, script, or scriptPath");
    }
    const descriptor = Object.getOwnPropertyDescriptor(reference, keys[0]);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("workflow reference must contain an enumerable data property");
    }
    if (typeof descriptor.value !== "string" || descriptor.value.length === 0) {
      throw new TypeError("workflow reference " + keys[0] + " must be a non-empty string");
    }
  };
  const workflow = function(nameOrRef, ...childArgs) {
    validateWorkflowReference(nameOrRef);
    return childArgs.length === 0
      ? callWorkflow(nameOrRef)
      : callWorkflow(nameOrRef, childArgs[0]);
  };
  const parallel = async (tasks) => {
    if (!Array.isArray(tasks)) throw new TypeError("parallel thunks must be an array");
    if (tasks.length > maximumCollectionSize) throw new RangeError("parallel cannot exceed 4096 entries");
    for (let index = 0; index < tasks.length; index += 1) {
      if (!(index in tasks)) throw new TypeError("parallel thunks cannot be sparse");
      if (typeof tasks[index] !== "function") throw new TypeError("parallel entries must be functions");
    }
    return Promise.all(tasks.map(async (task) => {
      try { return await task(); }
      catch { return null; }
    }));
  };
  const pipeline = async (items, ...stages) => {
    if (!Array.isArray(items)) throw new TypeError("pipeline items must be an array");
    if (items.length > maximumCollectionSize) throw new RangeError("pipeline cannot exceed 4096 items");
    if (stages.length > maximumCollectionSize) throw new RangeError("pipeline cannot exceed 4096 stages");
    for (let index = 0; index < items.length; index += 1) {
      if (!(index in items)) throw new TypeError("pipeline items cannot be sparse");
    }
    for (const stage of stages) {
      if (typeof stage !== "function") throw new TypeError("pipeline stages must be functions");
    }
    return Promise.all(items.map(async (original, index) => {
      let current = original;
      for (const stage of stages) {
        if (current === null) return null;
        try { current = await stage(current, original, index); }
        catch { return null; }
      }
      return current;
    }));
  };
  const budget = () => Object.freeze(readBudget());
  Object.defineProperties(globalThis, {
    parallel: { value: Object.freeze(parallel), configurable: false, writable: false },
    pipeline: { value: Object.freeze(pipeline), configurable: false, writable: false },
    budget: { value: Object.freeze(budget), configurable: false, writable: false },
    workflow: { value: Object.freeze(workflow), configurable: false, writable: false },
  });
})();
`;

export async function executeWorkflowScript({
  args,
  body,
  capabilities,
  limits: limitOverrides,
  signal,
  depth = 0,
  scheduler: providedScheduler,
}: ExecuteWorkflowScriptArgs): Promise<JsonValue> {
  assertJsonValue(args, "args");
  if (depth !== 0 && depth !== 1) {
    throw new Error("Workflow depth must be 0 or 1");
  }
  if (
    providedScheduler !== undefined &&
    !(providedScheduler instanceof SharedWorkflowScheduler)
  ) {
    throw new Error(
      "Workflow scheduler must be the scheduler supplied by a nested workflow context",
    );
  }
  const scheduler =
    providedScheduler ??
    new SharedWorkflowScheduler(Object.freeze(normalizeLimits(limitOverrides)));
  const limits = scheduler.limits;
  if (providedScheduler !== undefined && limitOverrides !== undefined) {
    const requestedLimits = normalizeLimits(limitOverrides);
    if (
      requestedLimits.memoryLimitBytes !== limits.memoryLimitBytes ||
      requestedLimits.maxStackBytes !== limits.maxStackBytes ||
      requestedLimits.synchronousDeadlineMs !== limits.synchronousDeadlineMs ||
      requestedLimits.maxAgentCalls !== limits.maxAgentCalls ||
      requestedLimits.maxConcurrentAgents !== limits.maxConcurrentAgents
    ) {
      throw new Error(
        "Nested workflow limits must match the shared workflow scheduler",
      );
    }
  }
  if (isAborted(signal)) throw new Error("Workflow cancelled");
  const QuickJS = await quickJsModule;
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryLimitBytes);
  runtime.setMaxStackSize(limits.maxStackBytes);
  let deadline = Number.POSITIVE_INFINITY;
  const enterVm = () => {
    deadline = Date.now() + limits.synchronousDeadlineMs;
  };
  runtime.setInterruptHandler(
    () => signal?.aborted === true || Date.now() > deadline,
  );
  const vm = runtime.newContext();
  let agentBridge: { close(reason?: string): void } | undefined;
  let workflowBridge: { close: (reason?: string) => void } | undefined;
  let currentPhase: string | null = null;

  try {
    installJsonGlobal(vm, "args", args);
    agentBridge = installAgentFunction(
      vm,
      runtime,
      capabilities,
      scheduler,
      enterVm,
      signal,
      () => currentPhase,
    );
    const budgetFunction = vm.newFunction("__bbWorkflowBudget", () =>
      jsonToHandle(vm, scheduler.budget()),
    );
    vm.setProp(vm.global, "__bbWorkflowBudget", budgetFunction);
    budgetFunction.dispose();
    workflowBridge = installWorkflowFunction(
      vm,
      runtime,
      capabilities,
      limits,
      scheduler,
      depth,
      enterVm,
      signal,
    );
    installHostVoidFunction(vm, "log", (handles) => {
      capabilities.log(handles[0] ? vm.getString(handles[0]) : "");
    });
    installHostVoidFunction(vm, "phase", (handles) => {
      const value = handles[0] ? vm.dump(handles[0]) : undefined;
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error("phase title must be a non-empty string");
      }
      currentPhase = value;
      capabilities.phase(value);
    });

    enterVm();
    vm.unwrapResult(vm.evalCode(DSL_SOURCE)).dispose();
    enterVm();
    vm.unwrapResult(vm.evalCode(HARDENING_SOURCE)).dispose();
    enterVm();
    const evaluated = vm.evalCode(`(async () => {\n${body}\n})()`);
    const promise = vm.unwrapResult(evaluated);
    try {
      const nativeSettlement = vm.resolvePromise(promise);
      enterVm();
      vm.unwrapResult(runtime.executePendingJobs());
      const settled = await nativeSettlement;
      const value = vm.unwrapResult(settled);
      try {
        return dumpJson(vm, value, "workflow result");
      } finally {
        value.dispose();
      }
    } finally {
      promise.dispose();
    }
  } catch (error) {
    if (isAborted(signal)) {
      throw new Error("Workflow cancelled");
    }
    throw error;
  } finally {
    workflowBridge?.close();
    agentBridge?.close();
    vm.dispose();
    runtime.dispose();
  }
}
