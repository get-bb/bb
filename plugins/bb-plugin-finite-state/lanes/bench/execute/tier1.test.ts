import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openManifest,
  verifyMountIntegrity,
  type FirmwareManifestMeta,
  type FirmwareNode,
} from "../../firmware/cache/manifest.js";
import { rootfsPath } from "../../firmware/cache/layout.js";
import {
  prepareFirmwareForBench,
  type BenchProcessLaunch,
} from "../../firmware/forge/handshake.js";
import { dispatchTier1, validateDeploymentContext } from "./tier1.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function preparedFixture() {
  const root = await mkdtemp(join(tmpdir(), "fs-tier1-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n");
  const rootfs = rootfsPath(root, "pv-1");
  await mkdir(join(rootfs, "bin"), { recursive: true });
  await writeFile(join(rootfs, "bin/app"), "verified bytes");
  const node: FirmwareNode = {
    path: "/bin/app",
    kind: "file",
    fileHash: sha256("verified bytes"),
    size: 14,
    mimeType: "application/octet-stream",
    fullType: null,
    unixMode: 0o755,
    unixUid: 0,
    unixGid: 0,
    isSetuid: false,
    isSetgid: false,
    symlinkTarget: null,
    materialized: true,
    errors: [],
  };
  const meta: FirmwareManifestMeta = {
    pvId: "pv-1",
    scanId: "scan-1",
    inputSha256: sha256("input"),
    source: "standalone_unpack",
    artifactHash: null,
    fullyMaterialized: true,
    materializedAt: new Date(0).toISOString(),
    nodeCount: 1,
    hydratedCount: 1,
    adminBytesOk: true,
    unpackErrors: [],
    stale: false,
  };
  const manifest = openManifest(root, "pv-1");
  try {
    manifest.replaceNodes([node], meta);
    verifyMountIntegrity(manifest);
  } finally {
    manifest.close();
  }
  const prepared = await prepareFirmwareForBench(
    { worktreeRoot: root },
    "pv-1",
    new AbortController().signal,
  );
  return { root, rootfs, prepared };
}

const deploymentContext = {
  productType: "gateway",
  networkExposure: "internet",
  regulatory: "CRA",
  deploymentNotes: "Production edge",
  rootComponentName: "Eagle",
  rootComponentType: "firmware",
};

const targets = {
  verdictIds: ["verdict-1"],
  cveId: "CVE-2026-0001",
  componentId: "component-1",
  findingId: "finding-1",
};

describe("Tier 1 execution", () => {
  it("passes the sealed prepared environment before strict verify_dynamic and pen_test_run", async () => {
    const fixture = await preparedFixture();
    const start = vi.fn(async (_launch: BenchProcessLaunch) => undefined);
    const verifyDynamic = vi.fn(async () => ({ job_id: "dynamic-1" }));
    const penTestRun = vi.fn(async () => ({ jobId: "pentest-1" }));
    await expect(
      dispatchTier1(
        {
          forgeCompute: { verifyDynamic, penTestRun },
          firmwareHandshake: { worktreeRoot: fixture.root },
          forgeProcess: {
            kind: "plugin_owned_stdio",
            hostId: "host-1",
            command: ["forge", "serve"],
            start,
          },
        },
        {
          projectId: "project-a",
          pvId: "pv-1",
          prepared: fixture.prepared,
          targets,
          deploymentContext,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual(["dynamic-1", "pentest-1"]);
    expect(start.mock.calls[0]?.[0].environment).toEqual(fixture.prepared.environment);
    expect(verifyDynamic).toHaveBeenCalledWith(
      { projectVersionId: "pv-1", verdictIds: ["verdict-1"] },
      expect.anything(),
    );
    expect(penTestRun).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentContext, cveId: targets.cveId }),
      expect.anything(),
    );
  });

  it("requires every strict deployment-context field", () => {
    expect(() =>
      validateDeploymentContext({ ...deploymentContext, regulatory: "" }),
    ).toThrow("DEPLOYMENT_CONTEXT_INVALID: regulatory");
    const missingField = { ...deploymentContext };
    Reflect.deleteProperty(missingField, "rootComponentType");
    expect(() => validateDeploymentContext(missingField)).toThrow(
      "DEPLOYMENT_CONTEXT_INVALID: rootComponentType",
    );
    expect(() => validateDeploymentContext(undefined)).toThrow("DEPLOYMENT_CONTEXT_REQUIRED");
  });

  it("makes zero Forge action calls when bytes mutate after preparation", async () => {
    const fixture = await preparedFixture();
    await writeFile(join(fixture.rootfs, "bin/app"), "mutated bytes");
    const verifyDynamic = vi.fn(async () => ({ job_id: "unexpected" }));
    const penTestRun = vi.fn(async () => ({ jobId: "unexpected" }));
    await expect(
      dispatchTier1(
        {
          forgeCompute: { verifyDynamic, penTestRun },
          firmwareHandshake: { worktreeRoot: fixture.root },
          forgeProcess: {
            kind: "plugin_owned_stdio",
            hostId: "host-1",
            command: ["forge"],
            start: async () => undefined,
          },
        },
        {
          projectId: "project-a",
          pvId: "pv-1",
          prepared: fixture.prepared,
          targets,
          deploymentContext,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_CHANGED_DURING_PREPARE" });
    expect(verifyDynamic).not.toHaveBeenCalled();
    expect(penTestRun).not.toHaveBeenCalled();
  });

  it("does not dispatch when the prepared-root lifecycle seam is unavailable", async () => {
    const fixture = await preparedFixture();
    const verifyDynamic = vi.fn(async () => ({ job_id: "unexpected" }));
    const penTestRun = vi.fn(async () => ({ jobId: "unexpected" }));
    await expect(
      dispatchTier1(
        {
          forgeCompute: { verifyDynamic, penTestRun },
          firmwareHandshake: { worktreeRoot: fixture.root },
          forgeProcess: { kind: "remote", reason: "no prepared-root registration" },
        },
        {
          projectId: "project-a",
          pvId: "pv-1",
          prepared: fixture.prepared,
          targets,
          deploymentContext,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_REGISTRATION_UNAVAILABLE" });
    expect(verifyDynamic).not.toHaveBeenCalled();
    expect(penTestRun).not.toHaveBeenCalled();
  });
});
