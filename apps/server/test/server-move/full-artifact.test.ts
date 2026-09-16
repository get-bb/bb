import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFullBbAppArtifactService } from "../../src/services/server-move/full-artifact.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function writePackageFile(
  root: string,
  relativePath: string,
  body: string,
): Promise<void> {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

function packageJson(version: string): string {
  return JSON.stringify({
    name: "bb-app",
    version,
    dependencies: {},
    engines: { node: ">=22" },
    os: ["linux"],
  });
}

describe("full bb-app artifact availability", () => {
  it("reports the unpacked package size without node_modules and refreshes it for a new version", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-full-artifact-"));
    tempDirs.push(root);
    await writePackageFile(root, "package.json", packageJson("1.2.3"));
    await writePackageFile(root, "dist/bb-server.js", "a".repeat(100));
    await writePackageFile(root, "dist/bb-app.js", "b".repeat(200));
    await writePackageFile(root, "server/dist/index.js", "c".repeat(300));
    await writePackageFile(root, "app/dist/index.html", "d".repeat(400));
    await writePackageFile(
      root,
      "node_modules/pino/index.js",
      "e".repeat(5_000),
    );
    const dataDir = await mkdtemp(join(tmpdir(), "bb-full-artifact-data-"));
    tempDirs.push(dataDir);
    const service = createFullBbAppArtifactService({
      commandRunner: async () => {
        throw new Error("availability never packs the artifact");
      },
      dataDir,
      serverEntryUrl: pathToFileURL(join(root, "server", "dist", "index.js"))
        .href,
    });

    expect(await service.availability()).toEqual({
      available: true,
      unpackedSizeBytes: Buffer.byteLength(packageJson("1.2.3")) + 1_000,
      version: "1.2.3",
    });

    await writePackageFile(root, "package.json", packageJson("1.2.40"));
    await writePackageFile(root, "app/dist/assets/app.js", "f".repeat(1_000));
    expect(await service.availability()).toEqual({
      available: true,
      unpackedSizeBytes: Buffer.byteLength(packageJson("1.2.40")) + 2_000,
      version: "1.2.40",
    });
  });
});
