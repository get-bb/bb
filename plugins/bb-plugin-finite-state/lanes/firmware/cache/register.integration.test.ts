import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost, makeThreadResponse } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { registerRemoteServices } from "../../remote/register.js";
import { registerSync } from "../../sync/register.js";
import {
  createFirmwareCommandHandlers,
  redactFirmwareApiError,
  configureStandaloneUnpackRuntime,
  getStandaloneUnpackInputRegistry,
  registerFirmware,
  StandaloneUnpackInputRegistry,
} from "../register.js";

const roots: string[] = [];

const fakeWrapperSource = String.raw`
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const argv = process.argv.slice(2);
const input = argv[0];
const output = argv[argv.indexOf("-d") + 1];
const snapshotPath = argv[argv.indexOf("-o") + 1];
const bytes = await readFile(input);
if (bytes.toString() === "hang") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
const payload = Buffer.from("registered:" + bytes.toString());
const inputHash = createHash("sha256").update(bytes).digest("hex");
const fileHash = createHash("sha256").update(payload).digest("hex");
await mkdir(join(output, "bin"), { recursive: true });
await writeFile(join(output, "bin", "firmware.txt"), payload);
await writeFile(snapshotPath, JSON.stringify({
  input_file: basename(input),
  input_sha256: inputHash,
  file_tree: [{
    file_path: "/bin/firmware.txt",
    file_hash: fileHash,
    file_name: "firmware.txt",
    mime_type: "text/plain",
    full_type: "ASCII text",
    file_size: payload.length,
  }],
  unpack_metadata: {},
  errors: [],
}));
`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const firmwareMethods = [
  "firmwareDiff",
  "firmwareFileGet",
  "firmwareFileHydrate",
  "firmwareInputIssue",
  "firmwareMaterializeCancel",
  "firmwareMaterializeStart",
  "firmwareMountGet",
  "firmwareMountsList",
  "firmwareTreeList",
];

