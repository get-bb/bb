import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { registerActionTools } from "../agentic/tools/actions.js";
import {
  openManifest,
  verifyMountIntegrity,
  type FirmwareManifestMeta,
  type FirmwareNode,
} from "../firmware/cache/manifest.js";
import { rootfsPath } from "../firmware/cache/layout.js";
import { computeForgeArtifactHash } from "../firmware/forge/artifact-hash.js";
import { registerRemoteServices } from "../remote/register.js";
import { registerBenchAgentAction } from "./agent-action.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeReadyMount(root: string): Promise<string> {
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
  return (await computeForgeArtifactHash(rootfs, new AbortController().signal))
    .artifactHash;
}

describe("registered bench agent action", () => {
  it("returns the durable failed run identity without widening the frozen tool surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-agent-bench-attempt-"));
    roots.push(root);
    const artifactHash = await writeReadyMount(root);
    const host = createFakePluginHost({
      pluginId: `fs-action-bench-attempt-${crypto.randomUUID()}`,
    });
    hosts.push(host);
    host.harness.sdk.stub("threads.get", async () => ({
      id: "thread-test",
      projectId: "project-test",
      environmentId: "environment-test",
    }));
    host.harness.sdk.stub("environments.get", async () => ({
      id: "environment-test",
      projectId: "project-test",
      path: root,
      hostId: "host-test",
    }));
    host.harness.sdk.stub("projects.get", async () => ({
      id: "project-test",
      kind: "standard",
      name: "Project Test",
      gitRemoteUrl: null,
      createdAt: 1,
      updatedAt: 1,
      sources: [
        {
          id: "source-test",
          projectId: "project-test",
          type: "local_path",
          hostId: "host-test",
          path: root,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }));
    host.harness.sdk.stub("hosts.list", async () => []);
    const ctx = createPluginContext(host.bb);
    await registerRemoteServices(host.bb, ctx);
    const at = "2026-08-14T04:30:00.000Z";
    ctx
      .db()
      .prepare(
        `INSERT INTO pull_generation
          (project_id, project_version_id, generation_id, status,
           requested_kinds_json, started_at, accepted_at)
         VALUES ('project-test', 'pv-1', 'generation-1', 'accepted',
                 '["verificationRun"]', ?, ?)`,
      )
      .run(at, at);
    ctx
      .db()
      .prepare(
        `INSERT INTO sync_state
          (project_id, project_version_id, entity_kind,
           accepted_generation_id, last_pull)
         VALUES ('project-test', 'pv-1', 'verificationRun',
                 'generation-1', ?)`,
      )
      .run(at);
    ctx
      .db()
      .prepare(
        `INSERT INTO firmware_mounts
          (project_id, project_version_id, generation_id, source, state,
           input_sha256, artifact_hash, root_path, file_count,
           materialized_files, error_count, pulled_at)
         VALUES ('project-test', 'pv-1', 'generation-1', 'standalone_unpack',
                 'ready', ?, ?, ?, 1, 1, 0, ?)`,
      )
      .run(sha256("input"), artifactHash, rootfsPath(root, "pv-1"), at);
    registerBenchAgentAction(
      ctx,
      () =>
        ctx.service<RemoteServices>("remote-services", () => {
          throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
        }),
      {
        enqueue: vi.fn(),
        take: vi.fn(async () => {
          throw new Error("No queued bench job");
        }),
      },
    );
    registerActionTools(host.bb, ctx);

    const result = await host.harness.behavior.callAgentTool(
      "fs_bench_run",
      { pvId: "pv-1", tier: "tier0" },
      { projectId: "project-test", threadId: "thread-test" },
    );
    const failed = ctx
      .db()
      .prepare<
        [],
        { run_id: string; status: string }
      >("SELECT run_id, status FROM verification_runs WHERE project_id='project-test'")
      .get();
    expect(failed).toEqual({
      run_id: expect.stringMatching(/^bench-/u),
      status: "failed",
    });
    if (!failed) throw new Error("Expected one durable failed bench run");
    expect(JSON.stringify(result)).toContain(failed.run_id);
    expect(JSON.stringify(result)).toMatch(
      /HOST_NOT_ENROLLED.*Fix the selected firmware mount or bench prerequisites before retrying/iu,
    );
    expect(host.harness.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
});
