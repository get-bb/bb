import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  generateGoldenSeed,
  semanticDatabaseDump,
  verifyGoldenSeed,
  type GoldenSeedManifest,
} from "./generate.js";

const FIXTURES = resolve(import.meta.dirname, "../../../mock-remote/fixtures");
const COMMITTED_SEED = import.meta.dirname;
const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `fs-golden-seed-${label}-`));
  roots.push(root);
  return root;
}

function withoutDataDatabaseHash(
  manifest: GoldenSeedManifest,
): GoldenSeedManifest {
  return {
    ...manifest,
    artifacts: manifest.artifacts.map((artifact) =>
      artifact.path.endsWith("data.db")
        ? { ...artifact, sha256: "SQLITE_BYTE_LAYOUT_EXCLUDED" }
        : artifact,
    ),
  };
}

async function treeHashes(root: string): Promise<Record<string, string>> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await walk(root);
  return Object.fromEntries(
    await Promise.all(
      files.sort().map(async (path) => [
        relative(root, path).split(sep).join("/"),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
}

async function rewriteArtifactHash(root: string, path: string): Promise<void> {
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as GoldenSeedManifest;
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.path === path,
  );
  if (!artifact) throw new Error(`missing manifest artifact ${path}`);
  artifact.sha256 = createHash("sha256")
    .update(await readFile(join(root, path)))
    .digest("hex");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("WP-66 Golden Loop seed", () => {
  it("same seed yields same manifest and semantic database dump", async () => {
    const first = await temporaryRoot("same-a");
    const second = await temporaryRoot("same-b");
    const firstManifest = await generateGoldenSeed(first, 66);
    const secondManifest = await generateGoldenSeed(second, 66);
    expect(withoutDataDatabaseHash(firstManifest)).toEqual(
      withoutDataDatabaseHash(secondManifest),
    );
    expect(semanticDatabaseDump(join(first, "warm-cache", "data.db"))).toEqual(
      semanticDatabaseDump(join(second, "warm-cache", "data.db")),
    );
    for (const pvId of [
      "pv-ax3000-2.3",
      "pv-ax3000-2.4",
      "pv-ax3000-unpack-gap",
    ]) {
      expect(
        semanticDatabaseDump(
          join(first, "worktree", ".fs-firmware", pvId, "manifest.sqlite"),
        ),
      ).toEqual(
        semanticDatabaseDump(
          join(second, "worktree", ".fs-firmware", pvId, "manifest.sqlite"),
        ),
      );
    }
  }, 60_000);

  it("records the seed and generator provenance", async () => {
    const first = await generateGoldenSeed(
      await temporaryRoot("provenance-a"),
      66,
    );
    const second = await generateGoldenSeed(
      await temporaryRoot("provenance-b"),
      67,
    );
    expect(first.seed).toBe(66);
    expect(first.generatorVersion).toBe("wp66-v2");
    expect(first.sourceSeed).not.toBe(second.sourceSeed);
  }, 60_000);

  it("verifies the committed Golden Loop seed", async () => {
    await expect(verifyGoldenSeed(COMMITTED_SEED)).resolves.toBeUndefined();
  });

  it("expected drift, policy, KEV, threat, and trace counts hold", async () => {
    const root = await temporaryRoot("counts");
    const manifest = await generateGoldenSeed(root, 66);
    await expect(verifyGoldenSeed(root)).resolves.toBeUndefined();
    expect(manifest.expected).toEqual({
      newUntriaged: 412,
      policyMatches: 306,
      policyWritten: 305,
      heldKev: 1,
      carryForwardRecovered: 14,
      stale: 9,
      orphans: 2,
    });
    expect(
      await readFile(
        join(root, "worktree", ".fs", "threats", "THREAT-22.json"),
        "utf8",
      ),
    ).toContain("ATTACK-PATH-WAN-HTTPD");
    expect(
      await readFile(join(root, "worktree", "src", "v2.4", "httpd.c"), "utf8"),
    ).toContain("request_limit");
  }, 60_000);

  it("all manifest hashes verify", async () => {
    const root = await temporaryRoot("hashes");
    await generateGoldenSeed(root, 66);
    const before = await treeHashes(root);
    await expect(verifyGoldenSeed(root)).resolves.toBeUndefined();
    expect(await treeHashes(root)).toEqual(before);
  }, 60_000);

  it("corrupted cache artifact fails with exact path", async () => {
    const root = await temporaryRoot("corrupt");
    await generateGoldenSeed(root, 66);
    const path = "warm-cache/run-events.json";
    await writeFile(join(root, path), "x", "utf8");
    await expect(verifyGoldenSeed(root)).rejects.toThrow(
      `integrity error: ${path}`,
    );
  }, 60_000);

  it("attestation subject mismatch is rejected", async () => {
    const root = await temporaryRoot("attestation");
    await generateGoldenSeed(root, 66);
    const path = "attestations/ax3000-v24.dsse.json";
    const envelope = JSON.parse(await readFile(join(root, path), "utf8")) as {
      payload: string;
    };
    const statement = JSON.parse(
      Buffer.from(envelope.payload, "base64").toString(),
    ) as {
      subject: Array<{ digest: { sha256: string } }>;
    };
    statement.subject[0]!.digest.sha256 = "0".repeat(64);
    envelope.payload = Buffer.from(JSON.stringify(statement)).toString(
      "base64",
    );
    await writeFile(
      join(root, path),
      `${JSON.stringify(envelope, null, 2)}\n`,
      "utf8",
    );
    await rewriteArtifactHash(root, path);
    await expect(verifyGoldenSeed(root)).rejects.toThrow(
      "attestation subject mismatch",
    );
  }, 60_000);

  it("schema mismatch is rejected", async () => {
    const root = await temporaryRoot("schema");
    await generateGoldenSeed(root, 66);
    const path = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    manifest["seedVersion"] = 2;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await expect(verifyGoldenSeed(root)).rejects.toThrow(
      "manifest schema mismatch",
    );
  }, 60_000);

  it("broken story cross-link is rejected", async () => {
    const root = await temporaryRoot("cross-link");
    await generateGoldenSeed(root, 66);
    const path = "worktree/.fs/golden-loop/story.json";
    const value = JSON.parse(await readFile(join(root, path), "utf8")) as {
      links: { threat: string };
    };
    value.links.threat = "THREAT-BROKEN";
    await writeFile(
      join(root, path),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await rewriteArtifactHash(root, path);
    await expect(verifyGoldenSeed(root)).rejects.toThrow(
      "Golden Loop story cross-link mismatch",
    );
  }, 60_000);

  it("generator writes nothing under the separately owned mock fixture path", async () => {
    const before = await treeHashes(FIXTURES);
    const root = await temporaryRoot("fixture-boundary");
    await generateGoldenSeed(root, 66);
    expect(await treeHashes(FIXTURES)).toEqual(before);
  }, 60_000);
});
