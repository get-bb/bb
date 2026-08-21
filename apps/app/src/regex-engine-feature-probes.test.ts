// Shiki's JavaScript regex engine (oniguruma-to-es) probes the runtime at
// module top level with
// `try { new RegExp("[[]]", "v") } catch { return false } return true`.
// Rolldown and the oxc minifier treat `new RegExp(<literal>, <literal>)` as
// pure, drop it from the try block and fold the probe to `true`. The next
// statement then calls `RegExp("[[^a]]", "v")` unguarded and throws on every
// engine without the `v` flag (Safari/iOS 16.x), which rejects the whole
// route chunk and blanks the app (#1603). patches/oniguruma-to-es and
// patches/@pierre__diffs (whose worker-portable.js inlines its own copy of
// oniguruma-to-es) rewrite the probes as `Reflect.construct(RegExp, [...])`,
// which the bundler cannot prove pure. These tests bundle that code the way
// the app build does and evaluate the result on a Safari 16-like RegExp.
import vm from "node:vm";
import { build } from "vite";
import { describe, expect, it } from "vitest";

/** Bundles one entry with the app's Vite/Rolldown build, minified. */
async function bundle(input: string): Promise<string> {
  const result = await build({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      rollupOptions: {
        input,
        preserveEntrySignatures: "strict",
        output: { format: "cjs", entryFileNames: "entry.cjs" },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!("output" in output)) continue;
    for (const chunk of output.output) {
      if (chunk.type === "chunk" && chunk.isEntry) return chunk.code;
    }
  }
  throw new Error("vite build produced no entry chunk");
}

// `(?i:...)` / `(?-i:...)` pattern modifiers, the other feature the engine
// probes for. Safari 16 has neither modifiers nor the `v` flag.
const PATTERN_MODIFIER = /\(\?(?:[ims]+|[ims]*-[ims]+):/;

/**
 * Evaluates a CommonJS bundle in a context whose `RegExp` constructor behaves
 * like Safari 16.x: it rejects the `v` flag and pattern modifiers. Regex
 * literals keep working because they use the context's intrinsic, not the
 * global binding. Returns the bundle's `module.exports`.
 */
function evaluateOnSafariSixteen(
  code: string,
  globals: Record<string, unknown>,
): Record<string, unknown> {
  const context = vm.createContext({ ...globals });
  const IntrinsicRegExp: RegExpConstructor = vm.runInContext("RegExp", context);
  function SafariSixteenRegExp(
    this: unknown,
    pattern: string | RegExp,
    flags?: string,
  ) {
    if (flags?.includes("v")) {
      throw new SyntaxError("Invalid flags supplied to RegExp constructor.");
    }
    if (typeof pattern === "string" && PATTERN_MODIFIER.test(pattern)) {
      throw new SyntaxError(
        "Invalid regular expression: invalid group specifier name",
      );
    }
    return flags === undefined
      ? new IntrinsicRegExp(pattern)
      : new IntrinsicRegExp(pattern, flags);
  }
  SafariSixteenRegExp.prototype = IntrinsicRegExp.prototype;
  context.RegExp = SafariSixteenRegExp;
  const module: { exports: Record<string, unknown> } = { exports: {} };
  context.module = module;
  context.exports = module.exports;
  vm.runInContext(code, context, { filename: "bundle.cjs" });
  return module.exports;
}

function isRegExpLike(
  value: unknown,
): value is { flags: string; test: (input: string) => boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "flags" in value &&
    typeof value.flags === "string" &&
    "test" in value &&
    typeof value.test === "function"
  );
}

describe("regex engine feature probes survive the app bundler", () => {
  it("oniguruma-to-es loads and picks a v-less target on Safari 16", async () => {
    const code = await bundle("oniguruma-to-es");

    const { toRegExp } = evaluateOnSafariSixteen(code, {});
    if (typeof toRegExp !== "function") {
      throw new Error("bundle did not export toRegExp");
    }
    // The result is a RegExp from the vm realm, so `instanceof` cannot see it.
    const compiled: unknown = toRegExp("[a-c]+");
    if (!isRegExpLike(compiled)) {
      throw new Error("toRegExp did not return a RegExp");
    }

    expect(compiled.flags).not.toContain("v");
    expect(compiled.test("abc")).toBe(true);
  }, 60_000);

  it("the @pierre/diffs portable worker evaluates on Safari 16", async () => {
    // diff-worker-pool.ts loads this file as a module worker; it inlines its
    // own oniguruma-to-es, so the package patch alone does not cover it.
    const code = await bundle("@pierre/diffs/worker/worker-portable.js");

    const listeners: string[] = [];
    const self = {
      addEventListener: (type: string) => {
        listeners.push(type);
      },
    };
    evaluateOnSafariSixteen(code, { self, postMessage: () => {} });

    expect(listeners).toContain("message");
  }, 60_000);
});
