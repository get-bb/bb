import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/**
 * The bb-plugin-authoring skill is the first thing an agent reads before
 * writing a plugin, and its examples get copied verbatim. A wrong one is worse
 * than a missing one: the author either ships the bug or burns a debugging
 * round trip rediscovering the real signature in the 700KB of bundled
 * declarations.
 *
 * plugin-authoring-docs.test.ts already proves the skill *mentions* every API
 * member. Nothing proved the examples *compile*, which is how
 * `const { threads } = await bb.sdk.threads.list(...)` survived: `threads.list`
 * resolves to a plain array, so the documented destructuring silently yields
 * `undefined` for every reader who copies it.
 *
 * This compiles every `bb.sdk.<path>(` the skill shows against the SDK's own
 * declarations: indexing the type proves the method exists, and where the
 * skill destructures the awaited result, that shape is checked against what
 * the method really returns. Arguments are deliberately not reconstructed —
 * only what the example claims to call and receive is under test, which is
 * exactly the class of bug that slipped through. The probe is generated from
 * SKILL.md at run time, so a new example is covered the moment it is written
 * and no list here can go stale.
 */

const SKILL_PATH = fileURLToPath(
  new URL(
    "../../../src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md",
    import.meta.url,
  ),
);

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const pluginSdkEntry = join(
  repoRoot,
  "packages",
  "plugin-sdk",
  "src",
  "index.ts",
);
const tsc = join(repoRoot, "node_modules", ".bin", "tsc");

interface SdkExample {
  /** Dotted path under `bb.sdk`, e.g. `threads.list`. */
  path: string;
  /** The destructuring the skill applies to the result, when it shows one. */
  pattern: string | null;
  line: number;
}

/** Any `bb.sdk.<path>(` the skill shows, with the destructuring in front of it. */
const SDK_CALL =
  /(?:const\s*\{([^}]*)\}\s*=\s*await\s+)?bb\.sdk\.([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\s*\(/g;

function sdkExamples(skill: string): SdkExample[] {
  const found = new Map<string, SdkExample>();
  for (const match of skill.matchAll(SDK_CALL)) {
    const [, pattern, path] = match;
    if (path === undefined) continue;
    const line = skill.slice(0, match.index).split("\n").length;
    // One entry per (path, destructuring): the same method shown twice needs
    // checking once, but two different destructurings of it need both.
    found.set(`${path}|${pattern ?? ""}`, {
      path,
      pattern: pattern === undefined ? null : pattern.trim(),
      line,
    });
  }
  return [...found.values()];
}

/** `threads.list` → `["threads"]["list"]`, for indexing the SDK type. */
function typeIndex(path: string): string {
  return path
    .split(".")
    .map((segment) => `[${JSON.stringify(segment)}]`)
    .join("");
}

function probeSource(examples: readonly SdkExample[]): string {
  return [
    `import type { BbPluginApi } from "@get-bb/plugin-sdk";`,
    ``,
    `type AwaitedReturn<F> = F extends (...args: never[]) => infer R`,
    `  ? R extends Promise<infer V>`,
    `    ? V`,
    `    : R`,
    `  : never;`,
    `type Sdk = BbPluginApi["sdk"];`,
    ``,
    ...examples.flatMap((example, index) => [
      `// SKILL.md:${example.line} — bb.sdk.${example.path}`,
      // Indexing the SDK type proves the method exists and is callable; a
      // renamed or invented one fails right here.
      `declare const result${index}: AwaitedReturn<Sdk${typeIndex(example.path)}>;`,
      // …and where the skill destructures the result, that shape is checked
      // against what the method actually returns.
      example.pattern === null
        ? `void result${index};`
        : `const { ${example.pattern} } = result${index};`,
      ``,
    ]),
  ].join("\n");
}

const PROBE_TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    noEmit: true,
    skipLibCheck: true,
    noUnusedLocals: false,
    types: [],
    paths: { "@get-bb/plugin-sdk": [pluginSdkEntry] },
  },
  files: ["probe.ts"],
};

describe("bb-plugin-authoring skill examples", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-doc-examples-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("calls and destructures bb.sdk the way the SDK actually declares it", async () => {
    const skill = readFileSync(SKILL_PATH, "utf8");
    const examples = sdkExamples(skill);
    // A skill that stops showing sdk calls at all is a regression of its own:
    // the SDK area is the half of the API a plugin cannot discover from the
    // registration surface.
    expect(examples.length).toBeGreaterThan(0);

    await writeFile(join(workDir, "probe.ts"), probeSource(examples), "utf8");
    await writeFile(
      join(workDir, "tsconfig.json"),
      `${JSON.stringify(PROBE_TSCONFIG, null, 2)}\n`,
      "utf8",
    );

    let diagnostics = "";
    try {
      await execFileAsync(tsc, ["--project", workDir]);
    } catch (cause) {
      diagnostics = `${(cause as { stdout?: string }).stdout ?? ""}${
        (cause as { stderr?: string }).stderr ?? ""
      }`.trim();
    }

    expect(diagnostics).toBe("");
  }, 60_000);
});
