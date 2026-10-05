import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { createVitest } from "vitest/node";
import {
  sharedWorkerProjects,
  SharedWorkerSequencer,
} from "../../../vitest.shared.ts";

it("reproduces seeded file order while running isolated files before shared files", async () => {
  const root = mkdtempSync(join(tmpdir(), "bb-vitest-sequencer-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 4; index += 1) {
    writeFileSync(
      join(root, `shared-${index}.test.ts`),
      "it('shared', () => {});",
    );
    writeFileSync(
      join(root, `isolated-${index}.test.ts`),
      "vi.stubEnv('SEQUENCER_FIXTURE', '1'); it('isolated', () => {});",
    );
  }

  async function orderedFiles(seed) {
    const context = await createVitest("test", {
      root,
      config: false,
      watch: false,
      sequence: { shuffle: true, seed },
      projects: sharedWorkerProjects({
        pkgDir: root,
        name: "sequencer-fixture",
        include: ["**/*.test.ts"],
      }),
    });
    try {
      const specifications = await context.globTestSpecifications();
      const sorted = await new SharedWorkerSequencer(context).sort(
        specifications,
      );
      expect(sorted).toHaveLength(8);
      expect(
        sorted.map((specification) => specification.project.config.isolate),
      ).toEqual([true, true, true, true, false, false, false, false]);
      return sorted.map((specification) =>
        relative(root, specification.moduleId),
      );
    } finally {
      await context.close();
    }
  }

  const first = await orderedFiles(4721);
  expect(await orderedFiles(4721)).toEqual(first);
  expect(await orderedFiles(3638)).not.toEqual(first);
});
