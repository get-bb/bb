import vm from "node:vm";
import { build } from "vite";
import { describe, expect, it } from "vitest";

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

const PATTERN_MODIFIER = /\(\?(?:[ims]+|[ims]*-[ims]+):/;

interface RegExpLike {
  flags: string;
  test: (input: string) => boolean;
}

interface BundleExports {
  toRegExp: (pattern: string) => RegExpLike;
}

interface BundleModule {
  exports: BundleExports;
}

interface ProbeSelf {
  addEventListener: (type: string) => void;
}

interface ProbeGlobals {
  self?: ProbeSelf;
  postMessage?: () => void;
}

function evaluateOnSafariSixteen(
  code: string,
  globals: ProbeGlobals,
): BundleExports {
  const context = vm.createContext({ ...globals });
  const IntrinsicRegExp: RegExpConstructor = vm.runInContext("RegExp", context);
  function SafariSixteenRegExp(pattern: string | RegExp, flags?: string) {
    if (flags?.includes("v")) {
      throw new SyntaxError("Invalid flags supplied to RegExp constructor.");
    }
    if (!(pattern instanceof RegExp) && PATTERN_MODIFIER.test(pattern)) {
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
  const module: BundleModule = {
    exports: {
      toRegExp: () => {
        throw new Error("bundle did not export toRegExp");
      },
    },
  };
  context.module = module;
  context.exports = module.exports;
  vm.runInContext(code, context, { filename: "bundle.cjs" });
  return module.exports;
}

describe("regex engine feature probes survive the app bundler", () => {
  it("oniguruma-to-es loads and picks a v-less target on Safari 16", async () => {
    const code = await bundle("oniguruma-to-es");

    const { toRegExp } = evaluateOnSafariSixteen(code, {});
    const compiled = toRegExp("[a-c]+");

    expect(compiled.flags).not.toContain("v");
    expect(compiled.test("abc")).toBe(true);
  }, 60_000);

  it("the @pierre/diffs portable worker evaluates on Safari 16", async () => {
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
