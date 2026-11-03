import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { copyVerifiedFile } from "../src/index.js";

describe("copyVerifiedFile", () => {
  it("rejects a missing source without leaving a destination file", async () => {
    const root = await makeTempDir();
    const destinationPath = path.join(root, "copy.bin");

    await expect(
      copyVerifiedFile({
        destinationPath,
        expected: { maxBytes: 4, sha256: null, sizeBytes: 4 },
        label: "Missing file",
        mode: 0o644,
        sourcePath: path.join(root, "missing.bin"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(destinationPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not leave an unhandled source error when the destination cannot be created", async () => {
    const root = await makeTempDir();
    const destinationPath = path.join(root, "existing.bin");
    await writeFile(destinationPath, "keep");

    await expect(
      copyVerifiedFile({
        destinationPath,
        expected: { maxBytes: 4, sha256: null, sizeBytes: 4 },
        label: "Missing file",
        mode: 0o644,
        sourcePath: path.join(root, "missing.bin"),
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(readFile(destinationPath, "utf8")).resolves.toBe("keep");
  });
});
