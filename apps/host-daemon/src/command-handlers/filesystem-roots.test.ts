import { describe, expect, it } from "vitest";
import { listFilesystemRoots } from "./filesystem-roots.js";

describe("listFilesystemRoots", () => {
  it("returns the single POSIX root without probing", async () => {
    await expect(
      listFilesystemRoots({
        platform: "darwin",
        isDirectory: () => Promise.reject(new Error("should not probe")),
      }),
    ).resolves.toEqual(["/"]);
  });

  it("lists every accessible Windows drive, not just the current one", async () => {
    const mounted = new Set(["C:\\", "G:\\", "H:\\"]);

    await expect(
      listFilesystemRoots({
        platform: "win32",
        isDirectory: async (root) => mounted.has(root),
      }),
    ).resolves.toEqual(["C:\\", "G:\\", "H:\\"]);
  });

  it("omits drives whose probe fails or never settles", async () => {
    await expect(
      listFilesystemRoots({
        platform: "win32",
        probeTimeoutMs: 10,
        isDirectory: (root) => {
          if (root === "C:\\") return Promise.resolve(true);
          if (root === "D:\\") return Promise.reject(new Error("EPERM"));
          if (root === "Z:\\") return new Promise<boolean>(() => {});
          return Promise.resolve(false);
        },
      }),
    ).resolves.toEqual(["C:\\"]);
  });
});
