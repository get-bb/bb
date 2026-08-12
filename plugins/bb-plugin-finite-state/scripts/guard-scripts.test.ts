import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const frozenScript = path.join(import.meta.dirname, "check-frozen-artifacts.mjs");
const dependencyScript = path.join(
  import.meta.dirname,
  "check-dependency-freeze.mjs",
);
const eslintBinary = path.join(repositoryRoot, "node_modules/.bin/eslint");
const pluginRoot = "plugins/bb-plugin-finite-state";
const fixtureTree = `${pluginRoot}/test/mock-remote/fixtures/**`;
const artifacts = [
  `${pluginRoot}/server.ts`,
  `${pluginRoot}/app.tsx`,
  `${pluginRoot}/shared/contract.ts`,
  `${pluginRoot}/lib/store/schema.ts`,
  `${pluginRoot}/lib/sync/registry.ts`,
  `${pluginRoot}/lib/remote/types.ts`,
  fixtureTree,
] as const;
const temporaryRoots: string[] = [];
const contents: Record<string, string> = {
  [`${pluginRoot}/server.ts`]: "export default function plugin() {}\n",
  [`${pluginRoot}/app.tsx`]: "export default function App() { return <main />; }\n",
  [`${pluginRoot}/shared/contract.ts`]:
    "export const CONTRACT_VERSION = 1 as const;\n",
  [`${pluginRoot}/lib/store/schema.ts`]: "export const migrations = [];\n",
  [`${pluginRoot}/lib/sync/registry.ts`]: "export const entities = {};\n",
  [`${pluginRoot}/lib/remote/types.ts`]: "export interface Remote {}\n",
  [`${pluginRoot}/test/mock-remote/fixtures/base.json`]: '{"fixture":true}\n',
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function write(root: string, relativePath: string, value: string) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}

