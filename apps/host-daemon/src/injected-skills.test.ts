import { discoverSkills } from "./command-discovery.js";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeSkillRoot } from "@bb/agent-runtime";
import type {
  HostDaemonInjectedSkillSource,
  HostDaemonSkillTreeManifest,
} from "@bb/host-daemon-contract";
import { hashSkillTreeFiles } from "@bb/host-daemon-contract/skill-tree";
import type { SkillTreeTransport } from "./skill-trees.js";
import {
  cleanupInjectedSkillStagingDirs,
  ensureDataDirSkillsRootPath,
  MAX_SKILL_STORE_TREES,
  stageInjectedSkillSources,
} from "./injected-skills.js";

interface WriteSkillArgs {
  body?: string;
  name: string;
  rootPath: string;
}

interface StageSourceArgs {
  dataDir: string;
  skillRootPath: string;
  skillName: string;
}

interface CapturedWarning {
  context: object;
  message: string;
}

function requireSkillRoot(
  roots: readonly AgentRuntimeSkillRoot[],
): AgentRuntimeSkillRoot {
  const [root, ...rest] = roots;
  if (root === undefined || rest.length > 0) {
    throw new Error(
      `Expected exactly one staged skill root, got ${roots.length}`,
    );
  }
  return root;
}

async function writeSkill(args: WriteSkillArgs): Promise<string> {
  const skillRootPath = path.join(args.rootPath, args.name);
  await mkdir(path.join(skillRootPath, "references"), { recursive: true });
  await writeFile(
    path.join(skillRootPath, "SKILL.md"),
    [
      "---",
      `name: ${args.name}`,
      `description: Use ${args.name} when host staging tests run.`,
      "---",
      "",
      args.body ?? "# Skill",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(skillRootPath, "references", "notes.md"),
    "supporting notes\n",
    "utf8",
  );
  return skillRootPath;
}

function createDataDirSource(
  args: StageSourceArgs,
): HostDaemonInjectedSkillSource {
  return {
    kind: "workspace-path",
    sourceType: "project",
    name: args.skillName,
    description: `Use ${args.skillName} when host staging tests run.`,
    sourceRootPath: args.skillRootPath,
    skillFilePath: path.join(args.skillRootPath, "SKILL.md"),
  };
}

interface TreeFixtureFile {
  content: Buffer;
  mode: number;
  path: string;
}

interface TreeFixture {
  files: TreeFixtureFile[];
  treeHash: string;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function manifestOf(fixture: TreeFixture): HostDaemonSkillTreeManifest {
  return {
    treeHash: fixture.treeHash,
    files: fixture.files.map((file) => ({
      path: file.path,
      mode: file.mode,
      sizeBytes: file.content.byteLength,
      sha256: sha256(file.content),
    })),
  };
}

function createTreePayload(
  name: string,
  token = "tree bytes",
  extraFiles: TreeFixtureFile[] = [],
): TreeFixture {
  const files = [
    {
      path: "SKILL.md",
      mode: 0o644,
      content: Buffer.from(
        `---\nname: ${name}\ndescription: Use ${name} in pull tests.\n---\n\n${token}\n`,
      ),
    },
    {
      path: "scripts/run.sh",
      mode: 0o755,
      content: Buffer.from("#!/bin/sh\necho synced\n"),
    },
    ...extraFiles,
  ];
  return {
    files,
    treeHash: hashSkillTreeFiles(manifestOf({ files, treeHash: "" }).files),
  };
}

async function* chunked(
  content: Buffer,
  chunkBytes = 5,
): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < content.byteLength; offset += chunkBytes) {
    yield content.subarray(offset, offset + chunkBytes);
  }
}

function createTransport(...fixtures: TreeFixture[]) {
  const byHash = new Map(
    fixtures.map((fixture) => [fixture.treeHash, fixture]),
  );
  function requireFixture(treeHash: string): TreeFixture {
    const fixture = byHash.get(treeHash);
    if (fixture === undefined) throw new Error(`Unknown tree ${treeHash}`);
    return fixture;
  }
  return {
    fetchManifest: vi.fn(async (treeHash: string) =>
      manifestOf(requireFixture(treeHash)),
    ),
    fetchContent: vi.fn(async (treeHash: string, paths: readonly string[]) => {
      const fixture = requireFixture(treeHash);
      return chunked(
        Buffer.concat(
          paths.map((requestedPath) => {
            const file = fixture.files.find(
              (candidate) => candidate.path === requestedPath,
            );
            if (file === undefined) throw new Error(`Unknown ${requestedPath}`);
            return file.content;
          }),
        ),
      );
    }),
  } satisfies SkillTreeTransport;
}

