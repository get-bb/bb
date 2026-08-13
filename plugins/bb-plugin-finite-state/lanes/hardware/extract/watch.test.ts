import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { listArtifactStatus, recordArtifact } from "./provenance.js";
import { HardwareSourceWatcher, refuseAutomaticExtraction } from "./watch.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())));

describe("hardware source watch", () => {
  it("publishes a stale refetch hint without invoking extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-hw-watch-"));
    const schematic = join(root, "board.kicad_sch");
    await writeFile(schematic, "before");
    const host = createFakePluginHost({ pluginId: `hw-watch-${Math.random()}` });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const scope = { projectId: "project", projectVersionId: "@project", projectKey: "board.kicad_pro" };
    db.prepare(
      `INSERT INTO hw_project (project_id, project_version_id, project_key, name, sch_path, sch_hash, discovered_at)
       VALUES ('project', '@project', 'board.kicad_pro', 'board', 'board.kicad_sch', 'old', '2026-01-01T00:00:00.000Z')`,
    ).run();
    recordArtifact(db, scope, {
      kind: "bom", sheetPath: null, path: ".fs-hw/cache/bom.csv",
      sourceHash: "old", cliVersion: "8.0.4", generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const publish = vi.fn();
    const subprocess = vi.fn();
    const watcher = new HardwareSourceWatcher({ db, scope, schematicPath: schematic, boardPath: null, publish, debounceMs: 10 });
    watcher.start();
    await writeFile(schematic, "after");
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    watcher.stop();
    expect(subprocess).not.toHaveBeenCalled();
    expect(db.prepare("SELECT source_hash FROM hw_artifact WHERE kind = 'bom'").pluck().get()).toBe("old");
    expect(listArtifactStatus(db, scope, {
      schematic: createHash("sha256").update("after").digest("hex"),
      board: null,
    })[0]?.fresh).toBe(false);
  });

  it("refuses every automatic regeneration path, including active agent runs", () => {
    expect(() => refuseAutomaticExtraction(false)).toThrow("explicit extraction request");
    expect(() => refuseAutomaticExtraction(true)).toThrow("during an agent run");
  });
});
import { createHash } from "node:crypto";
