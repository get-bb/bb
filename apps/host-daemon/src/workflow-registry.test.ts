import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_WORKFLOW_NAMES } from "@bb/workflow-runtime";
import {
  listWorkflowRegistry,
  MAX_WORKFLOW_FILE_BYTES,
  resolveWorkflowRegistryName,
} from "./workflow-registry.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

function workflowSource(args: {
  name: string;
  description?: string;
  whenToUse?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultSandbox?: string;
}): string {
  const optional = (key: string, value: string | undefined): string =>
    value !== undefined ? `, ${key}: "${value}"` : "";
  return `export const meta = { name: "${args.name}", description: "${
    args.description ?? `${args.name} description`
  }"${optional("whenToUse", args.whenToUse)}${optional(
    "defaultProvider",
    args.defaultProvider,
  )}${optional("defaultModel", args.defaultModel)}${optional(
    "defaultSandbox",
    args.defaultSandbox,
  )} };\nreturn await agent("do the ${args.name} work");\n`;
}

async function writeWorkflowFile(args: {
  dir: string;
  fileName: string;
  source: string;
}): Promise<void> {
  await mkdir(args.dir, { recursive: true });
  await writeFile(join(args.dir, args.fileName), args.source);
}

describe("workflow registry", () => {
  it("lists builtins when no project or user workflows exist", async () => {
    const rootPath = await makeTempDir("bb-wf-registry-root-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    await mkdir(join(rootPath, ".git"), { recursive: true });

    const workflows = await listWorkflowRegistry({ rootPath, dataDir });

    expect(workflows.map((workflow) => workflow.name).sort()).toEqual(
      [...BUILTIN_WORKFLOW_NAMES].sort(),
    );
    expect(workflows.every((workflow) => workflow.tier === "builtin")).toBe(
      true,
    );
    expect(
      workflows.every((workflow) => workflow.description.length > 0),
    ).toBe(true);
  });

  it("walks .bb/workflows up to the .git boundary, nearest first", async () => {
    const outerDir = await makeTempDir("bb-wf-registry-outer-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    const repoRoot = join(outerDir, "repo");
    await mkdir(join(repoRoot, ".git"), { recursive: true });
    const nested = join(repoRoot, "packages", "app");
    await mkdir(nested, { recursive: true });

    // Above the repo boundary: must never be scanned.
    await writeWorkflowFile({
      dir: join(outerDir, ".bb", "workflows"),
      fileName: "outside.workflow.js",
      source: workflowSource({ name: "outside-boundary" }),
    });
    await writeWorkflowFile({
      dir: join(repoRoot, ".bb", "workflows"),
      fileName: "shared.workflow.js",
      source: workflowSource({
        name: "shared",
        description: "repo-root version",
      }),
    });
    await writeWorkflowFile({
      dir: join(repoRoot, ".bb", "workflows"),
      fileName: "root-only.workflow.js",
      source: workflowSource({ name: "root-only" }),
    });
    await writeWorkflowFile({
      dir: join(nested, ".bb", "workflows"),
      fileName: "shared.workflow.js",
      source: workflowSource({ name: "shared", description: "nearest version" }),
    });

    const workflows = await listWorkflowRegistry({ rootPath: nested, dataDir });
    const byName = new Map(
      workflows.map((workflow) => [workflow.name, workflow]),
    );

    expect(byName.get("shared")).toMatchObject({
      tier: "project",
      description: "nearest version",
    });
    expect(byName.get("root-only")).toMatchObject({ tier: "project" });
    expect(byName.has("outside-boundary")).toBe(false);
  });

  it("passes meta-declared run defaults through to listings, omitting undeclared ones", async () => {
    const rootPath = await makeTempDir("bb-wf-registry-root-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    await mkdir(join(rootPath, ".git"), { recursive: true });
    await writeWorkflowFile({
      dir: join(rootPath, ".bb", "workflows"),
      fileName: "with-defaults.workflow.js",
      source: workflowSource({
        name: "with-defaults",
        defaultProvider: "codex",
        defaultModel: "fake-model",
        defaultSandbox: "workspace-write",
      }),
    });
    await writeWorkflowFile({
      dir: join(rootPath, ".bb", "workflows"),
      fileName: "without-defaults.workflow.js",
      source: workflowSource({ name: "without-defaults" }),
    });

    const workflows = await listWorkflowRegistry({ rootPath, dataDir });
    const byName = new Map(
      workflows.map((workflow) => [workflow.name, workflow]),
    );

    expect(byName.get("with-defaults")).toMatchObject({
      tier: "project",
      defaultProvider: "codex",
      defaultModel: "fake-model",
      defaultSandbox: "workspace-write",
    });
    // Absent = the author declared no default (the contract's omission
    // semantics) — never a null/empty placeholder.
    const bare = byName.get("without-defaults");
    expect(bare).toBeDefined();
    expect(bare).not.toHaveProperty("defaultProvider");
    expect(bare).not.toHaveProperty("defaultModel");
    expect(bare).not.toHaveProperty("defaultSandbox");
  });

  it("shadows winners-only: project over user over builtin", async () => {
    const rootPath = await makeTempDir("bb-wf-registry-root-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    await mkdir(join(rootPath, ".git"), { recursive: true });

    const builtinName = BUILTIN_WORKFLOW_NAMES[0];
    await writeWorkflowFile({
      dir: join(dataDir, "workflows"),
      fileName: "user.workflow.js",
      source: workflowSource({
        name: builtinName,
        description: "user-tier shadow of a builtin",
      }),
    });
    await writeWorkflowFile({
      dir: join(dataDir, "workflows"),
      fileName: "both.workflow.js",
      source: workflowSource({ name: "both", description: "user version" }),
    });
    await writeWorkflowFile({
      dir: join(rootPath, ".bb", "workflows"),
      fileName: "both.workflow.js",
      source: workflowSource({ name: "both", description: "project version" }),
    });

    const workflows = await listWorkflowRegistry({ rootPath, dataDir });
    const byName = new Map(
      workflows.map((workflow) => [workflow.name, workflow]),
    );

    expect(byName.get("both")).toMatchObject({
      tier: "project",
      description: "project version",
    });
    expect(byName.get(builtinName)).toMatchObject({
      tier: "user",
      description: "user-tier shadow of a builtin",
    });
  });

  it("skips oversize, invalid-meta, and non-js files without failing the scan", async () => {
    const rootPath = await makeTempDir("bb-wf-registry-root-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    await mkdir(join(rootPath, ".git"), { recursive: true });
    const dir = join(rootPath, ".bb", "workflows");

    await writeWorkflowFile({
      dir,
      fileName: "valid.workflow.js",
      source: workflowSource({ name: "valid", whenToUse: "always" }),
    });
    await writeWorkflowFile({
      dir,
      fileName: "huge.workflow.js",
      source:
        workflowSource({ name: "huge" }) +
        `// ${"x".repeat(MAX_WORKFLOW_FILE_BYTES)}\n`,
    });
    await writeWorkflowFile({
      dir,
      fileName: "invalid-meta.workflow.js",
      source: `export const meta = { name: (() => "evil")() };\nreturn 1;\n`,
    });
    await writeWorkflowFile({
      dir,
      fileName: "notes.txt",
      source: workflowSource({ name: "not-a-js-file" }),
    });

    const workflows = await listWorkflowRegistry({ rootPath, dataDir });
    const projectNames = workflows
      .filter((workflow) => workflow.tier === "project")
      .map((workflow) => workflow.name);

    expect(projectNames).toEqual(["valid"]);
    expect(
      workflows.find((workflow) => workflow.name === "valid")?.whenToUse,
    ).toBe("always");
  });

  it("resolves raw source with its sha256 by meta name", async () => {
    const rootPath = await makeTempDir("bb-wf-registry-root-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    await mkdir(join(rootPath, ".git"), { recursive: true });
    const source = workflowSource({ name: "release-notes" });
    await writeWorkflowFile({
      dir: join(rootPath, ".bb", "workflows"),
      fileName: "anything.workflow.js",
      source,
    });

    const resolved = await resolveWorkflowRegistryName({
      rootPath,
      dataDir,
      name: "release-notes",
    });

    expect(resolved).toEqual({
      name: "release-notes",
      content: source,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  });

  it("returns null for an unknown workflow name", async () => {
    const rootPath = await makeTempDir("bb-wf-registry-root-");
    const dataDir = await makeTempDir("bb-wf-registry-data-");
    await mkdir(join(rootPath, ".git"), { recursive: true });

    await expect(
      resolveWorkflowRegistryName({ rootPath, dataDir, name: "missing" }),
    ).resolves.toBeNull();
  });
});