async function seedStoredTree(
  dataDir: string,
  tree: TreeFixture,
): Promise<string> {
  const treeRootPath = path.join(
    dataDir,
    "runtime",
    "skill-store",
    tree.treeHash,
  );
  const contentRootPath = path.join(treeRootPath, "content");
  await Promise.all(
    tree.files.map(async (file) => {
      const destinationPath = path.join(contentRootPath, file.path);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, file.content, { mode: file.mode });
    }),
  );
  await Promise.all([
    writeFile(
      path.join(treeRootPath, "manifest.json"),
      JSON.stringify(manifestOf(tree)),
    ),
    writeFile(path.join(treeRootPath, ".complete"), "complete\n"),
    writeFile(path.join(treeRootPath, ".last-used"), ""),
  ]);
  return treeRootPath;
}

function createTreeSource(
  name: string,
  treeHash: string,
): HostDaemonInjectedSkillSource {
  return {
    kind: "tree",
    sourceType: "data-dir",
    name,
    description: `Use ${name} in pull tests.`,
    treeHash,
    entryPath: "SKILL.md",
  };
}

describe("data-dir skills root", () => {
  it("creates the global skills root so the watcher can subscribe", async () => {
    const dataDir = await makeTempDir();

    const skillsRootPath = await ensureDataDirSkillsRootPath(dataDir);

    expect(skillsRootPath).toBe(path.join(dataDir, "skills"));
    await expect(
      lstat(skillsRootPath).then((stats) => stats.isDirectory()),
    ).resolves.toBe(true);
  });
});

async function countStoredTrees(dataDir: string): Promise<number> {
  const entries = await readdir(path.join(dataDir, "runtime", "skill-store"), {
    withFileTypes: true,
  });
  return entries.filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith(".tmp-"),
  ).length;
}

