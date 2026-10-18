import SINGLEFILE_RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SandboxHostFunction = (
  args: JsonValue[],
  signal: AbortSignal,
) => Promise<JsonValue>;

export interface SandboxLimits {
  memoryLimitBytes: number;
  maxStackBytes: number;
  synchronousDeadlineMs: number;
  cpuBudgetMs: number;
  totalDeadlineMs: number;
  maxHostCalls: number;
  maxLogChars: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackBytes: 256 * 1024,
  synchronousDeadlineMs: 500,
  cpuBudgetMs: 3_000,
  totalDeadlineMs: 25_000,
  maxHostCalls: 200,
  maxLogChars: 20_000,
};

export interface SandboxRunArgs {
  code: string;
  hostFunctions: Record<string, SandboxHostFunction>;
  prelude: string;
  limits?: Partial<SandboxLimits>;
  signal?: AbortSignal;
}

export type SandboxRunResult =
  | { ok: true; value: JsonValue; logs: string }
  | { ok: false; error: string; logs: string };

const WASM_PAGE_BYTES = 64 * 1024;
const MIN_MEMORY_PAGES = 256;
const MAX_MEMORY_PAGES = 32_768;
const TRANSFER_MARGIN_BYTES = 4 * 1024;
const CANCELLED_REASON = "The call was cancelled.";

declare const WebAssembly: {
  Memory: new (descriptor: { initial: number; maximum: number }) => {
    grow(deltaPages: number): number;
  };
};

class SandboxMemory extends WebAssembly.Memory {
  exhausted = false;

  constructor(readonly pages: number) {
    super({ initial: pages, maximum: pages });
  }

  override grow(deltaPages: number): number {
    try {
      return super.grow(deltaPages);
    } catch (error) {
      this.exhausted = true;
      throw error;
    }
  }
}

interface SandboxInstance {
  memory: SandboxMemory;
  module: QuickJSWASMModule;
}

let idleInstance: SandboxInstance | null = null;

async function acquireInstance(
  memoryLimitBytes: number,
): Promise<SandboxInstance> {
  const pages = Math.floor(memoryLimitBytes / WASM_PAGE_BYTES);
  if (!(pages >= MIN_MEMORY_PAGES && pages <= MAX_MEMORY_PAGES)) {
    throw new RangeError(
      `memoryLimitBytes must be between ${MIN_MEMORY_PAGES * WASM_PAGE_BYTES} and ${MAX_MEMORY_PAGES * WASM_PAGE_BYTES}, got ${memoryLimitBytes}.`,
    );
  }
  const idle = idleInstance;
  if (idle !== null && idle.memory.pages === pages) {
    idleInstance = null;
    return idle;
  }
  const memory = new SandboxMemory(pages);
  const module = await newQuickJSWASMModuleFromVariant(
    newVariant(SINGLEFILE_RELEASE_SYNC, { wasmMemory: memory }),
  );
  return { memory, module };
}

const ALLOCATION_PROBE_SOURCE = `
((ArrayBufferConstructor) => (bytes) => { new ArrayBufferConstructor(bytes); })(ArrayBuffer)
`;

const HARDENING_SOURCE = `
(() => {
  const blocked = (name) => () => { throw new Error(name + " is unavailable here"); };
  const functionConstructor = blocked("dynamic code generation");
  for (const prototype of [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ]) {
    Object.defineProperty(prototype, "constructor", {
      value: functionConstructor,
      writable: false,
      configurable: false,
    });
  }
  globalThis.eval = blocked("eval");
  globalThis.Function = functionConstructor;
})();
`;

let disposeFailures = 0;

