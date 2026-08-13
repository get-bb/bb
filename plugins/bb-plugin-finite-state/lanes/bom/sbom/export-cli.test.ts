import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRemoteArtifact,
  RemoteError,
  type RemoteArtifact,
} from "../../../lib/remote/types.js";
import { handleSbomExportCli } from "./export-cli.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "fs-sbom-export-"));
  roots.push(value);
  return value;
}

function artifact(bytes: Uint8Array, options?: { fail?: boolean }): RemoteArtifact {
  return createRemoteArtifact({
    service: "platform",
    mediaType: "application/vnd.cyclonedx+json",
    size: options?.fail ? null : bytes.byteLength,
    sha256: options?.fail ? null : createHash("sha256").update(bytes).digest("hex"),
    async *stream() {
      yield bytes.subarray(0, Math.min(4, bytes.byteLength));
      if (options?.fail) throw new Error("reset from /private/upstream");
      yield bytes.subarray(Math.min(4, bytes.byteLength));
    },
  });
}

describe("SBOM export CLI handler", () => {
  it("writes byte-identically through a plugin-owned sibling and publishes atomically", async () => {
    const outputRoot = await root();
    const bytes = Buffer.from('{"bomFormat":"CycloneDX"}\n');
    const downloadSbom = vi.fn(async () => artifact(bytes));
    const result = await handleSbomExportCli(
      { platform: { downloadSbom }, permittedOutputRoot: outputRoot, createId: () => "fixed" },
      ["--version", "pv-1", "--format", "cyclonedx", "-o", "sbom.json", "--json"],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBeUndefined();
    expect(await readFile(join(outputRoot, "sbom.json"))).toEqual(bytes);
    expect(await readdir(outputRoot)).toEqual(["sbom.json"]);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      filename: "finite-state-sbom.cdx.json",
      contentType: "application/vnd.cyclonedx+json",
      bytes: bytes.byteLength,
      format: "cyclonedx-json",
      includeVex: true,
      written: true,
    });
    expect(result.stdout).not.toContain(outputRoot);
    expect(result.stdout).not.toContain(bytes.toString("utf8"));
    expect(downloadSbom).toHaveBeenCalledWith(
      { projectVersionId: "pv-1", format: "cyclonedx", includeVex: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refuses an existing destination before starting the upstream export", async () => {
    const outputRoot = await root();
    const destination = join(outputRoot, "existing.json");
    await writeFile(destination, "user-owned");
    const downloadSbom = vi.fn();

    const result = await handleSbomExportCli(
      { platform: { downloadSbom }, permittedOutputRoot: outputRoot },
      ["--version", "pv-1", "--format", "spdx", "-o", destination],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("SBOM_OUTPUT_EXISTS");
    expect(downloadSbom).not.toHaveBeenCalled();
    expect(await readFile(destination, "utf8")).toBe("user-owned");
  });

  it("refuses terminal binary output and explains -o without contacting Platform", async () => {
    const outputRoot = await root();
    const downloadSbom = vi.fn();
    const result = await handleSbomExportCli(
      { platform: { downloadSbom }, permittedOutputRoot: outputRoot },
      ["--version", "pv-1", "--format", "cyclonedx"],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Binary SBOM output.*-o <file>/u);
    expect(downloadSbom).not.toHaveBeenCalled();
  });

  it("passes --no-include-vex exactly and returns metadata without SBOM bytes", async () => {
    const outputRoot = await root();
    const bytes = Buffer.from("SENSITIVE-SBOM-BYTES");
    const downloadSbom = vi.fn(async () => artifact(bytes));
    const result = await handleSbomExportCli(
      { platform: { downloadSbom }, permittedOutputRoot: outputRoot },
      ["--version", "pv-1", "--format", "spdx", "--no-include-vex", "--json"],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain(bytes.toString("utf8"));
    expect(JSON.parse(result.stdout ?? "")).toMatchObject({
      format: "spdx",
      includeVex: false,
      written: false,
    });
    expect(downloadSbom).toHaveBeenCalledWith(
      { projectVersionId: "pv-1", format: "spdx", includeVex: false },
      expect.anything(),
    );
  });

  it("fails closed on rate-limit exhaustion without a partial or destination", async () => {
    const outputRoot = await root();
    const downloadSbom = vi.fn(async () => {
      throw new RemoteError("raw upstream 429 /secret/path", {
        service: "platform",
        code: "REMOTE_RATE_LIMITED",
        status: 429,
        retryable: true,
        retryAfterMs: 4_100,
        details: null,
      });
    });
    const result = await handleSbomExportCli(
      { platform: { downloadSbom }, permittedOutputRoot: outputRoot, createId: () => "fixed" },
      ["--version", "pv-1", "--format", "cyclonedx", "-o", "sbom.json"],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Retry in 5 seconds");
    expect(result.stderr).not.toMatch(/secret|\/path/iu);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("removes only its partial after a stream reset and preserves user files", async () => {
    const outputRoot = await root();
    await writeFile(join(outputRoot, "keep.txt"), "keep");
    const bytes = Buffer.from("partial-body");
    const result = await handleSbomExportCli(
      {
        platform: { downloadSbom: async () => artifact(bytes, { fail: true }) },
        permittedOutputRoot: outputRoot,
        createId: () => "fixed",
      },
      ["--version", "pv-1", "--format", "cyclonedx", "-o", "sbom.json"],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no partial output was kept");
    expect(await readdir(outputRoot)).toEqual(["keep.txt"]);
    expect(await readFile(join(outputRoot, "keep.txt"), "utf8")).toBe("keep");
  });

  it("rejects a symlink escape from the permitted output boundary", async () => {
    const outputRoot = await root();
    const outside = await root();
    await symlink(outside, join(outputRoot, "escape"));
    const downloadSbom = vi.fn();
    const result = await handleSbomExportCli(
      { platform: { downloadSbom }, permittedOutputRoot: outputRoot },
      ["--version", "pv-1", "--format", "spdx", "-o", "escape/sbom.json"],
      { cwd: outputRoot },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("SBOM_OUTPUT_OUTSIDE_BOUNDARY");
    expect(downloadSbom).not.toHaveBeenCalled();
    expect(await readdir(outside)).toEqual([]);
  });
});
