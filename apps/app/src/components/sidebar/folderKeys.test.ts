import { describe, expect, it } from "vitest";
import {
  buildFolderKey,
  folderKeyForThreadFolder,
  normalizeFolderName,
} from "./folderKeys";

describe("normalizeFolderName", () => {
  it("trims names without treating slashes as hierarchy", () => {
    expect(normalizeFolderName(" Work / Q3 ")).toBe("Work / Q3");
    expect(normalizeFolderName("///")).toBe("///");
  });

  it("returns null for empty names", () => {
    expect(normalizeFolderName("   ")).toBeNull();
    expect(normalizeFolderName(null)).toBeNull();
    expect(normalizeFolderName(undefined)).toBeNull();
  });
});

describe("buildFolderKey", () => {
  it("namespaces a folder id by its container id", () => {
    expect(buildFolderKey("chronological", "fld_1")).toBe(
      "chronological::fld_1",
    );
  });
});

describe("folderKeyForThreadFolder", () => {
  it("returns the container-scoped key for a folder id", () => {
    expect(folderKeyForThreadFolder("chronological", "fld_1")).toBe(
      "chronological::fld_1",
    );
  });

  it("returns null when a thread has no folder", () => {
    expect(folderKeyForThreadFolder("chronological", null)).toBeNull();
    expect(folderKeyForThreadFolder("chronological", undefined)).toBeNull();
  });
});