describe("injected skill staging", () => {
  it("pulls a missing tree, stages identical bytes and modes, and reuses the store", async () => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("synced-skill");
    const skillTreeTransport = createTransport(payload);
    const source = createTreeSource("synced-skill", payload.treeHash);

    const first = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport,
      injectedSkillSources: [source],
    });
    await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport,
      injectedSkillSources: [source],
    });

    const stagedScript = path.join(
      requireSkillRoot(first.skillRoots).path,
      "synced-skill",
      "scripts",
      "run.sh",
    );
    await expect(readFile(stagedScript, "utf8")).resolves.toBe(
      "#!/bin/sh\necho synced\n",
    );
    if (process.platform !== "win32") {
      await expect(
        lstat(stagedScript).then((stat) => stat.mode & 0o777),
      ).resolves.toBe(0o755);
    }
    expect(skillTreeTransport.fetchManifest).toHaveBeenCalledTimes(1);
    expect(skillTreeTransport.fetchManifest).toHaveBeenCalledWith(
      payload.treeHash,
    );
    expect(skillTreeTransport.fetchContent).toHaveBeenCalledTimes(1);
    expect(skillTreeTransport.fetchContent).toHaveBeenCalledWith(
      payload.treeHash,
      ["SKILL.md", "scripts/run.sh"],
    );
  });

  it("stages a pulled tree whose supporting assets exceed 10 MiB", async () => {
    const dataDir = await makeTempDir();
    const asset = Buffer.alloc(11 * 1024 * 1024, 0x5a);
    const payload = createTreePayload(
      "asset-heavy",
      "Use assets/example.bin as supporting material.",
      [{ path: "assets/example.bin", mode: 0o644, content: asset }],
    );
    const files = [...payload.files].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport: {
        fetchManifest: async () => manifestOf(payload),
        fetchContent: async () =>
          chunked(Buffer.concat(files.map((file) => file.content)), 64 * 1024),
      },
      injectedSkillSources: [createTreeSource("asset-heavy", payload.treeHash)],
    });
    const stagedAsset = await readFile(
      path.join(
        requireSkillRoot(staged.skillRoots).path,
        "asset-heavy",
        "assets",
        "example.bin",
      ),
    );
    expect(stagedAsset.equals(asset)).toBe(true);
  });

  it.each([
    { state: "empty directory", files: [] },
    { state: "unfinished directory", files: ["unfinished"] },
    { state: "missing content directory", files: [".complete"] },
    { state: "missing completion marker", files: ["content/SKILL.md"] },
  ])("repairs a stored tree with $state before staging", async ({ files }) => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("repaired-skill");
    const treeRootPath = path.join(
      dataDir,
      "runtime",
      "skill-store",
      payload.treeHash,
    );
    await mkdir(treeRootPath, { recursive: true });
    for (const file of files) {
      const filePath = path.join(treeRootPath, file);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "unfinished\n");
    }
    const skillTreeTransport = createTransport(payload);
    const stages = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      stages.push(
        await stageInjectedSkillSources({
          workspacePath: dataDir,
          dataDir,
          skillTreeTransport,
          injectedSkillSources: [
            createTreeSource("repaired-skill", payload.treeHash),
          ],
        }).then(
          (stage) => stage,
          (error: unknown) => {
            if (error instanceof Error) return error;
            throw error;
          },
        ),
      );
    }
    expect(
      stages
        .filter((stage) => stage instanceof Error)
        .map((error) => error.message),
    ).toEqual([]);
    await expect(
      readFile(path.join(treeRootPath, ".complete"), "utf8"),
    ).resolves.toBe("complete\n");
    for (const stage of stages) {
      if (stage instanceof Error) throw stage;
      await expect(
        readFile(
          path.join(
            requireSkillRoot(stage.skillRoots).path,
            "repaired-skill",
            "scripts",
            "run.sh",
          ),
          "utf8",
        ),
      ).resolves.toBe("#!/bin/sh\necho synced\n");
    }
    expect(skillTreeTransport.fetchManifest).toHaveBeenCalledTimes(1);
  });

  it("reuses a complete tree installed while the fetch is pending", async () => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("concurrent-install");
    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport: {
        ...createTransport(payload),
        fetchManifest: async () => {
          const treeRootPath = await seedStoredTree(dataDir, payload);
          await writeFile(path.join(treeRootPath, "resident"), "keep\n");
          return manifestOf(payload);
        },
      },
      injectedSkillSources: [
        createTreeSource("concurrent-install", payload.treeHash),
      ],
    });
    await expect(
      readFile(
        path.join(
          requireSkillRoot(staged.skillRoots).path,
          "concurrent-install",
          "scripts",
          "run.sh",
        ),
        "utf8",
      ),
    ).resolves.toBe("#!/bin/sh\necho synced\n");
    await expect(
      readFile(
        path.join(
          dataDir,
          "runtime",
          "skill-store",
          payload.treeHash,
          "resident",
        ),
        "utf8",
      ),
    ).resolves.toBe("keep\n");
  });

  it.runIf(process.platform === "win32")(
    "retries a tree install while Windows briefly locks the new files",
    async () => {
      const dataDir = await makeTempDir();
      const payload = createTreePayload("locked-skill");
      const realRename = fs.rename.bind(fs);
      let deniedRenames = 0;
      const renameSpy = vi
        .spyOn(fs, "rename")
        .mockImplementation(async (sourcePath, destinationPath) => {
          if (deniedRenames < 2) {
            deniedRenames += 1;
            throw Object.assign(new Error("EPERM: operation not permitted"), {
              code: "EPERM",
            });
          }
          return realRename(sourcePath, destinationPath);
        });
      try {
        const staged = await stageInjectedSkillSources({
          workspacePath: dataDir,
          dataDir,
          skillTreeTransport: createTransport(payload),
          injectedSkillSources: [
            createTreeSource("locked-skill", payload.treeHash),
          ],
        });
        await expect(
          readFile(
            path.join(
              requireSkillRoot(staged.skillRoots).path,
              "locked-skill",
              "scripts",
              "run.sh",
            ),
            "utf8",
          ),
        ).resolves.toBe("#!/bin/sh\necho synced\n");
        expect(deniedRenames).toBe(2);
      } finally {
        renameSpy.mockRestore();
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "gives up on a persistent Windows rename denial without publishing a tree",
    async () => {
      const dataDir = await makeTempDir();
      const payload = createTreePayload("denied-skill");
      let now = 1_781_053_873_372;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => {
        now += 1_000;
        return now;
      });
      const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(
        Object.assign(new Error("EPERM: operation not permitted"), {
          code: "EPERM",
        }),
      );
      try {
        await expect(
          stageInjectedSkillSources({
            workspacePath: dataDir,
            dataDir,
            skillTreeTransport: createTransport(payload),
            injectedSkillSources: [
              createTreeSource("denied-skill", payload.treeHash),
            ],
          }),
        ).rejects.toMatchObject({ code: "EPERM" });
        await expect(
          readdir(path.join(dataDir, "runtime", "skill-store")),
        ).resolves.toEqual([]);
      } finally {
        renameSpy.mockRestore();
        clock.mockRestore();
      }
    },
  );

  it("surfaces a failed required tree pull instead of silently skipping it", async () => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("failed-pull");
    const warnings: CapturedWarning[] = [];
    const failure = new Error("server unavailable");

    await expect(
      stageInjectedSkillSources({
        workspacePath: dataDir,
        dataDir,
        skillTreeTransport: {
          ...createTransport(payload),
          fetchManifest: async () => Promise.reject(failure),
        },
        injectedSkillSources: [
          createTreeSource("failed-pull", payload.treeHash),
        ],
        logger: {
          debug: () => undefined,
          warn: (context, message) => warnings.push({ context, message }),
        },
      }),
    ).rejects.toThrow("server unavailable");
    expect(warnings).toEqual([
      expect.objectContaining({
        message: "Failed to pull required injected skill tree",
      }),
    ]);
  });

  it.each([
    {
      failure: "a manifest that does not hash to the requested tree",
      error: "Fetched skill tree manifest hash mismatch",
      transport: (payload: TreeFixture) => ({
        ...createTransport(payload),
        fetchManifest: async () => ({
          ...manifestOf(payload),
          files: manifestOf(payload).files.map((file) => ({
            ...file,
            mode: 0o777,
          })),
        }),
      }),
    },
    {
      failure: "an unsafe manifest path",
      error: "Skill tree entry has unsafe path: ../escape.sh",
      transport: (payload: TreeFixture) => ({
        ...createTransport(payload),
        fetchManifest: async () => ({
          ...manifestOf(payload),
          files: [
            ...manifestOf(payload).files,
            {
              path: "../escape.sh",
              mode: 0o644,
              sizeBytes: 0,
              sha256: sha256(Buffer.alloc(0)),
            },
          ],
        }),
      }),
    },
    {
      failure: "content bytes that do not match the manifest",
      error: "Skill tree file SKILL.md content hash mismatch",
      transport: (payload: TreeFixture) => ({
        ...createTransport(payload),
        fetchContent: async () =>
          chunked(
            Buffer.concat(
              payload.files.map((file) => Buffer.alloc(file.content.length)),
            ),
          ),
      }),
    },
    {
      failure: "a truncated content stream",
      error: "Transfer ended",
      transport: (payload: TreeFixture) => ({
        ...createTransport(payload),
        fetchContent: async () => chunked(payload.files[0]!.content),
      }),
    },
    {
      failure: "a content stream with trailing bytes",
      error: "Transfer returned more bytes than requested",
      transport: (payload: TreeFixture) => ({
        ...createTransport(payload),
        fetchContent: async () =>
          chunked(
            Buffer.concat([
              ...payload.files.map((file) => file.content),
              Buffer.from("extra"),
            ]),
          ),
      }),
    },
  ])("rejects $failure without publishing a stored tree", async (args) => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("tampered-tree");

    await expect(
      stageInjectedSkillSources({
        workspacePath: dataDir,
        dataDir,
        skillTreeTransport: args.transport(payload),
        injectedSkillSources: [
          createTreeSource("tampered-tree", payload.treeHash),
        ],
      }),
    ).rejects.toThrow(args.error);
    await expect(
      readdir(path.join(dataDir, "runtime", "skill-store")).catch(() => []),
    ).resolves.toEqual([]);
  });

  it("downloads only files the local store does not already hold", async () => {
    const dataDir = await makeTempDir();
    const asset = {
      path: "assets/model.bin",
      mode: 0o644,
      content: Buffer.alloc(256 * 1024, 7),
    };
    const original = createTreePayload("edited-skill", "v1", [asset]);
    const edited = createTreePayload("edited-skill", "v2", [asset]);
    const skillTreeTransport = createTransport(original, edited);

    await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport,
      injectedSkillSources: [
        createTreeSource("edited-skill", original.treeHash),
      ],
    });
    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport,
      injectedSkillSources: [createTreeSource("edited-skill", edited.treeHash)],
    });

    expect(skillTreeTransport.fetchContent).toHaveBeenLastCalledWith(
      edited.treeHash,
      ["SKILL.md"],
    );
    const stagedSkillPath = path.join(
      requireSkillRoot(staged.skillRoots).path,
      "edited-skill",
    );
    await expect(
      readFile(path.join(stagedSkillPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("v2");
    await expect(
      readFile(path.join(stagedSkillPath, "assets", "model.bin")),
    ).resolves.toEqual(asset.content);
  });

  it("downloads a file again when its stored copy no longer matches", async () => {
    const dataDir = await makeTempDir();
    const original = createTreePayload("corrupt-store");
    const edited = createTreePayload("corrupt-store", "edited");
    const storedRoot = await seedStoredTree(dataDir, original);
    await writeFile(
      path.join(storedRoot, "content", "scripts", "run.sh"),
      "#!/bin/sh\necho broken\n",
    );
    const skillTreeTransport = createTransport(edited);

    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport,
      injectedSkillSources: [
        createTreeSource("corrupt-store", edited.treeHash),
      ],
    });

    expect(skillTreeTransport.fetchContent).toHaveBeenCalledWith(
      edited.treeHash,
      ["SKILL.md", "scripts/run.sh"],
    );
    await expect(
      readFile(
        path.join(
          requireSkillRoot(staged.skillRoots).path,
          "corrupt-store",
          "scripts",
          "run.sh",
        ),
        "utf8",
      ),
    ).resolves.toBe("#!/bin/sh\necho synced\n");
  });

  it("pulls a tree once for concurrent stages that need it", async () => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("concurrent-pull");
    const skillTreeTransport = createTransport(payload);
    const source = createTreeSource("concurrent-pull", payload.treeHash);

    const stages = await Promise.all(
      [1, 2, 3].map(() =>
        stageInjectedSkillSources({
          workspacePath: dataDir,
          dataDir,
          skillTreeTransport,
          injectedSkillSources: [source],
        }),
      ),
    );

    expect(new Set(stages.map((stage) => stage.catalogHash)).size).toBe(1);
    expect(skillTreeTransport.fetchManifest).toHaveBeenCalledTimes(1);
    expect(skillTreeTransport.fetchContent).toHaveBeenCalledTimes(1);
  });

  it("garbage-collects the least-recently-used trees beyond the store cap", async () => {
    const dataDir = await makeTempDir();
    const residents = Array.from(
      { length: MAX_SKILL_STORE_TREES },
      (_, index) => {
        const name = `gc-skill-${index}`;
        return { name, payload: createTreePayload(name, `token-${index}`) };
      },
    );
    const residentRoots = await Promise.all(
      residents.map(({ payload }) => seedStoredTree(dataDir, payload)),
    );
    const oldestRoot = residentRoots[0];
    if (!oldestRoot) throw new Error("Expected an oldest resident tree");
    const oldest = new Date(1);
    await utimes(path.join(oldestRoot, ".last-used"), oldest, oldest);

    const name = "gc-newcomer";
    const payload = createTreePayload(name, "newcomer-token");
    await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport: createTransport(payload),
      injectedSkillSources: [createTreeSource(name, payload.treeHash)],
    });

    await vi.waitFor(async () => {
      await expect(countStoredTrees(dataDir)).resolves.toBe(
        MAX_SKILL_STORE_TREES,
      );
    });
    await expect(lstat(oldestRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(path.join(dataDir, "runtime", "skill-store", payload.treeHash)),
    ).resolves.toBeDefined();
  });

  it("exempts in-flight tree hashes from garbage collection", async () => {
    const dataDir = await makeTempDir();
    const storeRoot = path.join(dataDir, "runtime", "skill-store");
    const residents = Array.from(
      { length: MAX_SKILL_STORE_TREES },
      (_, index) => {
        const name = index === 0 ? "protected-skill" : `resident-${index}`;
        return {
          name,
          payload: createTreePayload(name, `resident-${index}`),
        };
      },
    );
    await Promise.all(
      residents.map(({ payload }) => seedStoredTree(dataDir, payload)),
    );
    const protectedTree = residents[0];
    if (!protectedTree) throw new Error("Expected a protected tree");
    const protectedRoot = path.join(storeRoot, protectedTree.payload.treeHash);
    const protectedContentRoot = path.join(protectedRoot, "content");
    let resumeCollection = (): void => undefined;
    const collectionBlocked = new Promise<void>((resolve) => {
      resumeCollection = resolve;
    });
    let reportCollectionBlocked = (): void => undefined;
    const collectionReached = new Promise<void>((resolve) => {
      reportCollectionBlocked = resolve;
    });
    const originalLstat = fs.lstat.bind(fs);
    const lstatSpy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(async (targetPath) => {
        if (String(targetPath) === protectedContentRoot) {
          reportCollectionBlocked();
          await collectionBlocked;
        }
        return originalLstat(targetPath);
      });

    const protectedStage = stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      skillTreeTransport: createTransport(protectedTree.payload),
      injectedSkillSources: [
        createTreeSource(protectedTree.name, protectedTree.payload.treeHash),
      ],
    });
    try {
      await collectionReached;
      const oldest = new Date(1);
      await utimes(path.join(protectedRoot, ".last-used"), oldest, oldest);
      const newcomer = createTreePayload("newcomer");
      await stageInjectedSkillSources({
        workspacePath: dataDir,
        dataDir,
        skillTreeTransport: createTransport(newcomer),
        injectedSkillSources: [createTreeSource("newcomer", newcomer.treeHash)],
      });
      await vi.waitFor(async () => {
        await expect(countStoredTrees(dataDir)).resolves.toBe(
          MAX_SKILL_STORE_TREES,
        );
      });
      resumeCollection();

      await expect(protectedStage).resolves.toMatchObject({
        skillRoots: expect.any(Array),
      });
      await expect(lstat(protectedRoot)).resolves.toBeDefined();
    } finally {
      resumeCollection();
      await protectedStage.catch(() => undefined);
      lstatSpy.mockRestore();
    }
  });

  it("stages a workspace-path skill source into the shared catalog", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });

    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [
        createDataDirSource({
          dataDir,
          skillName: "release-notes",
          skillRootPath,
        }),
      ],
    });

    const root = requireSkillRoot(staged.skillRoots);
    const stageRootPath = path.join(
      dataDir,
      "runtime",
      "global-skills",
      staged.catalogHash,
    );
    expect(root).toEqual({
      id: `global-skills:${staged.catalogHash}`,
      path: path.join(stageRootPath, "skills"),
      skills: [
        {
          description: "Use release-notes when host staging tests run.",
          name: "release-notes",
        },
      ],
    });
    await expect(
      readFile(path.join(root.path, "release-notes", "SKILL.md"), "utf8"),
    ).resolves.toContain("name: release-notes");
    await expect(
      readFile(
        path.join(root.path, "release-notes", "references", "notes.md"),
        "utf8",
      ),
    ).resolves.toBe("supporting notes\n");
    await expect(
      readdir(stageRootPath).then((entries) => entries.sort()),
    ).resolves.toEqual(["catalog.json", "skills"]);
    await expect(
      readFile(path.join(stageRootPath, "catalog.json"), "utf8").then(
        (content) => JSON.parse(content),
      ),
    ).resolves.toMatchObject({
      catalogHash: staged.catalogHash,
      skills: [
        {
          name: "release-notes",
          sourceRootPath: skillRootPath,
          sourceType: "project",
        },
      ],
    });
  });

  it("stages a read-only shared host path for every provider", async () => {
    const dataDir = await makeTempDir();
    const sourceRoot = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: sourceRoot,
      name: "shared-review",
    });

    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [
        {
          kind: "host-path",
          sourceType: "shared-user",
          name: "shared-review",
          description: "Use shared-review when host staging tests run.",
          sourceRootPath: skillRootPath,
          skillFilePath: path.join(skillRootPath, "SKILL.md"),
        },
      ],
    });

    const root = requireSkillRoot(staged.skillRoots);
    expect(root.skills.map((skill) => skill.name)).toEqual(["shared-review"]);
    await expect(
      readFile(path.join(root.path, "shared-review", "SKILL.md"), "utf8"),
    ).resolves.toContain("name: shared-review");
  });

  it("changes the catalog hash when skill content changes", async () => {
    const dataDir = await makeTempDir();
    const sourceRootPath = path.join(dataDir, "source-skills");
    const skillRootPath = await writeSkill({
      body: "first body",
      rootPath: sourceRootPath,
      name: "release-notes",
    });
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });
    const first = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [source],
    });

    await writeFile(
      path.join(skillRootPath, "SKILL.md"),
      [
        "---",
        "name: release-notes",
        "description: Use release-notes when host staging tests run.",
        "---",
        "",
        "second body",
        "",
      ].join("\n"),
      "utf8",
    );
    const second = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [source],
    });

    expect(second.catalogHash).not.toBe(first.catalogHash);
  });

  it("reuses a collected tree while its stage exists and re-pulls it to rebuild the stage", async () => {
    const dataDir = await makeTempDir();
    const payload = createTreePayload("memo-tree");
    const skillTreeTransport = createTransport(payload);
    const source = createTreeSource("memo-tree", payload.treeHash);
    const stage = () =>
      stageInjectedSkillSources({
        workspacePath: dataDir,
        dataDir,
        skillTreeTransport,
        injectedSkillSources: [source],
      });
    const first = await stage();
    const storeRoot = path.join(dataDir, "runtime", "skill-store");
    await rm(storeRoot, { recursive: true, force: true });

    const reused = await stage();
    await expect(
      access(path.join(storeRoot, payload.treeHash)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await rm(path.join(dataDir, "runtime", "global-skills"), {
      recursive: true,
      force: true,
    });
    const rebuilt = await stage();

    expect(reused.catalogHash).toBe(first.catalogHash);
    expect(rebuilt.catalogHash).toBe(first.catalogHash);
    expect(skillTreeTransport.fetchManifest).toHaveBeenCalledTimes(2);
    await expect(
      readFile(
        path.join(
          requireSkillRoot(rebuilt.skillRoots).path,
          "memo-tree",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("tree bytes");
  });

  it("restages a host skill edited in place with its size and mtime unchanged", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      body: "aaaa",
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    const skillFilePath = path.join(skillRootPath, "SKILL.md");
    const pinnedTime = new Date(1_700_000_000_000);
    await utimes(skillFilePath, pinnedTime, pinnedTime);
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });
    const first = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [source],
    });

    await writeFile(
      skillFilePath,
      (await readFile(skillFilePath, "utf8")).replace("aaaa", "bbbb"),
    );
    await utimes(skillFilePath, pinnedTime, pinnedTime);
    const second = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [source],
    });

    expect(second.catalogHash).not.toBe(first.catalogHash);
    await expect(
      readFile(
        path.join(
          requireSkillRoot(second.skillRoots).path,
          "release-notes",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("bbbb");
  });

  it("stages the same catalog concurrently without sharing temp directories", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });
    const fixedTime = vi.spyOn(Date, "now").mockReturnValue(1_781_053_873_372);

    try {
      const staged = await Promise.all(
        Array.from({ length: 12 }, () =>
          stageInjectedSkillSources({
            workspacePath: dataDir,
            dataDir,
            injectedSkillSources: [source],
          }),
        ),
      );

      const catalogHashes = new Set(staged.map((entry) => entry.catalogHash));
      expect(catalogHashes.size).toBe(1);
      const firstStaged = staged[0];
      if (!firstStaged) {
        throw new Error("Expected staged skill catalogs");
      }
      for (const entry of staged) {
        expect(requireSkillRoot(entry.skillRoots).path).toBe(
          path.join(
            dataDir,
            "runtime",
            "global-skills",
            entry.catalogHash,
            "skills",
          ),
        );
      }
      await expect(
        readFile(
          path.join(
            dataDir,
            "runtime",
            "global-skills",
            firstStaged.catalogHash,
            "skills",
            "release-notes",
            "SKILL.md",
          ),
          "utf8",
        ),
      ).resolves.toContain("Use release-notes");
    } finally {
      fixedTime.mockRestore();
    }
  });

  it("replaces a staged catalog directory that lost its catalog file", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });
    const first = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [source],
    });
    const stageRootPath = path.join(
      dataDir,
      "runtime",
      "global-skills",
      first.catalogHash,
    );
    await rm(path.join(stageRootPath, "catalog.json"));
    await rm(
      path.join(stageRootPath, "skills", "release-notes", "references"),
      {
        recursive: true,
      },
    );

    const second = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [source],
    });

    expect(second.catalogHash).toBe(first.catalogHash);
    await expect(
      readFile(
        path.join(
          requireSkillRoot(second.skillRoots).path,
          "release-notes",
          "references",
          "notes.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("supporting notes\n");
    await expect(
      access(path.join(stageRootPath, "catalog.json")),
    ).resolves.toBeUndefined();
  });

  it.each(["directory", "entry"] as const)(
    "stages a discovered user skill reached through a linked %s",
    async (shape) => {
      const dataDir = await makeTempDir();
      const pool = await makeTempDir();
      const source = await writeSkill({ rootPath: pool, name: "linked-skill" });
      const skillsRoot = path.join(dataDir, "source-skills");
      await mkdir(skillsRoot);
      const link = path.join(skillsRoot, "linked-skill");
      if (shape === "directory") await symlink(source, link);
      else {
        await mkdir(link);
        await symlink(
          path.join(source, "SKILL.md"),
          path.join(link, "SKILL.md"),
        );
      }
      const skills = await discoverSkills({
        roots: [
          {
            rootPath: skillsRoot,
            shape: "skill",
            origin: "user",
            source: "skill",
            namePrefix: "",
            rootKind: "shared-user",
            identitySeed: "shared",
          },
        ],
      });
      expect(skills).toHaveLength(1);
      const skill = skills[0]!;
      const staged = await stageInjectedSkillSources({
        dataDir,
        workspacePath: null,
        injectedSkillSources: [
          {
            kind: "host-path",
            sourceType: "shared-user",
            name: skill.name,
            description: skill.description!,
            sourceRootPath: path.dirname(skill.filePath),
            skillFilePath: skill.filePath,
          },
        ],
      });
      const stagedFile = path.join(
        requireSkillRoot(staged.skillRoots).path,
        "linked-skill",
        "SKILL.md",
      );
      expect(await readFile(stagedFile, "utf8")).toBe(
        await readFile(path.join(source, "SKILL.md"), "utf8"),
      );
      const projectStage = await stageInjectedSkillSources({
        dataDir,
        workspacePath: dataDir,
        injectedSkillSources: [
          {
            kind: "host-path",
            sourceType: "shared-project",
            name: skill.name,
            description: skill.description!,
            sourceRootPath: path.dirname(skill.filePath),
            skillFilePath: skill.filePath,
          },
        ],
      });
      expect(projectStage.skillRoots).toEqual([]);
    },
  );

  it("skips symlinked files during staging", async () => {
    const dataDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    await writeFile(path.join(outsideDir, "escape.md"), "escape\n", "utf8");
    await symlink(
      path.join(outsideDir, "escape.md"),
      path.join(skillRootPath, "references", "escape.md"),
    );
    const warnings: CapturedWarning[] = [];

    const staged = await stageInjectedSkillSources({
      workspacePath: dataDir,
      dataDir,
      injectedSkillSources: [
        createDataDirSource({
          dataDir,
          skillName: "release-notes",
          skillRootPath,
        }),
      ],
      logger: {
        debug: () => undefined,
        warn: (context, message) => {
          warnings.push({ context, message });
        },
      },
    });

    expect(staged.skillRoots).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({
        message: "Skipping injected skill during staging",
      }),
    ]);
  });
});