export function sandboxDisposeFailureCount(): number {
  return disposeFailures;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function dumpError(vm: QuickJSContext, handle: QuickJSHandle): string {
  const dumped: unknown = vm.dump(handle);
  if (typeof dumped === "object" && dumped !== null) {
    const record = dumped as { name?: unknown; message?: unknown };
    if (typeof record.message === "string") {
      return typeof record.name === "string" && record.name !== "Error"
        ? `${record.name}: ${record.message}`
        : record.message;
    }
    try {
      return JSON.stringify(dumped);
    } catch {
      return String(dumped);
    }
  }
  return String(dumped);
}

interface PendingHostCall {
  controller: AbortController;
  deferred: QuickJSDeferredPromise;
}

export async function runSandboxedScript(
  args: SandboxRunArgs,
): Promise<SandboxRunResult> {
  const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...args.limits };
  const instance = await acquireInstance(limits.memoryLimitBytes);
  if (args.signal?.aborted === true) {
    idleInstance = instance;
    return { ok: false, error: CANCELLED_REASON, logs: "" };
  }
  const { memory } = instance;
  let intact = true;
  const runtime: QuickJSRuntime = instance.module.newRuntime();
  runtime.setMaxStackSize(limits.maxStackBytes);

  const controller = new AbortController();
  let stopReason: string | null = null;
  const stop = (reason: string) => {
    if (stopReason !== null) return;
    stopReason = reason;
    controller.abort(reason);
  };
  const onOuterAbort = () => stop(CANCELLED_REASON);
  args.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const totalTimer = setTimeout(
    () =>
      stop(
        `The script ran longer than ${Math.round(limits.totalDeadlineMs / 1000)} seconds and was stopped. Do less per call, or poll across calls.`,
      ),
    limits.totalDeadlineMs,
  );

  const memoryStopReason = `The script ran out of memory and was stopped. A script has ${Math.floor(limits.memoryLimitBytes / (1024 * 1024))} MB of memory; keep less data at once.`;
  const cpuStopReason = `The script computed for too long and was stopped. A script may compute for ${limits.synchronousDeadlineMs} ms at a stretch and ${Math.round(limits.cpuBudgetMs / 1000)} seconds in total; waiting on bb calls does not count.`;
  let synchronousDeadline = Number.POSITIVE_INFINITY;
  let cpuSpentMs = 0;
  const enterVm = <T>(run: () => T): T => {
    const startedAt = Date.now();
    synchronousDeadline =
      startedAt +
      Math.min(limits.synchronousDeadlineMs, limits.cpuBudgetMs - cpuSpentMs);
    try {
      return run();
    } finally {
      const finishedAt = Date.now();
      cpuSpentMs += finishedAt - startedAt;
      if (memory.exhausted) stop(memoryStopReason);
      if (
        finishedAt > synchronousDeadline ||
        cpuSpentMs >= limits.cpuBudgetMs
      ) {
        stop(cpuStopReason);
      }
    }
  };
  runtime.setInterruptHandler(
    () =>
      memory.exhausted ||
      controller.signal.aborted ||
      Date.now() > synchronousDeadline,
  );
  const runPendingJobs = () => {
    while (
      !memory.exhausted &&
      !controller.signal.aborted &&
      Date.now() <= synchronousDeadline
    ) {
      const jobs = runtime.executePendingJobs(1);
      if (memory.exhausted) return;
      if (jobs.error) {
        jobs.error.dispose();
        continue;
      }
      if (jobs.value === 0) return;
    }
  };

  const vm = runtime.newContext();
  const allocationProbe = vm.unwrapResult(vm.evalCode(ALLOCATION_PROBE_SOURCE));
  const hasRoomFor = (text: string): boolean => {
    if (memory.exhausted) return false;
    const utf8Bytes = Buffer.byteLength(text);
    const stringBytes =
      utf8Bytes === text.length ? text.length : 2 * text.length;
    const bytes = vm.newNumber(utf8Bytes + stringBytes + TRANSFER_MARGIN_BYTES);
    const attempt = vm.callFunction(allocationProbe, vm.undefined, bytes);
    if (memory.exhausted) return false;
    const fits = attempt.error === undefined;
    bytes.dispose();
    attempt.dispose();
    return fits;
  };
  const pending = new Set<PendingHostCall>();
  let closed = false;
  let hostCalls = 0;
  let logs = "";
  let logsTruncated = false;

  const appendLog = (line: string) => {
    if (logsTruncated) return;
    if (logs.length + line.length + 1 > limits.maxLogChars) {
      logs += "[log output truncated]\n";
      logsTruncated = true;
      return;
    }
    logs += `${line}\n`;
  };

  const settle = (
    call: PendingHostCall,
    settlement: { value: string } | { error: unknown },
  ) => {
    if (closed || controller.signal.aborted || !pending.delete(call)) return;
    enterVm(() => {
      const text =
        "value" in settlement
          ? settlement.value
          : errorMessage(settlement.error);
      if (!hasRoomFor(text)) {
        memory.exhausted = true;
        return;
      }
      if ("value" in settlement) {
        const handle = vm.newString(text);
        call.deferred.resolve(handle);
        handle.dispose();
      } else {
        const handle = vm.newError(text);
        call.deferred.reject(handle);
        handle.dispose();
      }
      call.deferred.dispose();
      runPendingJobs();
    });
  };

  const rejectImmediately = (message: string): QuickJSHandle => {
    if (!hasRoomFor(message)) return vm.undefined;
    const deferred = vm.newPromise();
    const promise = deferred.handle.dup();
    const error = vm.newError(message);
    deferred.reject(error);
    error.dispose();
    deferred.dispose();
    return promise;
  };

  const closeBridge = () => {
    if (closed) return;
    closed = true;
    for (const call of pending) {
      call.controller.abort();
      if (!memory.exhausted) call.deferred.dispose();
    }
    pending.clear();
  };

  try {
    const hostFunction = vm.newFunction(
      "__bbHost",
      (nameHandle, argsHandle) => {
        if (memory.exhausted) return vm.undefined;
        if (closed || controller.signal.aborted) {
          return rejectImmediately("The script is no longer running.");
        }
        const name = vm.getString(nameHandle);
        const implementation = Object.hasOwn(args.hostFunctions, name)
          ? args.hostFunctions[name]
          : undefined;
        if (implementation === undefined) {
          return rejectImmediately(`Unknown host function: ${name}`);
        }
        hostCalls += 1;
        if (hostCalls > limits.maxHostCalls) {
          return rejectImmediately(
            `A script may make at most ${limits.maxHostCalls} bb calls.`,
          );
        }
        let parsed: JsonValue;
        try {
          parsed = JSON.parse(vm.getString(argsHandle)) as JsonValue;
        } catch {
          return rejectImmediately("Arguments must be JSON-serialisable.");
        }
        const callArgs = Array.isArray(parsed) ? parsed : [parsed];
        const call: PendingHostCall = {
          controller: new AbortController(),
          deferred: vm.newPromise(),
        };
        pending.add(call);
        const onStop = () => call.controller.abort();
        controller.signal.addEventListener("abort", onStop, { once: true });
        void Promise.resolve()
          .then(() => implementation(callArgs, call.controller.signal))
          .then(
            (value) =>
              settle(call, { value: JSON.stringify(value ?? null) ?? "null" }),
            (error) => settle(call, { error }),
          )
          .catch((error: unknown) => {
            intact = false;
            stop(
              `The script was stopped by an internal error: ${errorMessage(error)}`,
            );
          })
          .finally(() =>
            controller.signal.removeEventListener("abort", onStop),
          );
        return call.deferred.handle;
      },
    );
    vm.setProp(vm.global, "__bbHost", hostFunction);
    hostFunction.dispose();

    const logFunction = vm.newFunction("__bbLog", (lineHandle) => {
      appendLog(vm.getString(lineHandle));
      return vm.undefined;
    });
    vm.setProp(vm.global, "__bbLog", logFunction);
    logFunction.dispose();

    let finish: (outcome: { kind: string; text: string }) => void = () => {};
    const finished = new Promise<{ kind: string; text: string }>((resolve) => {
      finish = resolve;
    });
    const doneFunction = vm.newFunction(
      "__bbDone",
      (kindHandle, textHandle) => {
        finish({
          kind: vm.getString(kindHandle),
          text: vm.getString(textHandle),
        });
        return vm.undefined;
      },
    );
    vm.setProp(vm.global, "__bbDone", doneFunction);
    doneFunction.dispose();

    vm.unwrapResult(vm.evalCode(HARDENING_SOURCE)).dispose();
    vm.unwrapResult(vm.evalCode(args.prelude)).dispose();
    const evaluated = enterVm(() =>
      vm.evalCode(
        `(() => {\n` +
          `const __done = __bbDone;\n` +
          `const __describe = (error) => {\n` +
          `  if (error && typeof error === "object" && typeof error.message === "string") {\n` +
          `    return typeof error.name === "string" && error.name !== "Error" ? error.name + ": " + error.message : error.message;\n` +
          `  }\n` +
          `  return String(error);\n` +
          `};\n` +
          `(async () => {\n${args.code}\n})().then(\n` +
          `  (result) => {\n` +
          `    let text;\n` +
          `    try { text = JSON.stringify(result === undefined ? null : result); } catch (error) { __done("error", "The result is not JSON-serialisable: " + __describe(error)); return; }\n` +
          `    __done("ok", text === undefined ? "null" : text);\n` +
          `  },\n` +
          `  (error) => { __done("error", __describe(error)); },\n` +
          `);\n` +
          `})()`,
      ),
    );
    if (memory.exhausted) {
      return { ok: false, error: stopReason ?? memoryStopReason, logs };
    }
    if (evaluated.error) {
      const message = dumpError(vm, evaluated.error);
      evaluated.error.dispose();
      return { ok: false, error: stopReason ?? message, logs };
    }
    evaluated.value.dispose();
    enterVm(runPendingJobs);
    const stopped = new Promise<"stopped">((resolve) => {
      if (controller.signal.aborted) resolve("stopped");
      controller.signal.addEventListener("abort", () => resolve("stopped"), {
        once: true,
      });
    });
    const outcome = await Promise.race([finished, stopped]);
    closeBridge();
    if (outcome === "stopped") {
      return {
        ok: false,
        error: stopReason ?? "The script was stopped.",
        logs,
      };
    }
    if (outcome.kind !== "ok") {
      return { ok: false, error: stopReason ?? outcome.text, logs };
    }
    return { ok: true, value: JSON.parse(outcome.text) as JsonValue, logs };
  } catch (error) {
    intact = false;
    return { ok: false, error: stopReason ?? errorMessage(error), logs };
  } finally {
    clearTimeout(totalTimer);
    args.signal?.removeEventListener("abort", onOuterAbort);
    closeBridge();
    if (!memory.exhausted) {
      try {
        allocationProbe.dispose();
        vm.dispose();
        runtime.dispose();
        if (intact) idleInstance = instance;
      } catch {
        disposeFailures += 1;
      }
    }
  }
}
