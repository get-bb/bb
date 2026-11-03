import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRP_VERSION } from "@bb/tunnel-contract/next";
import {
  FRP_ARCHIVE_SHA256,
  FrpBinaryError,
  frpArchiveFor,
  installFrp,
  resolveFrpc,
} from "../src/binary.js";
import { cachedDownload } from "../src/testing/frp-fixture.js";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "connect-next-binary-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("frpArchiveFor", () => {
  it.each([
    ["linux", "x64", "frp_0.71.0_linux_amd64.tar.gz", "frpc"],
    ["linux", "arm64", "frp_0.71.0_linux_arm64.tar.gz", "frpc"],
    ["darwin", "x64", "frp_0.71.0_darwin_amd64.tar.gz", "frpc"],
    ["darwin", "arm64", "frp_0.71.0_darwin_arm64.tar.gz", "frpc"],
    ["win32", "x64", "frp_0.71.0_windows_amd64.zip", "frpc.exe"],
    ["win32", "arm64", "frp_0.71.0_windows_arm64.zip", "frpc.exe"],
  ])("pins %s/%s to %s", (platform, arch, fileName, binaryName) => {
    const archive = frpArchiveFor(platform, arch);
    expect(archive).toMatchObject({
      fileName,
      binaryName,
      url: `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${fileName}`,
      member: `${fileName.replace(/\.(tar\.gz|zip)$/u, "")}/${binaryName}`,
    });
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("has no client for other platforms", () => {
    expect(() => frpArchiveFor("freebsd", "x64")).toThrow(FrpBinaryError);
    expect(() => frpArchiveFor("linux", "ia32")).toThrow(FrpBinaryError);
    expect(Object.keys(FRP_ARCHIVE_SHA256)).toHaveLength(6);
  });
});

describe("installFrp with the real release archives", () => {
  it("verifies, extracts and installs frpc for this machine", async () => {
    const target = path.join(dir, "native");
    const binary = await installFrp({
      dir: target,
      platform: process.platform,
      arch: process.arch,
      download: cachedDownload(process.platform, process.arch),
    });
    expect(path.basename(binary)).toBe(
      process.platform === "win32" ? "frpc.exe" : "frpc",
    );
    const stat = await fs.stat(binary);
    expect(stat.size).toBeGreaterThan(1_000_000);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o111).not.toBe(0);
    }
    expect((await fs.readdir(target)).sort()).toEqual([path.basename(binary)]);
  }, 180_000);

  it("extracts frpc.exe from the Windows zip", async () => {
    const target = path.join(dir, "windows");
    const binary = await installFrp({
      dir: target,
      platform: "win32",
      arch: "x64",
      download: cachedDownload("win32", "x64"),
    });
    const head = (await fs.readFile(binary)).subarray(0, 2).toString("latin1");
    expect(head).toBe("MZ");
  }, 180_000);

  it("refuses an archive whose sha256 does not match the pin", async () => {
    const target = path.join(dir, "tampered");
    const real = cachedDownload(process.platform, process.arch);
    const tampered = async (url: string) => {
      const bytes = new Uint8Array(await real(url));
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      return bytes;
    };
    await expect(
      installFrp({
        dir: target,
        platform: process.platform,
        arch: process.arch,
        download: tampered,
      }),
    ).rejects.toThrow(/does not match its pinned sha256/u);
    await expect(fs.readdir(target)).rejects.toThrow();
  }, 180_000);
});

describe("resolveFrpc", () => {
  it("uses BB_CONNECT_FRPC instead of downloading", async () => {
    const fake = path.join(dir, "my-frpc");
    await fs.writeFile(fake, "");
    const download = async () => {
      throw new Error("must not download");
    };
    await expect(
      resolveFrpc({ dataDir: dir, env: { BB_CONNECT_FRPC: fake }, download }),
    ).resolves.toBe(fake);
    await expect(
      resolveFrpc({
        dataDir: dir,
        env: { BB_CONNECT_FRPC: path.join(dir, "missing") },
        download,
      }),
    ).rejects.toThrow(/BB_CONNECT_FRPC names/u);
  });

  it("installs into <data dir>/frp/<version>", async () => {
    const dataDir = path.join(dir, "data");
    const binary = await resolveFrpc({
      dataDir,
      env: {},
      download: cachedDownload(process.platform, process.arch),
    });
    expect(path.dirname(binary)).toBe(path.join(dataDir, "frp", FRP_VERSION));
  }, 180_000);
});
