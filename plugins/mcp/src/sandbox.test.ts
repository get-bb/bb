import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runSandboxedScript,
  sandboxDisposeFailureCount,
  type JsonValue,
  type SandboxRunArgs,
  type SandboxRunResult,
} from "./sandbox.js";

const MIB = 1024 * 1024;

const PRELUDE = `
globalThis.host = async (name, ...args) =>
  JSON.parse(await __bbHost(name, JSON.stringify(args)));
globalThis.print = (line) => __bbLog(String(line));
`;

function run(code: string, overrides: Partial<SandboxRunArgs> = {}) {
  return runSandboxedScript({
    code,
    prelude: PRELUDE,
    hostFunctions: {},
    ...overrides,
  });
}

function failure(result: SandboxRunResult): string {
  if (result.ok) {
    throw new Error(`Expected a failure, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

describe("runSandboxedScript", () => {
  let failuresBefore = 0;
  let expectedFailures = 0;

  beforeEach(() => {
    failuresBefore = sandboxDisposeFailureCount();
    expectedFailures = 0;
  });

  afterEach(() => {
    expect(sandboxDisposeFailureCount() - failuresBefore).toBe(
      expectedFailures,
    );
  });

  it("returns the script's JSON value and its logs", async () => {
    const result = await run(
      `print("hello"); return { sum: [1, 2, 3].reduce((a, b) => a + b, 0) };`,
    );
    expect(result).toEqual({ ok: true, value: { sum: 6 }, logs: "hello\n" });
  });

  it("returns null when the script returns nothing", async () => {
    expect(await run(`const unused = 1;`)).toEqual({
      ok: true,
      value: null,
      logs: "",
    });
  });

  it("awaits host functions and passes JSON both ways", async () => {
    const result = await run(
      `const a = await host("double", 4); const b = await host("double", a.value); return b;`,
      {
        hostFunctions: {
          double: async ([value]) => ({ value: Number(value) * 2 }),
        },
      },
    );
    expect(result).toEqual({ ok: true, value: { value: 16 }, logs: "" });
  });

  it("surfaces a host function failure as a catchable error", async () => {
    const result = await run(
      `try { await host("fail"); } catch (error) { return "caught: " + error.message; }`,
      {
        hostFunctions: {
          fail: async () => {
            throw new Error("not allowed");
          },
        },
      },
    );
    expect(result).toEqual({
      ok: true,
      value: "caught: not allowed",
      logs: "",
    });
  });

  it("reports a thrown error with its message", async () => {
    const result = await run(`throw new TypeError("bad input");`);
    expect(result).toMatchObject({ ok: false, error: "TypeError: bad input" });
  });

  it("reports a syntax error instead of throwing", async () => {
    const result = await run(`return (;`);
    expect(failure(result)).toContain("SyntaxError");
  });

  it("interrupts a synchronous infinite loop", async () => {
    const result = await run(`while (true) {}`, {
      limits: { synchronousDeadlineMs: 50 },
    });
    expect(failure(result)).toContain("computed for too long");
  });

  it("stops a script that swallows the interrupt and keeps spinning", async () => {
    const startedAt = Date.now();
    const result = await run(
      `for (;;) { try { await (async () => { for (;;) {} })(); } catch {} }`,
      { limits: { synchronousDeadlineMs: 100, cpuBudgetMs: 400 } },
    );
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain(
      "computed for too long",
    );
  });

  it("stops a script that multiplies spinning promise chains", async () => {
    const startedAt = Date.now();
    const result = await run(
      `const spin = () => (async () => { for (;;) {} })().catch(() => { spin(); spin(); }); spin(); await new Promise(() => {});`,
      { limits: { synchronousDeadlineMs: 100, cpuBudgetMs: 400 } },
    );
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(failure(result)).toContain("computed for too long");
  });

  it("stops an endless chain of cheap microtasks", async () => {
    const startedAt = Date.now();
    const result = await run(`for (;;) { await null; }`, {
      limits: { synchronousDeadlineMs: 100, cpuBudgetMs: 400 },
    });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(failure(result)).toContain("computed for too long");
  });

  it("charges computation across bb calls to one total budget", async () => {
    let calls = 0;
    const result = await run(
      `for (;;) { const until = Date.now() + 60; while (Date.now() < until) {} await host("tick"); }`,
      {
        limits: { synchronousDeadlineMs: 200, cpuBudgetMs: 300 },
        hostFunctions: {
          tick: async () => {
            calls += 1;
            return null;
          },
        },
      },
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain(
      "computed for too long",
    );
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(12);
  });

  it("does not charge time spent waiting on a bb call", async () => {
    const result = await run(`await host("slow"); return "done";`, {
      limits: { synchronousDeadlineMs: 50, cpuBudgetMs: 100 },
      hostFunctions: {
        slow: () =>
          new Promise((resolve) => setTimeout(() => resolve(null), 300)),
      },
    });
    expect(result).toMatchObject({ ok: true, value: "done" });
  });

  it("reports unbounded recursion as an error and keeps working", async () => {
    for (let round = 0; round < 12; round += 1) {
      const overflow = await run(`const f = () => f(); f();`);
      expect(overflow).toMatchObject({ ok: false });
      expect(overflow.ok === false && overflow.error).toContain("stack");
    }
    expect(await run(`return 7;`)).toMatchObject({ ok: true, value: 7 });
  });

  it("recovers when tearing a script down fails", async () => {
    let failed = 0;
    for (let round = 0; round < 3; round += 1) {
      const before = sandboxDisposeFailureCount();
      await run(`const f = () => f(); f();`, {
        limits: { maxStackBytes: 1024 * 1024 },
      });
      failed += sandboxDisposeFailureCount() - before;
      expect(await run(`return 7;`)).toMatchObject({ ok: true, value: 7 });
    }
    expectedFailures = failed;
    expect(failed).toBeGreaterThan(0);
  });

  it("stops a script that awaits forever at the total deadline", async () => {
    const result = await run(`await new Promise(() => {});`, {
      limits: { totalDeadlineMs: 80 },
    });
    expect(failure(result)).toContain("ran longer than");
  });

  it("stops a script whose host call never settles and aborts that call", async () => {
    let aborted = false;
    const result = await run(`await host("hang");`, {
      limits: { totalDeadlineMs: 80 },
      hostFunctions: {
        hang: (_args, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      },
    });
    expect(failure(result)).toContain("ran longer than");
    expect(aborted).toBe(true);
  });

  it("stops when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const pending = run(`await new Promise(() => {});`, {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: "The call was cancelled.",
    });
  });

  it("limits the number of host calls", async () => {
    const result = await run(
      `for (let i = 0; i < 5; i += 1) await host("noop"); return "done";`,
      {
        limits: { maxHostCalls: 3 },
        hostFunctions: { noop: async () => null },
      },
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("at most 3");
  });

  it("refuses host functions that were not provided, including inherited names", async () => {
    const result = await run(
      `const out = []; for (const name of ["missing", "constructor", "toString", "__proto__"]) { try { await host(name); out.push("ran"); } catch (error) { out.push("refused"); } } return out;`,
    );
    expect(result).toMatchObject({
      ok: true,
      value: ["refused", "refused", "refused", "refused"],
    });
  });

  it("has no access to Node or network globals", async () => {
    const result = await run(
      `return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof Buffer, typeof XMLHttpRequest, typeof WebSocket, typeof module];`,
    );
    expect(result).toMatchObject({
      ok: true,
      value: new Array(8).fill("undefined"),
    });
  });

  it("blocks eval", async () => {
    const result = await run(
      `try { return eval("1 + 1"); } catch (error) { return error.message; }`,
    );
    expect(result).toMatchObject({
      ok: true,
      value: "eval is unavailable here",
    });
  });

  it("blocks dynamic code generation through function constructors", async () => {
    const result = await run(
      `const attempts = [() => Function("return 1")(), () => (async () => {}).constructor("return 1")(), () => (function* () {}).constructor("yield 1")()]; return attempts.map((attempt) => { try { attempt(); return "ran"; } catch { return "blocked"; } });`,
    );
    expect(result).toMatchObject({
      ok: true,
      value: ["blocked", "blocked", "blocked"],
    });
  });

  it("fails cleanly when the script exhausts its memory limit", async () => {
    const result = await run(
      `const chunks = []; while (true) chunks.push(new Array(100000).fill("x"));`,
      { limits: { memoryLimitBytes: 16 * MIB } },
    );
    expect(failure(result)).toContain("ran out of memory");
  });

  it("holds a script to the memory limit it was given", async () => {
    const allocatedMegabytes = async (limitMegabytes: number) => {
      const result = await run(
        `const keep = []; for (;;) { keep.push(new Uint8Array(1024 * 1024)); print(keep.length); }`,
        { limits: { memoryLimitBytes: limitMegabytes * MIB } },
      );
      expect(failure(result)).toContain("ran out of memory");
      return result.logs.trim().split("\n").length;
    };
    const within16 = await allocatedMegabytes(16);
    expect(within16).toBeGreaterThan(4);
    expect(within16).toBeLessThan(16);
    const within32 = await allocatedMegabytes(32);
    expect(within32).toBeGreaterThan(16);
    expect(within32).toBeLessThan(32);
  });

  it("stops a script that swallows the out-of-memory error", async () => {
    const result = await run(
      `const keep = []; for (;;) { try { keep.push(new Uint8Array(1024 * 1024)); } catch {} }`,
      { limits: { memoryLimitBytes: 16 * MIB } },
    );
    expect(failure(result)).toContain("ran out of memory");
  });

  it("stops a script when a host result does not fit in its memory", async () => {
    const result = await run(
      `const keep = []; for (let i = 0; i < 8; i += 1) keep.push(new Uint8Array(1024 * 1024)); await host("big"); return keep.length;`,
      {
        limits: { memoryLimitBytes: 16 * MIB },
        hostFunctions: { big: async () => "b".repeat(4 * MIB) },
      },
    );
    expect(failure(result)).toContain("ran out of memory");
  });

  it("refuses a memory limit below what the engine can enforce", async () => {
    await expect(
      run(`return 1;`, { limits: { memoryLimitBytes: 4 * MIB } }),
    ).rejects.toThrow(RangeError);
  });

  it("stops a script when a host result cannot be serialised", async () => {
    const cyclic: { [key: string]: JsonValue } = {};
    cyclic.self = cyclic;
    const result = await run(`await host("cyclic"); return "done";`, {
      hostFunctions: { cyclic: async () => cyclic },
    });
    expect(failure(result)).toContain("internal error");
  });

  it("caps log output", async () => {
    const result = await run(
      `for (let i = 0; i < 100; i += 1) print("x".repeat(50)); return 1;`,
      { limits: { maxLogChars: 200 } },
    );
    expect(result.ok).toBe(true);
    expect(result.logs.length).toBeLessThan(260);
    expect(result.logs).toContain("[log output truncated]");
  });

  it("runs many scripts in a row without leaking state between them", async () => {
    await run(`globalThis.leak = 42;`);
    const result = await run(`return typeof globalThis.leak;`);
    expect(result).toMatchObject({ ok: true, value: "undefined" });
  });
});
