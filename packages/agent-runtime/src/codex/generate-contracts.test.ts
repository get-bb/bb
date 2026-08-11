import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { codexCompatibility } from "./codex-compatibility.mjs";

const temporaryDirectories: string[] = [];
const generatorPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/generate-codex-contracts.mjs",
);

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "bb-codex-generator-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function installFakeCodex(binDirectory: string): void {
  const executablePath = path.join(binDirectory, "codex");
  writeFileSync(
    executablePath,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log(\`codex-cli \${process.env.FAKE_CODEX_VERSION}\`);
  process.exit(0);
}

const outputDirectory = args[args.indexOf("--out") + 1];
if (args[1] === "generate-ts") {
  mkdirSync(path.join(outputDirectory, "v2"), { recursive: true });
  writeFileSync(
    path.join(outputDirectory, "v2/ThreadItem.ts"),
    '// GENERATED CODE! DO NOT MODIFY BY HAND!\\nimport type { Shared } from "./Shared";\\nexport type ThreadItem = Shared;\\n',
  );
  writeFileSync(
    path.join(outputDirectory, "v2/Shared.ts"),
    '// GENERATED CODE! DO NOT MODIFY BY HAND!\\nexport type Shared = { type: "reasoning"; id: string };\\n',
  );
  process.exit(0);
}

if (args[1] === "generate-json-schema") {
  mkdirSync(path.join(outputDirectory, "v2"), { recursive: true });
  writeFileSync(
    path.join(outputDirectory, "v2/ItemCompletedNotification.json"),
    JSON.stringify({
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: {
        ThreadItem: {
          type: "object",
          required: ["id", "type"],
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["reasoning"] },
            summary: { type: "array", items: { type: "string" }, default: [] },
          },
        },
      },
    }),
  );
  process.exit(0);
}

process.exit(2);
`,
  );
  chmodSync(executablePath, 0o755);
}

function runGenerator(args: {
  binDirectory: string;
  generatedRoot: string;
  version: string;
}) {
  return spawnSync(process.execPath, [generatorPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      BB_CODEX_CONTRACTS_OUTPUT_ROOT: args.generatedRoot,
      FAKE_CODEX_VERSION: args.version,
      PATH: `${args.binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

function snapshotFiles(root: string, relativeDirectory = ""): string[] {
  return readdirSync(path.join(root, relativeDirectory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory()
      ? snapshotFiles(root, relativePath)
      : [
          `${relativePath}\n${readFileSync(path.join(root, relativePath), "utf8")}`,
        ];
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("generate-codex-contracts", () => {
  it("rejects a mismatched Codex version before changing generated files", () => {
    const root = makeTemporaryDirectory();
    const binDirectory = path.join(root, "bin");
    const generatedRoot = path.join(root, "generated");
    mkdirSync(binDirectory);
    mkdirSync(generatedRoot);
    installFakeCodex(binDirectory);
    writeFileSync(path.join(generatedRoot, "sentinel.txt"), "unchanged");

    const result = runGenerator({
      binDirectory,
      generatedRoot,
      version: "0.146.0",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(codexCompatibility.schemaGenerationVersion);
    expect(result.stderr).toContain("0.146.0");
    expect(snapshotFiles(generatedRoot)).toEqual(["sentinel.txt\nunchanged"]);
  });

  it("reconciles the managed closure and produces stable provenance", () => {
    const root = makeTemporaryDirectory();
    const binDirectory = path.join(root, "bin");
    const generatedRoot = path.join(root, "generated");
    mkdirSync(binDirectory);
    mkdirSync(path.join(generatedRoot, "schema"), { recursive: true });
    installFakeCodex(binDirectory);
    writeFileSync(path.join(generatedRoot, "README.md"), "# Generated\n");
    writeFileSync(path.join(generatedRoot, "schema/stale.ts"), "obsolete");
    writeFileSync(
      path.join(generatedRoot, "THREAD_ITEM_GENERATION.json"),
      JSON.stringify({ generatedFiles: ["schema/stale.ts"] }),
    );

    const firstRun = runGenerator({
      binDirectory,
      generatedRoot,
      version: codexCompatibility.schemaGenerationVersion,
    });
    expect(firstRun.status).toBe(0);
    expect(() =>
      readFileSync(path.join(generatedRoot, "schema/stale.ts")),
    ).toThrow();
    expect(
      readFileSync(
        path.join(generatedRoot, "runtime/ThreadItem.schema.ts"),
        "utf8",
      ),
    ).toContain(
      `Generated from Codex ${codexCompatibility.schemaGenerationVersion}`,
    );
    expect(
      readFileSync(path.join(generatedRoot, "README.md"), "utf8"),
    ).toContain(
      `schema-generation-version=${codexCompatibility.schemaGenerationVersion}`,
    );
    const firstSnapshot = snapshotFiles(generatedRoot);

    const secondRun = runGenerator({
      binDirectory,
      generatedRoot,
      version: codexCompatibility.schemaGenerationVersion,
    });
    expect(secondRun.status).toBe(0);
    expect(snapshotFiles(generatedRoot)).toEqual(firstSnapshot);
  });
});
