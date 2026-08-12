import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSnapshot, validateMaxDepth } from "./snapshot-schema.js";

const inputDigest = createHash("sha256").update("firmware").digest("hex");
const fileDigest = createHash("sha256").update("payload").digest("hex");

function goldenSnapshot() {
  return {
    input_file: "firmware.bin",
    input_sha256: inputDigest,
    file_tree: [
      {
        file_path: "/bin/tool",
        file_hash: fileDigest,
        file_name: "tool",
        mime_type: "application/octet-stream",
        full_type: "ELF executable",
        file_size: 7,
      },
    ],
    unpack_metadata: {
      [fileDigest]: {
        tried: ["tar"],
        tried_version: "1",
        used: "tar",
        used_version: "1",
      },
    },
    errors: [],
  };
}

describe("standalone unpack snapshot schema", () => {
  it("parses the complete FACT snapshot contract", () => {
    expect(parseSnapshot(goldenSnapshot(), inputDigest)).toMatchObject({
      inputFile: "firmware.bin",
      inputSha256: inputDigest,
      fileTree: [{ filePath: "/bin/tool", fileHash: fileDigest, fileSize: 7 }],
      unpackMetadata: { [fileDigest]: { tried: ["tar"], triedVersion: "1" } },
      errors: [],
    });
  });

  it("rejects a missing required field", () => {
    const { file_tree: _fileTree, ...missing } = goldenSnapshot();
    expect(() => parseSnapshot(missing, inputDigest)).toThrow(
      /does not match/iu,
    );
  });

  it("rejects an extractor digest that differs from the preflight digest", () => {
    expect(() => parseSnapshot(goldenSnapshot(), "0".repeat(64))).toThrow(
      /does not match/iu,
    );
  });

  it.each(["../escape", "/a/../escape", "C:\\host\\file", "/a\\b"])(
    "rejects unsafe snapshot path %s",
    (filePath) => {
      const snapshot = goldenSnapshot();
      snapshot.file_tree[0]!.file_path = filePath;
      expect(() => parseSnapshot(snapshot, inputDigest)).toThrow(/unsafe/iu);
    },
  );

  it("rejects duplicate normalized paths", () => {
    const snapshot = goldenSnapshot();
    snapshot.file_tree.push({
      ...snapshot.file_tree[0]!,
      file_path: "bin/tool",
    });
    expect(() => parseSnapshot(snapshot, inputDigest)).toThrow(/duplicate/iu);
  });

  it("rejects malformed global errors instead of silently dropping them", () => {
    const snapshot = {
      ...goldenSnapshot(),
      errors: { message: "not an array" },
    };
    expect(() => parseSnapshot(snapshot, inputDigest)).toThrow(
      /does not match/iu,
    );
  });

  it.each([0, 13, 1.5, Number.NaN])(
    "rejects unsupported maximum depth %s",
    (depth) => {
      expect(() => validateMaxDepth(depth)).toThrow(/1 to 12/iu);
    },
  );
});
