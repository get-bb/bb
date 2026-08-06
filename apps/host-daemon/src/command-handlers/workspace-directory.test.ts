import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkspaceDirectoryPage } from "./workspace-directory.js";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "bb-directory-"));
  temporaryDirectories.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("listWorkspaceDirectoryPage", () => {
  it("lists every direct entry, including hidden and dependency paths", async () => {
    const workspace = await createWorkspace();
    await fs.mkdir(path.join(workspace, ".git"));
    await fs.mkdir(path.join(workspace, "empty"));
    await fs.mkdir(path.join(workspace, "node_modules"));
    await fs.writeFile(path.join(workspace, ".env"), "SECRET=test");
    await fs.writeFile(path.join(workspace, "README.md"), "read me");
    await fs.symlink("/tmp", path.join(workspace, "outbound"));

    const result = await listWorkspaceDirectoryPage({
      limit: 20,
      relativePath: "",
      workspacePath: workspace,
    });

    expect(result).toEqual({
      directory: "",
      entries: [
        { kind: "file", name: ".env", path: ".env" },
        { kind: "directory", name: ".git", path: ".git" },
        { kind: "file", name: "README.md", path: "README.md" },
        { kind: "directory", name: "empty", path: "empty" },
        {
          kind: "directory",
          name: "node_modules",
          path: "node_modules",
        },
        { kind: "symlink", name: "outbound", path: "outbound" },
      ],
      nextCursor: null,
    });
  });

  it("pages in lexical order without gaps or duplicates", async () => {
    const workspace = await createWorkspace();
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((name) =>
        fs.writeFile(path.join(workspace, name), name),
      ),
    );

    const first = await listWorkspaceDirectoryPage({
      limit: 2,
      relativePath: "",
      workspacePath: workspace,
    });
    const second = await listWorkspaceDirectoryPage({
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      relativePath: "",
      workspacePath: workspace,
    });
    const third = await listWorkspaceDirectoryPage({
      cursor: second.nextCursor ?? undefined,
      limit: 2,
      relativePath: "",
      workspacePath: workspace,
    });

    expect(
      [...first.entries, ...second.entries, ...third.entries].map(
        (entry) => entry.name,
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(third.nextCursor).toBeNull();
  });

  it.each(["../outside", "/tmp", "nested/../outside", "nested\\child"])(
    "rejects unsafe path %s",
    async (relativePath) => {
      const workspace = await createWorkspace();
      await expect(
        listWorkspaceDirectoryPage({
          limit: 20,
          relativePath,
          workspacePath: workspace,
        }),
      ).rejects.toMatchObject({ code: "invalid_path" });
    },
  );

  it("does not traverse a symlink and reports a removed directory", async () => {
    const workspace = await createWorkspace();
    await fs.mkdir(path.join(workspace, "nested"));
    await fs.symlink("/tmp", path.join(workspace, "link"));

    await expect(
      listWorkspaceDirectoryPage({
        limit: 20,
        relativePath: "link",
        workspacePath: workspace,
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });

    await fs.rm(path.join(workspace, "nested"), { recursive: true });
    await expect(
      listWorkspaceDirectoryPage({
        cursor: Buffer.from("first").toString("base64url"),
        limit: 20,
        relativePath: "nested",
        workspacePath: workspace,
      }),
    ).rejects.toMatchObject({ code: "path_not_found" });
  });
});