describe("firmware registration", () => {
  it("redacts API cache paths while preserving structured errors", () => {
    const root = "/private/tmp/firmware-worktree";
    const failure = Object.assign(
      new Error(`EEXIST: mkdir '${root}/.fs-firmware/pv-api'`),
      { status: 403, code: "VIEW_ANY_PROJECT_FILE_REQUIRED" },
    );

    const redacted = redactFirmwareApiError(failure, root, "Firmware API operation failed.");

    expect(redacted).toBe(failure);
    expect(redacted.message).not.toContain(root);
    expect(redacted.message).toContain("<host-path>/.fs-firmware/pv-api");
    expect(redacted).toMatchObject({ status: 403, code: "VIEW_ANY_PROJECT_FILE_REQUIRED" });
  });

  it.each(["remote-first", "firmware-first"] as const)(
    "configures standalone unpack when lanes register %s",
    async (order) => {
      const host = createFakePluginHost({
        pluginId: "finite-state",
        settings: {
          standaloneUnpackExecutablePath: "/opt/finite-state/unpack",
          standaloneUnpackImage: "finite-state/fact:test",
        },
      });
      const ctx = createPluginContext(host.bb);
      if (order === "remote-first") {
        await registerRemoteServices(host.bb, ctx);
        registerFirmware(host.bb, ctx);
      } else {
        registerFirmware(host.bb, ctx);
        await registerRemoteServices(host.bb, ctx);
      }
      await expect(host.harness.callRpc("firmwareMaterializeStart", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        source: "standalone_unpack",
        inputId: "missing-input",
        maxDepth: 12,
      })).rejects.toThrow(/input id is unknown/iu);
      await host.harness.lifecycle.dispose();
    },
  );

  it("registers frozen RPC and background seams reload-safely", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    registerFirmware(host.bb, createPluginContext(host.bb));
    expect([...host.harness.registrations.rpcMethods].sort()).toEqual(firmwareMethods);
    expect(host.harness.registrations.services.map((service) => service.name)).toEqual([
      "firmware-materialization",
    ]);

    const replacement = await host.harness.lifecycle.reload((bb) => {
      registerFirmware(bb, createPluginContext(bb));
    });
    expect([...replacement.harness.registrations.rpcMethods].sort()).toEqual(firmwareMethods);
    await replacement.harness.lifecycle.dispose();
  });

  it("runs firmware status, diff, and local pull through the sole finite-state CLI registration", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-register-cli-test-"));
    roots.push(root);
    execFileSync("git", ["init", "--quiet", root]);
    await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
    await writeFile(join(root, "firmware.bin"), "cli-bytes", "utf8");
    const wrapperPath = join(root, "fake-wrapper.mjs");
    await writeFile(wrapperPath, fakeWrapperSource, "utf8");
    const host = createFakePluginHost({ pluginId: "finite-state" });
    host.harness.sdk.stub("threads.get", async () => makeThreadResponse({
      id: "thread-firmware-cli",
      projectId: "project-1",
      environmentId: "environment-firmware-cli",
    }));
    host.harness.sdk.stub("environments.get", async () => ({
      id: "environment-firmware-cli",
      projectId: "project-1",
      path: root,
    }));
    const ctx = createPluginContext(host.bb);
    await registerRemoteServices(host.bb, ctx);
    registerSync(host.bb, ctx);
    registerFirmware(host.bb, ctx);
    configureStandaloneUnpackRuntime(ctx, {
      wrapper: {
        executablePath: process.execPath,
        argvPrefix: [wrapperPath],
        factImage: "fake/fact:test",
        timeoutMs: 5_000,
      },
    });
    host.harness.runService("firmware-materialization");

    const result = await host.harness.runCli(
      ["firmware", "status", "pv-1", "--json"],
      { threadId: "thread-firmware-cli", projectId: "project-1" },
    );

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      pvId: "pv-1",
      state: "not_materialized",
      files: 0,
    });
    const diff = await host.harness.runCli(
      ["firmware", "diff", "pv-1", "pv-2", "--json"],
      { threadId: "thread-firmware-cli", projectId: "project-1" },
    );
    expect(JSON.parse(diff.stdout)).toMatchObject({
      fromPvId: "pv-1",
      toPvId: "pv-2",
      items: [],
      total: 0,
    });
    const pull = await host.harness.runCli(
      ["firmware", "pull", "pv-1", "--image", "firmware.bin", "--max-depth", "4"],
      { threadId: "thread-firmware-cli", projectId: "project-1" },
    );
    expect(pull).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(pull.stdout)).toMatchObject({
      projectVersionId: "pv-1",
      state: "QUEUED",
    });
    await vi.waitFor(async () => {
      expect(await readFile(
        join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "firmware.txt"),
        "utf8",
      )).toBe("registered:cli-bytes");
    });
    await vi.waitFor(() => {
      expect(ctx.db().prepare(`SELECT status FROM pull_generation
        WHERE project_id=? AND project_version_id=? ORDER BY started_at DESC LIMIT 1`).get(
        "project-1",
        "pv-1",
      )).toEqual({ status: "accepted" });
    });
    await host.harness.lifecycle.dispose();
  });

  it("does not accept CLI cwd as an execution identity", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const handlers = createFirmwareCommandHandlers(createPluginContext(host.bb));
    await expect(
      handlers.resolveScope(
        { cwd: "/tmp/untrusted" },
        { projectId: "project-1", projectVersionId: "pv-1", generationId: "gen-1" },
      ),
    ).rejects.toThrow(/invoke from a bb thread/iu);
    await host.harness.lifecycle.dispose();
  });

  it("runs the frozen inputId action end to end through the verified registry and queued service", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-register-unpack-test-"));
    roots.push(root);
    execFileSync("git", ["init", "--quiet", root]);
    await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
    const worktreeRoot = await realpath(root);
    const firmwarePath = join(worktreeRoot, "firmware.bin");
    const wrapperPath = join(worktreeRoot, "fake-wrapper.mjs");
    await writeFile(firmwarePath, "bytes", "utf8");
    await writeFile(wrapperPath, fakeWrapperSource, "utf8");
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(host.bb);
    configureStandaloneUnpackRuntime(ctx, {
      wrapper: {
        executablePath: process.execPath,
        argvPrefix: [wrapperPath],
        factImage: "fake/fact:test",
        timeoutMs: 5_000,
      },
      now: () => new Date("2026-08-12T00:00:00.000Z"),
      createJobId: () => "job-1",
      createGenerationId: () => "stage-1",
    });
    const registry = getStandaloneUnpackInputRegistry(ctx);
    const inputId = registry.issue({
      firmwarePath,
      worktreeRoot,
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const wrongScopeId = registry.issue({
      firmwarePath,
      worktreeRoot,
      projectId: "project-2",
      projectVersionId: "pv-2",
      environmentId: "environment-2",
      expiresAt: new Date(Date.now() + 60_000),
    });
    registerFirmware(host.bb, ctx);
    const service = host.harness.runService("firmware-materialization");

    await expect(
      host.harness.callRpc("firmwareMaterializeStart", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        source: "standalone_unpack",
        inputId: "unknown-input",
        maxDepth: 4,
      }),
    ).rejects.toThrow(/unknown/iu);
    await expect(
      host.harness.callRpc("firmwareMaterializeStart", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        source: "standalone_unpack",
        inputId: wrongScopeId,
        maxDepth: 4,
      }),
    ).rejects.toThrow(/does not belong/iu);

    await expect(
      host.harness.callRpc("firmwareMaterializeStart", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        source: "standalone_unpack",
        inputId,
        maxDepth: 4,
      }),
    ).resolves.toEqual({
      projectId: "project-1",
      projectVersionId: "pv-1",
      id: "job-1",
      state: "QUEUED",
      progress: null,
      message: "Queued standalone firmware unpack.",
    });
    await vi.waitFor(async () => {
      expect(
        await readFile(
          join(worktreeRoot, ".fs-firmware", "pv-1", "rootfs", "bin", "firmware.txt"),
          "utf8",
        ),
      ).toBe("registered:bytes");
    });
    await vi.waitFor(() => {
      expect(
        ctx
          .db()
          .prepare(
            "SELECT status FROM pull_generation WHERE project_id=? AND project_version_id=? AND generation_id=?",
          )
          .get("project-1", "pv-1", "job-1"),
      ).toEqual({ status: "accepted" });
    });
    await expect(
      host.harness.callRpc("firmwareMaterializeCancel", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        jobId: "job-1",
      }),
    ).resolves.toMatchObject({ state: "COMPLETED", progress: 1 });
    await expect(
      host.harness.callRpc("firmwareMaterializeStart", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        source: "standalone_unpack",
        inputId,
        maxDepth: 4,
      }),
    ).rejects.toThrow(/already used/iu);
    await expect(access(firmwarePath)).resolves.toBeUndefined();

    const hangingPath = join(worktreeRoot, "hanging.bin");
    await writeFile(hangingPath, "hang", "utf8");
    const hangingInputId = registry.issue({
      firmwarePath: hangingPath,
      worktreeRoot,
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    configureStandaloneUnpackRuntime(ctx, {
      wrapper: {
        executablePath: process.execPath,
        argvPrefix: [wrapperPath],
        factImage: "fake/fact:test",
        timeoutMs: 5_000,
      },
      now: () => new Date("2026-08-12T00:00:00.000Z"),
      createJobId: () => "job-2",
      createGenerationId: () => "stage-2",
    });
    await host.harness.callRpc("firmwareMaterializeStart", {
      projectId: "project-1",
      projectVersionId: "pv-1",
      source: "standalone_unpack",
      inputId: hangingInputId,
      maxDepth: 4,
    });
    await vi.waitFor(() => {
      expect(
        ctx
          .db()
          .prepare(
            "SELECT status FROM pull_generation WHERE project_id=? AND project_version_id=? AND generation_id=?",
          )
          .get("project-1", "pv-1", "job-2"),
      ).toEqual({ status: "staging" });
    });
    await expect(
      host.harness.callRpc("firmwareMaterializeCancel", {
        projectId: "project-1",
        projectVersionId: "pv-1",
        jobId: "job-2",
      }),
    ).resolves.toMatchObject({
      state: "FAILED",
      message: "Standalone firmware unpack was cancelled.",
    });
    await vi.waitFor(() => {
      expect(
        ctx
          .db()
          .prepare(
            "SELECT status FROM pull_generation WHERE project_id=? AND project_version_id=? AND generation_id=?",
          )
          .get("project-1", "pv-1", "job-2"),
      ).toEqual({ status: "cancelled" });
    });

    service.controller.abort();
    await service.done;
    await host.harness.lifecycle.dispose();
  });

  it("rejects expired registry records before they can be consumed", () => {
    let now = new Date("2026-08-12T00:00:00.000Z");
    const registry = new StandaloneUnpackInputRegistry({
      now: () => now,
      createId: () => "input-1",
    });
    const inputId = registry.issue({
      firmwarePath: join(
        dirname(fileURLToPath(import.meta.url)),
        "register.integration.test.ts",
      ),
      worktreeRoot: join(dirname(fileURLToPath(import.meta.url)), "../../../../.."),
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      expiresAt: new Date("2026-08-12T00:01:00.000Z"),
    });
    now = new Date("2026-08-12T00:02:00.000Z");
    expect(() =>
      registry.consume({
        inputId,
        projectId: "project-1",
        projectVersionId: "pv-1",
      }),
    ).toThrow(/expired/iu);
  });

  it("rejects registry expiries beyond the ten-minute capability ceiling", () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const registry = new StandaloneUnpackInputRegistry({ now: () => now });
    expect(() => registry.issue({
      firmwarePath: join(dirname(fileURLToPath(import.meta.url)), "register.integration.test.ts"),
      worktreeRoot: join(dirname(fileURLToPath(import.meta.url)), "../../../../.."),
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1_000 + 1),
    })).toThrow(/ten-minute limit/iu);
  });

  it("issues only canonical worktree-contained firmware inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-register-issuer-test-"));
    const outside = await mkdtemp(join(tmpdir(), "fs-register-issuer-outside-"));
    roots.push(root, outside);
    execFileSync("git", ["init", "--quiet", root]);
    await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
    await writeFile(join(root, "firmware.bin"), "inside", "utf8");
    await writeFile(join(outside, "outside.bin"), "outside", "utf8");
    await symlink(join(outside, "outside.bin"), join(root, "escape.bin"));
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        environments: {
          get: () => ({ projectId: "project-1", path: root }),
        },
      },
    });
    registerFirmware(host.bb, createPluginContext(host.bb));
    await expect(host.harness.callRpc("firmwareInputIssue", {
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      firmwarePath: "firmware.bin",
    })).resolves.toEqual(expect.objectContaining({
      projectId: "project-1",
      projectVersionId: "pv-1",
      fileName: "firmware.bin",
    }));
    await expect(host.harness.callRpc("firmwareInputIssue", {
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      firmwarePath: "escape.bin",
    })).rejects.toThrow(/outside the environment worktree/iu);
    await host.harness.lifecycle.dispose();
  });
});
