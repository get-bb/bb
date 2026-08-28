import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

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
  path: string;
  pattern: string | null;
  line: number;
}

const SDK_CALL =
  /(?:const\s*\{([^}]*)\}\s*=\s*await\s+)?bb\.sdk\.([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\s*\(/g;

function sdkExamples(skill: string): SdkExample[] {
  const found = new Map<string, SdkExample>();
  for (const match of skill.matchAll(SDK_CALL)) {
    const [, pattern, path] = match;
    if (path === undefined) continue;
    const line = skill.slice(0, match.index).split("\n").length;
    found.set(`${path}|${pattern ?? ""}`, {
      path,
      pattern: pattern === undefined ? null : pattern.trim(),
      line,
    });
  }
  return [...found.values()];
}

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
      `declare const result${index}: AwaitedReturn<Sdk${typeIndex(example.path)}>;`,
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
