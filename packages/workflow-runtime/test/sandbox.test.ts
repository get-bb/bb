import { describe, expect, it } from "vitest";
import type { WorkflowGlobals } from "../src/dsl-types.js";
import { parseWorkflow, WorkflowSyntaxError } from "../src/meta-parser.js";
import {
  runInSandbox,
  WorkflowAbortedError,
  WorkflowTimeoutError,
} from "../src/sandbox.js";

function fakeGlobals(
  overrides: Partial<WorkflowGlobals> = {},
): WorkflowGlobals {
  return {
    agent: async (prompt: string) => `ran:${prompt}`,
    parallel: async (thunks) => Promise.all(thunks.map((thunk) => thunk())),
    pipeline: async (items) => items,
    phase: () => {},
    log: () => {},
    now: () => 0,
    random: () => 0,
    budget: {
      total: null,
      spent: () => 0,
      remaining: () => Number.POSITIVE_INFINITY,
    },
    args: undefined,
    ...overrides,
  };
}

describe("parseWorkflow", () => {
  it("extracts a leading meta literal and returns the body", () => {
    const src = `export const meta = { name: "n", description: "d" }\nconst x = 1\nreturn x\n`;
    const { meta, body } = parseWorkflow(src);
    expect(meta.name).toBe("n");
    expect(meta.description).toBe("d");
    expect(body).toMatch(/const x = 1/);
    expect(body).toMatch(/return x/);
  });

  it("allows leading line and block comments before meta", () => {
    const src = `// a leading comment\n/* block\n comment */\nexport const meta = { name: "n", description: "d" }\nreturn 1\n`;
    expect(parseWorkflow(src).meta.name).toBe("n");
  });

  it("consumes an optional trailing semicolon after the meta literal", () => {
    const src = `export const meta = { name: "n", description: "d" };\nreturn 1\n`;
    expect(parseWorkflow(src).body).not.toMatch(/;/);
  });

  it("rejects code before a non-leading meta instead of silently discarding it", () => {
    const src = `const sneaky = doSomething()\nexport const meta = { name: "n", description: "d" }\nreturn 1\n`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowSyntaxError);
  });

  it("rejects a file without a meta declaration", () => {
    expect(() => parseWorkflow(`return 1\n`)).toThrow(WorkflowSyntaxError);
  });

  it("rejects a non-object meta and a meta failing schema validation", () => {
    expect(() => parseWorkflow(`export const meta = 5\n`)).toThrow(
      WorkflowSyntaxError,
    );
    expect(() => parseWorkflow(`export const meta = { name: "n" }\n`)).toThrow(
      WorkflowSyntaxError,
    );
  });

  it("rejects a meta containing an IIFE structurally, without evaluating it", () => {
    const src = `export const meta = { name: (() => "x")(), description: "d" }\nreturn 1\n`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowSyntaxError);
    expect(() => parseWorkflow(src)).toThrow(/meta must be a pure literal/);
  });

  it("rejects a meta built by a call expression instead of accepting its argument literal", () => {
    const src = `export const meta = makeMeta({ name: "n", description: "d" })\nreturn 1\n`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowSyntaxError);
    expect(() => parseWorkflow(src)).toThrow(/pure object literal/);
  });

  it("rejects code between `=` and the literal instead of silently blanking it from the body", () => {
    const src = `export const meta = f(), { name: "n", description: "d" }\nreturn 1\n`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowSyntaxError);
    expect(() => parseWorkflow(src)).toThrow(/pure object literal/);
  });

  it("keeps body content on its original 1-based line numbers", () => {
    const src = `export const meta = { name: "n", description: "d" }\n\nconst marker = 1\n`;
    const lines = parseWorkflow(src).body.split("\n");
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("const marker = 1");
  });

  it("preserves downstream line numbers for a multi-line meta literal", () => {
    const src = `export const meta = {\n  name: "n",\n  description: "d",\n}\nconst onLineFive = 5\n`;
    const lines = parseWorkflow(src).body.split("\n");
    expect(lines[4]).toBe("const onLineFive = 5");
  });

  it("reports the true workflow line number in runtime stack traces", async () => {
    // meta(1), blank(2), throw on line 3.
    const src = `export const meta = { name: "n", description: "d" }\n\nthrow new Error("boom")\n`;
    const { body } = parseWorkflow(src);
    const failure = await runInSandbox({
      body,
      filename: "wf.js",
      globals: fakeGlobals(),
    }).then(
      () => undefined,
      (err: Error) => err,
    );
    expect(failure?.message).toMatch(/boom/);
    expect(failure?.stack).toMatch(/wf\.js:3/);
  });
});

function bodyOf(source: string): string {
  return parseWorkflow(source).body;
}

const META_LINE = `export const meta = { name: "n", description: "d" }`;