function run(script: string, root: string, ...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [script, "--root", root, ...args],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function lint(source: string, relativePath: string) {
  const result = spawnSync(
    eslintBinary,
    ["--stdin", "--stdin-filename", relativePath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: source,
    },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function amendment(
  id: string,
  paths: readonly string[],
  contractVersion = "n/a",
) {
  return `### ${id} — fixture amendment

- Status: approved
- Artifacts:
${paths.map((artifact) => `  - \`${artifact}\``).join("\n")}
- Contract version: ${contractVersion}
`;
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "finite-state-guards-"));
  temporaryRoots.push(root);
  await Promise.all(
    Object.entries(contents).map(([relativePath, value]) =>
      write(root, relativePath, value),
    ),
  );
  const manifest = {
    name: "bb-plugin-finite-state",
    dependencies: { yaml: "^2.9.0", zod: "^4.3.6" },
    devDependencies: {},
    peerDependencies: {},
    optionalDependencies: {},
  };
  const dependencyBaseline = {
    dependencies: { yaml: "^2.9.0", zod: "^4.3.6" },
    devDependencies: {},
    peerDependencies: {},
    optionalDependencies: {},
  };
  const fixtureContents = contents[`${pluginRoot}/test/mock-remote/fixtures/base.json`];
  if (fixtureContents === undefined) throw new Error("Missing fixture-tree contents");
  const baseline = {
    version: 1,
    source: { mergeCommit: "0".repeat(40) },
    contractVersion: 1,
    artifacts: Object.fromEntries(
      artifacts.map((artifact) => {
        const fileContents = contents[artifact];
        if (artifact !== fixtureTree && fileContents === undefined) {
          throw new Error(`Missing fixture contents for ${artifact}`);
        }
        const hash =
          artifact === fixtureTree
            ? sha256(`base.json\0${sha256(fixtureContents)}\n`)
            : sha256(fileContents);
        return [
          artifact,
          artifact === fixtureTree
            ? { treeSha256: hash, amendment: null, active: true }
            : { sha256: hash, amendment: null, active: true },
        ];
      }),
    ),
    dependencyBaseline,
  };
  await write(root, `${pluginRoot}/package.json`, JSON.stringify(manifest));
  await write(
    root,
    `${pluginRoot}/frozen-artifacts.json`,
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
  await write(
    root,
    `${pluginRoot}/AMENDMENTS.md`,
    `# Amendments\n\n\`\`\`md\n${amendment("AMD-0001", [`${pluginRoot}/app.tsx`])}\`\`\`\n`,
  );
  await write(root, "package.json", JSON.stringify({ pnpm: { overrides: { zod: "4.3.6" } } }));
  await write(
    root,
    "pnpm-lock.yaml",
    `lockfileVersion: '9.0'

importers:

  plugins/bb-plugin-finite-state:
    dependencies:
      zod:
        specifier: 4.3.6
        version: 4.3.6

packages:

  zod@4.3.6:
    resolution: {integrity: sha512-fixture}
`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("lean contract tripwires", () => {
  it("accepts the frozen hash/tree and dependency baselines", async () => {
    const root = await fixtureRoot();
    expect(run(frozenScript, root).status).toBe(0);
    expect(run(dependencyScript, root).status).toBe(0);
  });

  it("names controlled frozen-file and fixture-tree mutations", async () => {
    const root = await fixtureRoot();
    const appPath = `${pluginRoot}/app.tsx`;
    await write(root, appPath, "export default function Changed() { return null; }\n");
    expect(run(frozenScript, root).output).toContain(appPath);

    const originalApp = contents[appPath];
    if (originalApp === undefined) throw new Error("Missing app fixture contents");
    await write(root, appPath, originalApp);
    await write(root, `${pluginRoot}/test/mock-remote/fixtures/extra.json`, "{}\n");
    expect(run(frozenScript, root).output).toContain(fixtureTree);
  });

  it("does not treat the fenced AMD-0001 documentation example as approval", async () => {
    const root = await fixtureRoot();
    await write(
      root,
      `${pluginRoot}/app.tsx`,
      "export default function Changed() { return null; }\n",
    );
    const result = run(frozenScript, root, "--accept", "AMD-0001");
    expect(result.status).toBe(1);
    expect(result.output).toContain("not a structured approved entry");
  });

  it("accepts only a real structured approved amendment", async () => {
    const root = await fixtureRoot();
    const appPath = `${pluginRoot}/app.tsx`;
    await write(root, appPath, "export default function Changed() { return null; }\n");
    await write(
      root,
      `${pluginRoot}/AMENDMENTS.md`,
      `# Amendments\n\n${amendment("AMD-0002", [appPath])}`,
    );
    expect(run(frozenScript, root, "--accept", "AMD-0002").status).toBe(0);
    expect(run(frozenScript, root).status).toBe(0);
    const baseline = JSON.parse(
      await readFile(path.join(root, `${pluginRoot}/frozen-artifacts.json`), "utf8"),
    );
    expect(baseline.artifacts[appPath].amendment).toBe("AMD-0002");
  });

  it("refuses to replay an amendment already recorded on a baseline entry", async () => {
    const root = await fixtureRoot();
    const appPath = `${pluginRoot}/app.tsx`;
    await write(root, appPath, "export default function Changed() { return null; }\n");
    await write(
      root,
      `${pluginRoot}/AMENDMENTS.md`,
      `# Amendments\n\n${amendment("AMD-0002", [appPath])}`,
    );
    expect(run(frozenScript, root, "--accept", "AMD-0002").status).toBe(0);

    await write(root, appPath, "export default function ChangedAgain() { return null; }\n");
    const replay = run(frozenScript, root, "--accept", "AMD-0002");
    expect(replay.status).toBe(1);
    expect(replay.output).toContain("already recorded");
    expect(replay.output).toContain("cannot be reused");
  });

  it("runs the frozen check through a symlinked script path", async () => {
    const root = await fixtureRoot();
    const linkedScript = path.join(root, "check-frozen-artifacts-link.mjs");
    await symlink(frozenScript, linkedScript);

    const result = run(linkedScript, root);
    expect(result.status).toBe(0);
    expect(result.output).toBe("Frozen artifact baseline is intact.\n");
  });

  it("rejects Zod declaration and lockfile resolution drift", async () => {
    const root = await fixtureRoot();
    await write(
      root,
      `${pluginRoot}/package.json`,
      JSON.stringify({ dependencies: { yaml: "^2.9.0", zod: "npm:zod@4.3.6" } }),
    );
    expect(run(dependencyScript, root).output).toContain(
      "Plugin dependency freeze drift",
    );

    await write(
      root,
      "pnpm-lock.yaml",
      `${await readFile(path.join(root, "pnpm-lock.yaml"), "utf8")}\n  zod@4.4.0:\n`,
    );
    await write(
      root,
      `${pluginRoot}/package.json`,
      JSON.stringify({
        dependencies: { yaml: "^2.9.0", zod: "^4.3.6" },
        devDependencies: {},
        peerDependencies: {},
        optionalDependencies: {},
      }),
    );
    expect(run(dependencyScript, root).output).toContain(
      "exactly one zod package resolution",
    );
  });

  it("rejects forbidden colors and non-Hugeicons imports across plugin TypeScript", () => {
    const result = lint(
      `import { Star } from "lucide-react";
export const accentColor = "#1a2b3c";
export const neutralColor = "oklch(0.7 0.02 250)";
export const classes = "bg-[#123456] border-[rgb(1_2_3)]";
export const icon = Star;
`,
      `${pluginRoot}/lib/eslint-negative-probe.ts`,
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("no-restricted-imports");
    expect(result.output).toContain("not raw hex values");
    expect(result.output).toContain("not raw oklch() values");
    expect(result.output).toContain("not arbitrary color utilities");
  });

  it("allows identifiers, non-color utilities, tokens, and Hugeicons", () => {
    const result = lint(
      `import { HugeiconsIcon } from "@hugeicons/react";
import { Alert01Icon } from "@hugeicons/core-free-icons";
export const finding = "Finding #12345";
export const cve = "CVE-2026-deadbeef";
export const sha = "sha256:deadbeef12345678";
export const classes = "from-[10%] bg-[url(/assets/grid.svg)] bg-fs-surface";
export const icon = { HugeiconsIcon, Alert01Icon };
`,
      `${pluginRoot}/lanes/eslint-positive-probe.ts`,
    );

    expect(result.status).toBe(0);
    expect(result.output).toBe("");
  });
});
