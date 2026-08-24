import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "../server";
import { checkDrift, planImport, type BoardTask } from "./plan";
import { commentHash, parseSyncStore, type SyncTask } from "./store-file";

/**
 * bb.sdk.files backed by the real filesystem. Sync reaches the invoking
 * machine's disk only through this SDK, so both fake instances share one
 * directory and it stands in for the git checkout they both hold.
 */
function localFilesSdk() {
  return {
    read: async ({ path }: { path: string }) => {
      const content = await readFile(path, "utf8").catch(() => null);
      if (content === null) throw new Error(`Path does not exist: ${path}`);
      return {
        path,
        content,
        contentEncoding: "utf8" as const,
        sizeBytes: Buffer.byteLength(content),
      };
    },
    write: async ({
      path,
      content,
      contentEncoding,
      createParents,
    }: {
      path: string;
      content: string;
      contentEncoding?: "utf8" | "base64";
      createParents?: boolean;
    }) => {
      if (createParents) await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(content, contentEncoding ?? "utf8"));
      return { outcome: "written" as const, path };
    },
  };
}

/** One bb instance with its own board and its own view of the shared files. */
async function instance(cwd: string) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    sdk: { files: localFilesSdk() },
  });
  await plugin(bb);
  return {
    harness,
    async cli(argv: string[]) {
      return harness.runCli(argv, { cwd });
    },
    async ok(argv: string[]) {
      const result = await harness.runCli(argv, { cwd });
      expect(result, `${argv.join(" ")}\n${result.stderr}`).toMatchObject({
        exitCode: 0,
      });
      return result.stdout;
    },
    dispose: () => harness.dispose(),
  };
}

const STORE = "record/agt.json";

async function seedProject(
  board: Awaited<ReturnType<typeof instance>>,
  extra: string[] = [],
): Promise<void> {
  await board.ok([
    "project",
    "create",
    "--name",
    "Agents",
    "--prefix",
    "AGT",
    "--sync-store",
    STORE,
    ...extra,
  ]);
}

