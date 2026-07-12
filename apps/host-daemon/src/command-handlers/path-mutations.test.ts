import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirHostPath,
  moveHostPath,
  removeHostPath,
} from "./path-mutations.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-path-mutations-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("confined host path mutations", () => {
  it("creates, moves, and removes paths beneath the declared root", async () => {
    const root = await makeRoot();
    const folder = path.join(root, "projects");
    await expect(
      mkdirHostPath({
        type: "host.mkdir",
        path: folder,
        rootPath: root,
        recursive: false,
      }),
    ).resolves.toEqual({ ok: true });
    const source = path.join(folder, "draft.md");
    const destination = path.join(folder, "plan.md");
    await fs.writeFile(source, "# Plan");
    await expect(
      moveHostPath({
        type: "host.move_path",
        sourcePath: source,
        destinationPath: destination,
        rootPath: root,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(fs.readFile(destination, "utf8")).resolves.toBe("# Plan");
    await expect(
      removeHostPath({
        type: "host.remove_path",
        path: destination,
        rootPath: root,
        recursive: false,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(fs.stat(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates missing parent directories when recursive is enabled", async () => {
    const root = await makeRoot();
    const nested = path.join(root, "projects", "archive", "2026");
    await expect(
      mkdirHostPath({
        type: "host.mkdir",
        path: nested,
        rootPath: root,
        recursive: true,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(fs.stat(nested)).resolves.toMatchObject({});
  });

  it("rejects symlink escapes and refuses to remove the declared root", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const link = path.join(root, "outside");
    await fs.symlink(outside, link);
    const escaped = path.join(link, "secret.md");
    await fs.writeFile(path.join(outside, "secret.md"), "secret");

    await expect(
      removeHostPath({
        type: "host.remove_path",
        path: escaped,
        rootPath: root,
        recursive: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(
      removeHostPath({
        type: "host.remove_path",
        path: root,
        rootPath: root,
        recursive: true,
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("does not overwrite a move destination", async () => {
    const root = await makeRoot();
    const source = path.join(root, "source.md");
    const destination = path.join(root, "destination.md");
    await fs.writeFile(source, "source");
    await fs.writeFile(destination, "destination");

    await expect(
      moveHostPath({
        type: "host.move_path",
        sourcePath: source,
        destinationPath: destination,
        rootPath: root,
      }),
    ).rejects.toMatchObject({ code: "path_exists" });
    await expect(fs.readFile(destination, "utf8")).resolves.toBe("destination");
  });
});
