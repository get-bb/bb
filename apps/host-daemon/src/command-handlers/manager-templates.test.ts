import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listManagerTemplates } from "./manager-templates.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeTemplate(args: {
  dataDir: string;
  name: string;
  files: Record<string, string>;
}): Promise<void> {
  const templateDir = path.join(args.dataDir, "manager-templates", args.name);
  await fs.mkdir(templateDir, { recursive: true });
  for (const [fileName, content] of Object.entries(args.files)) {
    await fs.writeFile(path.join(templateDir, fileName), content, "utf8");
  }
}

async function writeActiveFile(dataDir: string, name: string): Promise<void> {
  const root = path.join(dataDir, "manager-templates");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "active"), `${name}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("listManagerTemplates", () => {
  it("returns an empty list and default active when the templates root is missing", async () => {
    const dataDir = await makeTempDir("bb-mt-empty-");
    expect(await listManagerTemplates({ dataDir })).toEqual({
      templates: [],
      activeName: "default",
    });
  });

  it("includes empty template directories so the picker matches seeding semantics", async () => {
    const dataDir = await makeTempDir("bb-mt-empty-dir-");
    await writeTemplate({
      dataDir,
      name: "default",
      files: { "STATUS.html": "ok" },
    });
    await fs.mkdir(path.join(dataDir, "manager-templates", "empty-set"), {
      recursive: true,
    });
    expect(await listManagerTemplates({ dataDir })).toEqual({
      templates: [{ name: "default" }, { name: "empty-set" }],
      activeName: "default",
    });
  });

  it("skips entries that are files or symlinks even when their name would parse", async () => {
    const dataDir = await makeTempDir("bb-mt-nondir-");
    await writeTemplate({
      dataDir,
      name: "default",
      files: { "STATUS.html": "ok" },
    });
    const root = path.join(dataDir, "manager-templates");
    await fs.writeFile(path.join(root, "stray-file"), "ignored", "utf8");
    const elsewhere = await makeTempDir("bb-mt-symlink-target-");
    await fs.symlink(elsewhere, path.join(root, "linked"));
    expect(await listManagerTemplates({ dataDir })).toEqual({
      templates: [{ name: "default" }],
      activeName: "default",
    });
  });

  it("sorts templates alphabetically and resolves a non-default active pointer", async () => {
    const dataDir = await makeTempDir("bb-mt-sorted-");
    await writeTemplate({
      dataDir,
      name: "default",
      files: { "STATUS.html": "ok" },
    });
    await writeTemplate({
      dataDir,
      name: "sawyer-next",
      files: { "STATUS.html": "ok" },
    });
    await writeActiveFile(dataDir, "sawyer-next");
    expect(await listManagerTemplates({ dataDir })).toEqual({
      templates: [{ name: "default" }, { name: "sawyer-next" }],
      activeName: "sawyer-next",
    });
  });

  it("falls back to default when active is empty or contains an invalid name", async () => {
    const dataDir = await makeTempDir("bb-mt-active-fallback-");
    await writeTemplate({
      dataDir,
      name: "default",
      files: { "STATUS.html": "ok" },
    });
    await fs.writeFile(
      path.join(dataDir, "manager-templates", "active"),
      "../escape\n",
      "utf8",
    );
    expect(await listManagerTemplates({ dataDir })).toEqual({
      templates: [{ name: "default" }],
      activeName: "default",
    });
  });

  it("normalizes active to default when it points at a valid name with no matching directory", async () => {
    const dataDir = await makeTempDir("bb-mt-active-orphan-");
    await writeTemplate({
      dataDir,
      name: "default",
      files: { "STATUS.html": "ok" },
    });
    await writeActiveFile(dataDir, "ghost-template");
    expect(await listManagerTemplates({ dataDir })).toEqual({
      templates: [{ name: "default" }],
      activeName: "default",
    });
  });
});