describe("runInSandbox", () => {
  it("runs the body and resolves its return value", async () => {
    const body = bodyOf(`${META_LINE}\nreturn 1 + 2\n`);
    await expect(
      runInSandbox({ body, filename: "wf.js", globals: fakeGlobals() }),
    ).resolves.toBe(3);
  });

  it("exposes the injected globals", async () => {
    const calls: string[] = [];
    const body = bodyOf(`${META_LINE}\nlog("hi")\nreturn await agent("p")\n`);
    const out = await runInSandbox({
      body,
      filename: "wf.js",
      globals: fakeGlobals({ log: (message: string) => calls.push(message) }),
    });
    expect(calls).toEqual(["hi"]);
    expect(out).toBe("ran:p");
  });

  it("makes Date.now() and Math.random() throw inside the vm", async () => {
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn Date.now()\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/Date\.now/);
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn Math.random()\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/Math\.random/);
  });

  it("makes an argless new Date() throw while keeping explicit dates usable", async () => {
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn new Date()\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/unavailable in workflows/);
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn new Date(86400000).toISOString()\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).resolves.toBe("1970-01-02T00:00:00.000Z");
  });

  it("seals the (new Date(x)).constructor.now() backdoor", async () => {
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn new Date(0).constructor.now()\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/unavailable in workflows/);
  });

  it("freezes Math so the random shim cannot be reassigned", async () => {
    const body = bodyOf(
      `${META_LINE}\nMath.random = function () { return 0.5 }\nreturn Math.random()\n`,
    );
    await expect(
      runInSandbox({ body, filename: "wf.js", globals: fakeGlobals() }),
    ).rejects.toThrow(/read only/i);
  });

  it("kills codegen from strings: eval and new Function both throw", async () => {
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn eval("1")\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/code generation/i);
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn new Function("return 1")()\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/code generation/i);
  });

  it("blocks dynamic import", async () => {
    // With --experimental-vm-modules the blocking callback throws our message; without the flag
    // Node rejects the import itself before invoking it. Both paths leave import() dead.
    await expect(
      runInSandbox({
        body: bodyOf(`${META_LINE}\nreturn await import("node:fs")\n`),
        filename: "wf.js",
        globals: fakeGlobals(),
      }),
    ).rejects.toThrow(/import\(\) is not available|--experimental-vm-modules/);
  });

  it("bounds runaway synchronous execution with syncTimeoutMs", async () => {
    const body = bodyOf(`${META_LINE}\nfor (;;) {}\n`);
    await expect(
      runInSandbox({
        body,
        filename: "wf.js",
        globals: fakeGlobals(),
        syncTimeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it("aborts an async hang via the signal instead of running forever", async () => {
    const body = bodyOf(
      `${META_LINE}\nawait new Promise(() => {})\nreturn 1\n`,
    );
    const controller = new AbortController();
    const pending = runInSandbox({
      body,
      filename: "wf.js",
      globals: fakeGlobals(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(WorkflowAbortedError);
  });

  it("rejects immediately on an already-aborted signal without running the sync prefix", async () => {
    const calls: string[] = [];
    const body = bodyOf(`${META_LINE}\nlog("ran")\nreturn 1\n`);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runInSandbox({
        body,
        filename: "wf.js",
        globals: fakeGlobals({ log: (message: string) => calls.push(message) }),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(WorkflowAbortedError);
    expect(calls).toEqual([]);
  });

  it("caps a runaway async workflow with execTimeoutMs", async () => {
    const body = bodyOf(
      `${META_LINE}\nawait new Promise(() => {})\nreturn 1\n`,
    );
    await expect(
      runInSandbox({
        body,
        filename: "wf.js",
        globals: fakeGlobals(),
        execTimeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(WorkflowTimeoutError);
  });

  it("still resolves a normal workflow when a signal is supplied", async () => {
    const body = bodyOf(`${META_LINE}\nreturn await agent("p")\n`);
    await expect(
      runInSandbox({
        body,
        filename: "wf.js",
        globals: fakeGlobals({ agent: async () => "ok" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toBe("ok");
  });

  it("propagates an async error with a signal attached", async () => {
    const body = bodyOf(
      `${META_LINE}\nawait Promise.resolve()\nthrow new Error("late")\n`,
    );
    await expect(
      runInSandbox({
        body,
        filename: "wf.js",
        globals: fakeGlobals(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/late/);
  });

  it("rejects TypeScript-flavored bodies with a workflow syntax error", async () => {
    const body = bodyOf(`${META_LINE}\nconst x: number = 1\nreturn x\n`);
    await expect(
      runInSandbox({ body, filename: "wf.js", globals: fakeGlobals() }),
    ).rejects.toThrow(WorkflowSyntaxError);
  });
});