describe("cleanupInjectedSkillStagingDirs", () => {
  async function makeStagingRoot(): Promise<{
    dataDir: string;
    stagingRootPath: string;
  }> {
    const dataDir = await makeTempDir();
    const stagingRootPath = path.join(dataDir, "runtime", "global-skills");
    await mkdir(stagingRootPath, { recursive: true });
    return { dataDir, stagingRootPath };
  }

  async function exists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  it("keeps fresh .tmp- dirs that may belong to an in-flight staging", async () => {
    const { dataDir, stagingRootPath } = await makeStagingRoot();
    const inFlightTempPath = path.join(stagingRootPath, ".tmp-hash-123-456");
    await mkdir(path.join(inFlightTempPath, "skills"), { recursive: true });

    await cleanupInjectedSkillStagingDirs({ dataDir, keepCatalogHashes: [] });

    expect(await exists(inFlightTempPath)).toBe(true);
  });

  it("removes stale .tmp- dirs left behind by crashed stagings", async () => {
    const { dataDir, stagingRootPath } = await makeStagingRoot();
    const staleTempPath = path.join(stagingRootPath, ".tmp-hash-789-101");
    await mkdir(staleTempPath, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staleTempPath, twoHoursAgo, twoHoursAgo);

    await cleanupInjectedSkillStagingDirs({ dataDir, keepCatalogHashes: [] });

    expect(await exists(staleTempPath)).toBe(false);
  });

  it("removes unkept catalog dirs while keeping kept ones", async () => {
    const { dataDir, stagingRootPath } = await makeStagingRoot();
    const keptPath = path.join(stagingRootPath, "hash-keep");
    const unkeptPath = path.join(stagingRootPath, "hash-drop");
    await mkdir(keptPath, { recursive: true });
    await mkdir(unkeptPath, { recursive: true });

    await cleanupInjectedSkillStagingDirs({
      dataDir,
      keepCatalogHashes: ["hash-keep"],
    });

    expect(await exists(keptPath)).toBe(true);
    expect(await exists(unkeptPath)).toBe(false);
  });
});
