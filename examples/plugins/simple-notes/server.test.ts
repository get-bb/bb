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
        read: async ({ path: filePath }) => ({
          content: await readFile(filePath, "utf8"),
          sha256: "test-sha",
        }),
      },
    },
  });
  await simpleNotes(host.bb);
  return host;
}

describe("simple notes mention provider", () => {
  it("searches note titles, previews, and filenames", async () => {
    const { harness } = await loadNotebook({
      "roadmap.md": "# Product Roadmap\n\nQuarterly priorities",
      "meeting-notes.md": "# Standup\n\nLaunch checklist",
    });
    const provider = harness.registrations.mentionProviders[0]!;

    expect(provider).toMatchObject({
      id: "note",
      label: "Simple Notes",
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
        id: "meeting-notes.md",
        title: "Standup",
        subtitle: "Launch checklist",
        icon: "FileText",
      },
    ]);
  });

  it("resolves the note's current content at send time", async () => {
    const { harness } = await loadNotebook({
      "ideas.md": "# Fresh Ideas\n\nBuild the mention flow.",
    });
    const provider = harness.registrations.mentionProviders[0]!;

    await expect(provider.resolve("ideas.md")).resolves.toEqual({
      context:
        'Simple Note "Fresh Ideas" (ideas.md):\n\n# Fresh Ideas\n\nBuild the mention flow.',
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