describe("bb tasks sync", () => {
  it("converges a mirror instance through the store and stays idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-tasks-sync-"));
    const source = await instance(directory);
    const mirror = await instance(directory);
    try {
      await seedProject(source);
      await source.ok([
        "create",
        "--project",
        "AGT",
        "--title",
        "Fleet index",
        "--description",
        "Catalogue every host.",
        "--priority",
        "high",
      ]);
      await source.ok([
        "create",
        "--project",
        "AGT",
        "--title",
        "Retire the old VM",
      ]);
      await source.ok(["comment", "AGT-1", "--body", "Counted seven hosts."]);
      // Writes a plugin audit comment locally. It must not travel.
      await source.ok(["update", "AGT-1", "--status", "in_progress"]);

      await source.ok(["sync", "export", "--project", "AGT"]);
      const record = parseSyncStore(
        await readFile(join(directory, STORE), "utf8"),
      );
      expect(record.project.prefix).toBe("AGT");
      expect(record.tasks.map((task) => task.key)).toEqual(["AGT-1", "AGT-2"]);
      expect(record.tasks[0]?.status).toBe("in_progress");
      expect(record.tasks[0]?.comments.map((note) => note.body)).toEqual([
        "Counted seven hosts.",
      ]);
      // The rendered record ships beside the JSON for review in a pull request.
      expect(
        await readFile(join(directory, "record/AGT-1.md"), "utf8"),
      ).toContain("# AGT-1 — Fleet index");

      await seedProject(mirror, ["--sync-role", "mirror"]);

      // Dry run by default: it reports and changes nothing.
      expect(await mirror.ok(["sync", "import", "--project", "AGT"])).toContain(
        "would  CREATE",
      );
      expect(await mirror.ok(["list", "--project", "AGT"])).toContain(
        "No tasks.",
      );

      await mirror.ok(["sync", "import", "--project", "AGT", "--apply"]);
      // Keys survive the crossing: numbering comes from the store, not from
      // this instance's counter.
      const imported = JSON.parse(
        await mirror.ok(["show", "AGT-1", "--json"]),
      ) as {
        task: { key: string; status: string; priority: string };
        comments: { body: string; kind: string; systemEvent: string | null }[];
      };
      expect(imported.task).toMatchObject({
        key: "AGT-1",
        status: "in_progress",
        priority: "high",
      });
      expect(
        imported.comments
          .filter((comment) => comment.systemEvent === null)
          .map((comment) => comment.body),
      ).toEqual(["Counted seven hosts."]);
      // A later status change crosses as a field update, and the audit row
      // the mirror writes for it stays local — the failure that made both
      // boards drift permanently was propagating those rows.
      await source.ok(["update", "AGT-2", "--status", "done"]);
      await source.ok(["sync", "export", "--project", "AGT"]);
      await mirror.ok(["sync", "import", "--project", "AGT", "--apply"]);
      const afterStatus = JSON.parse(
        await mirror.ok(["show", "AGT-2", "--json"]),
      ) as {
        task: { status: string };
        comments: { systemEvent: string | null }[];
      };
      expect(afterStatus.task.status).toBe("done");
      expect(
        afterStatus.comments.some(
          (comment) => comment.systemEvent === "status_changed",
        ),
      ).toBe(true);

      // Both boards agree, including the audit rows each one generated.
      expect(await mirror.ok(["sync", "check", "--project", "AGT"])).toContain(
        "drift: 0",
      );
      expect(await source.ok(["sync", "check", "--project", "AGT"])).toContain(
        "drift: 0",
      );

      // Running import again changes nothing: notes match by body, so the
      // second pass finds none missing.
      expect(
        await mirror.ok(["sync", "import", "--project", "AGT", "--apply"]),
      ).toContain("0 change(s) applied");

      // A note added on the mirror cannot travel back, and check says so
      // rather than failing.
      await mirror.ok(["comment", "AGT-2", "--body", "Mirror-only note."]);
      const drifted = await mirror.cli(["sync", "check", "--project", "AGT"]);
      expect(drifted.exitCode).toBe(2);
      expect(drifted.stdout).toContain("AHEAD");
      expect(drifted.stdout).toContain("sync mirror");
      expect(drifted.stdout).toContain("cannot be exported from this mirror");

      // And the mirror refuses to write the shared record at all.
      const refused = await mirror.cli(["sync", "export", "--project", "AGT"]);
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("is a sync mirror");
    } finally {
      await source.dispose();
      await mirror.dispose();
    }
  });

  it("refuses to overwrite the record from a board with no tasks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-tasks-sync-"));
    const board = await instance(directory);
    try {
      await seedProject(board);
      const result = await board.cli(["sync", "export", "--project", "AGT"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("refusing to overwrite");
      await expect(readFile(join(directory, STORE), "utf8")).rejects.toThrow();
    } finally {
      await board.dispose();
    }
  });

  it("refuses a field update when the local edit is newer, until --force", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-tasks-sync-"));
    const source = await instance(directory);
    const mirror = await instance(directory);
    try {
      await seedProject(source);
      await source.ok([
        "create",
        "--project",
        "AGT",
        "--title",
        "Rotate the deploy key",
      ]);
      await source.ok(["sync", "export", "--project", "AGT"]);
      await seedProject(mirror, ["--sync-role", "mirror"]);
      await mirror.ok(["sync", "import", "--project", "AGT", "--apply"]);

      // The mirror edits the title after the export, so the store is stale
      // for that field and importing would silently lose the local edit.
      await mirror.ok([
        "update",
        "AGT-1",
        "--title",
        "Rotate both deploy keys",
      ]);
      const conflicted = await mirror.cli([
        "sync",
        "import",
        "--project",
        "AGT",
        "--apply",
      ]);
      expect(conflicted.exitCode).toBe(2);
      expect(conflicted.stdout).toContain("CONFLICT");
      expect(conflicted.stdout).toContain("1 conflict(s) refused");
      expect(await mirror.ok(["show", "AGT-1", "--json"])).toContain(
        "Rotate both deploy keys",
      );

      const forced = await mirror.ok([
        "sync",
        "import",
        "--project",
        "AGT",
        "--apply",
        "--force",
      ]);
      expect(forced).toContain("UPDATE");
      expect(await mirror.ok(["show", "AGT-1", "--json"])).toContain(
        "Rotate the deploy key",
      );
    } finally {
      await source.dispose();
      await mirror.dispose();
    }
  });

  it("classifies every drift class from the store and the board", () => {
    const note = (body: string) => ({
      hash: commentHash(body),
      kind: "user" as const,
      authorName: "cli",
      createdAt: "2026-08-23T10:00:00.000Z",
      body,
    });
    const stored = (
      key: string,
      overrides: Partial<SyncTask> = {},
    ): SyncTask => ({
      key,
      number: Number(key.split("-")[1]),
      title: `Task ${key}`,
      status: "todo",
      priority: "none",
      description: "",
      dueDate: null,
      updatedAt: "2026-08-23T10:00:00.000Z",
      comments: [],
      ...overrides,
    });
    const onBoard = (task: SyncTask, id: string): BoardTask => ({
      ...task,
      id,
    });

    const record = {
      version: 1 as const,
      generatedAt: "2026-08-23T11:00:00.000Z",
      project: { prefix: "AGT", name: "Agents" },
      tasks: [
        stored("AGT-1", { comments: [note("Shared note.")] }),
        stored("AGT-2", { priority: "high" }),
        stored("AGT-3", { comments: [note("Only in the store.")] }),
        stored("AGT-4"),
      ],
    };
    const board: BoardTask[] = [
      onBoard(
        stored("AGT-1", {
          comments: [note("Shared note."), note("Only on the board.")],
        }),
        "board-1",
      ),
      onBoard(stored("AGT-2"), "board-2"),
      onBoard(stored("AGT-3"), "board-3"),
      onBoard(stored("AGT-9"), "board-9"),
    ];

    expect(
      checkDrift(record, board).map((entry) => [entry.drift, entry.key]),
    ).toEqual([
      ["AHEAD", "AGT-1"],
      ["DRIFT", "AGT-2"],
      ["BEHIND", "AGT-3"],
      ["MISSING", "AGT-4"],
      ["UNTRACKED", "AGT-9"],
    ]);

    // The plan mirrors the classification: create what is missing, update the
    // changed field, append the unseen note, and leave the board's extra note
    // and untracked task alone.
    expect(
      planImport(record, board, { overwriteNewerBoardEdits: false }).map(
        (action) => [action.kind, action.key],
      ),
    ).toEqual([
      ["update", "AGT-2"],
      ["comment", "AGT-3"],
      ["create", "AGT-4"],
    ]);
  });
});
