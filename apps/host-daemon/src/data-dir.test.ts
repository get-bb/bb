import { describe, expect, it } from "vitest";
import {
  resolveHostDaemonDataDirOverride,
  resolveHostDaemonProdDataDir,
} from "./data-dir.js";

describe("resolveHostDaemonProdDataDir", () => {
  it("resolves %APPDATA%/bb on win32", () => {
    expect(
      resolveHostDaemonProdDataDir({
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
        homeDir: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\bb");
  });

  it("normalizes forward-slash APPDATA on win32", () => {
    expect(
      resolveHostDaemonProdDataDir({
        env: { APPDATA: "C:/Users/test/AppData/Roaming" },
        homeDir: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\bb");
  });

  it("falls back to the home directory when APPDATA is missing or blank on win32", () => {
    for (const env of [{}, { APPDATA: "" }, { APPDATA: "   " }]) {
      expect(
        resolveHostDaemonProdDataDir({
          env,
          homeDir: "C:\\Users\\test",
          platform: "win32",
        }),
      ).toBe("C:\\Users\\test\\bb");
    }
  });

  it("keeps the homedir .bb default on posix platforms", () => {
    expect(
      resolveHostDaemonProdDataDir({
        env: {},
        homeDir: "/home/test",
        platform: "linux",
      }),
    ).toBe("/home/test/.bb");
    expect(
      resolveHostDaemonProdDataDir({
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
        homeDir: "/Users/test",
        platform: "darwin",
      }),
    ).toBe("/Users/test/.bb");
  });
});

describe("resolveHostDaemonDataDirOverride", () => {
  it("overrides the config default with %APPDATA%/bb for win32 prod", () => {
    expect(
      resolveHostDaemonDataDirOverride({
        env: {
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
          NODE_ENV: "production",
        },
        homeDir: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\bb");
  });

  it("leaves dev mode and explicit BB_DATA_DIR alone on win32", () => {
    expect(
      resolveHostDaemonDataDirOverride({
        env: {
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
          NODE_ENV: "development",
        },
        homeDir: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBeUndefined();
    expect(
      resolveHostDaemonDataDirOverride({
        env: {
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
          BB_DATA_DIR: "D:\\custom\\bb-data",
          NODE_ENV: "production",
        },
        homeDir: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBeUndefined();
  });

  it("never overrides posix platforms", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(
        resolveHostDaemonDataDirOverride({
          env: { NODE_ENV: "production" },
          homeDir: "/home/test",
          platform,
        }),
      ).toBeUndefined();
    }
  });
});
