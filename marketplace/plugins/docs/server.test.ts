import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import simpleNotes from "./server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function loadNotebook(notes: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bb-simple-notes-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(notes).map(([name, content]) =>
      writeFile(path.join(directory, name), content),
    ),
  );
  const host = createFakePluginHost({
    pluginId: "simple-notes",
    settings: { directory },
    sdk: {
      files: {
        listPaths: async () => ({
          paths: Object.keys(notes).map((name) => ({
            kind: "file" as const,
            path: name,
            name,
            score: 0,
            positions: [],
          })),
          truncated: false,
        }),
        read: async ({ path: filePath }) => ({
          content: await readFile(filePath, "utf8"),
          sha256: "test-sha",
        }),
        write: async () => ({
          outcome: "written" as const,
          sha256: "written-sha",
          sizeBytes: 1,
        }),
        mkdir: async () => ({ ok: true as const }),
        move: async () => ({ ok: true as const }),
        remove: async () => ({ ok: true as const }),
        createPreview: async () => ({
          baseUrl: "/api/v1/file-previews/test",
          expiresAtMs: Date.now() + 60_000,
        }),
      },
      hosts: { list: async () => [] },
    },
  });
  await simpleNotes(host.bb);
  return host;
}

async function waitForSignal(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for signal");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Docs mention provider", () => {
  it("searches note titles, previews, and filenames", async () => {
    const { harness } = await loadNotebook({
      "roadmap.md": "# Product Roadmap\n\nQuarterly priorities",
      "meeting-notes.md": "# Standup\n\nLaunch checklist",
    });
    const provider = harness.registrations.mentionProviders[0]!;

    expect(provider).toMatchObject({
      id: "note",
      label: "Docs",
      triggers: ["@"],
    });
    await expect(
      provider.search({
        trigger: "@",
        query: "launch",
        projectId: null,
        threadId: null,
      }),
    ).resolves.toEqual([
      {
        id: "personal:meeting-notes.md",
        title: "Standup",
        subtitle: "Personal · Launch checklist",
        icon: "FileText",
      },
    ]);
  });

  it("resolves the note's current content at send time", async () => {
    const { harness } = await loadNotebook({
      "ideas.md": "# Fresh Ideas\n\nBuild the mention flow.",
    });
    const provider = harness.registrations.mentionProviders[0]!;

    await expect(provider.resolve("personal:ideas.md")).resolves.toEqual({
      context:
        "Docs document (personal/ideas.md):\n\n# Fresh Ideas\n\nBuild the mention flow.",
    });
    expect(harness.sdk.callsTo("files.read")).toEqual([
      [
        {
          path: path.join(temporaryDirectories[0]!, "ideas.md"),
          rootPath: temporaryDirectories[0],
        },
      ],
    ]);
  });
});

describe("Docs vault operations", () => {
  it("registers the agent-discoverable Docs CLI", async () => {
    const { harness } = await loadNotebook({ "plan.md": "# Plan" });
    expect(harness.registrations.cli).toMatchObject({
      name: "docs",
      summary: "Read and update Docs vaults",
    });
  });

  it("persists a manual file order per vault folder", async () => {
    const { harness } = await loadNotebook({
      "first.md": "# First",
      "second.md": "# Second",
    });

    await expect(
      harness.callRpc("reorderFiles", {
        vaultId: "personal",
        parent: "",
        paths: ["second.md", "first.md"],
      }),
    ).resolves.toEqual({ paths: ["second.md", "first.md"] });

    await expect(
      harness.callRpc("listNotes", { vaultId: "personal" }),
    ).resolves.toMatchObject({
      entryOrder: ["second.md", "first.md"],
    });
  });

  it("keeps nested mutations confined to the selected vault root", async () => {
    const { harness } = await loadNotebook({ "draft.md": "# Draft" });
    const rootPath = temporaryDirectories[0]!;

    await expect(
      harness.callRpc("createFolder", {
        vaultId: "personal",
        path: "projects",
      }),
    ).resolves.toEqual({ path: "projects" });
    await expect(
      harness.callRpc("movePath", {
        vaultId: "personal",
        from: "draft.md",
        to: "projects/plan.md",
      }),
    ).resolves.toEqual({ path: "projects/plan.md" });

    expect(harness.sdk.callsTo("files.mkdir")).toEqual([
      [{ path: rootPath, recursive: true }],
      [
        {
          path: path.join(rootPath, "projects"),
          rootPath,
          recursive: false,
        },
      ],
    ]);
    expect(harness.sdk.callsTo("files.move")).toEqual([
      [
        {
          sourcePath: path.join(rootPath, "draft.md"),
          destinationPath: path.join(rootPath, "projects", "plan.md"),
          rootPath,
        },
      ],
    ]);
  });

  it("opens and saves absolute host Markdown files for the file opener", async () => {
    const { harness } = await loadNotebook({ "plan.md": "# Plan" });
    const rootPath = temporaryDirectories[0]!;
    const filePath = path.join(rootPath, "plan.md");
    const source = {
      kind: "host",
      threadId: "thread_1",
      environmentId: null,
      projectId: "project_1",
    };

    await expect(
      harness.callRpc("openFile", { source, path: filePath }),
    ).resolves.toMatchObject({
      file: { content: "# Plan", sha256: "test-sha" },
      previewPath: "plan.md",
    });
    await expect(
      harness.callRpc("saveOpenedFile", {
        source,
        path: filePath,
        content: "# Updated",
        expectedSha256: "test-sha",
      }),
    ).resolves.toMatchObject({ outcome: "written", sha256: "written-sha" });
    expect(harness.sdk.callsTo("files.write").at(-1)).toEqual([
      {
        path: filePath,
        rootPath,
        content: "# Updated",
        expectedSha256: "test-sha",
      },
    ]);
  });

  it("publishes native filesystem changes without waiting for the poll", async () => {
    const { harness } = await loadNotebook({ "plan.md": "# Plan" });
    const service = harness.runService("watch-vaults");
    try {
      await writeFile(
        path.join(temporaryDirectories[0]!, "plan.md"),
        "# Changed outside Docs",
      );
      await waitForSignal(() =>
        harness.realtimeSignals.some(
          (signal) =>
            signal.channel === "vault-changed" &&
            signal.payload.vaultId === "personal",
        ),
      );
    } finally {
      service.controller.abort();
      await service.done;
    }
  });
});
