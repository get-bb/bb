import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ENTITIES } from "../../../lib/sync/registry.js";
import type { IdMapEntry } from "./id-map.js";
import {
  IdmapMirrorWriteError,
  writeIdmapMirror,
  type IdmapMirrorValue,
} from "./idmap-mirror.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "finite-state-idmap-mirror-"));
  roots.push(root);
  return root;
}

function entries(): IdMapEntry[] {
  return [
    {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "generation-threat",
      entityKey: ENTITIES.threat.key({ slug: "threat-z" }),
      remoteId: "remote-threat-z",
    },
    {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "component",
      generationId: "generation-component",
      entityKey: ENTITIES.component.key({ slug: "component-a" }),
      remoteId: "remote-component-a",
    },
  ];
}

function mirrorValue(inputEntries = entries()): IdmapMirrorValue {
  return {
    projectId: "project-a",
    projectVersionId: "version-a",
    acceptedGenerationIds: {
      threat: "generation-threat",
      component: "generation-component",
    },
    baseRevisions: { threat: 7, component: 3 },
    entries: inputEntries,
  };
}

describe("writeIdmapMirror", () => {
  it("atomically renames one complete mirror and leaves no temp file", () => {
    const root = createRoot();

    writeIdmapMirror(root, mirrorValue());

    const directory = join(root, ".fs-sync");
    expect(readdirSync(directory)).toEqual(["idmap.json"]);
    expect(() => JSON.parse(readFileSync(join(directory, "idmap.json"), "utf8")))
      .not.toThrow();
  });

  it("writes byte-identical ordered JSON for the same entries", () => {
    const root = createRoot();
    writeIdmapMirror(root, mirrorValue());
    const file = join(root, ".fs-sync", "idmap.json");
    const first = readFileSync(file, "utf8");

    writeIdmapMirror(root, {
      ...mirrorValue([...entries()].reverse()),
      acceptedGenerationIds: {
        component: "generation-component",
        threat: "generation-threat",
      },
      baseRevisions: { component: 3, threat: 7 },
    });
    const second = readFileSync(file, "utf8");

    expect(second).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(first);
    expect(parsed).toMatchObject({
      projectId: "project-a",
      projectVersionId: "version-a",
      acceptedGenerationIds: {
        component: "generation-component",
        threat: "generation-threat",
      },
      baseRevisions: { component: 3, threat: 7 },
      entries: [
        { entityKind: "component", remoteId: "remote-component-a" },
        { entityKind: "threat", remoteId: "remote-threat-z" },
      ],
    });
  });

  it("surfaces an unwritable machinery directory as a typed error", () => {
    const root = createRoot();
    const directory = join(root, ".fs-sync");
    mkdirSync(directory);
    chmodSync(directory, 0o500);

    let thrown: unknown;
    try {
      writeIdmapMirror(root, mirrorValue());
    } catch (error) {
      thrown = error;
    } finally {
      chmodSync(directory, 0o700);
    }

    expect(thrown).toBeInstanceOf(IdmapMirrorWriteError);
    expect(thrown).toMatchObject({
      file: join(directory, "idmap.json"),
      cause: expect.objectContaining({ code: "EACCES" }),
    });
    expect(readdirSync(directory)).toEqual([]);
  });
});
