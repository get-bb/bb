import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { createFirmwareCacheService } from "../register.js";
import {
  runStandaloneUnpack,
  standaloneUnpackArgv,
  type UnpackDeps,
} from "./driver.js";

const roots: string[] = [];

const fakeWrapperSource = String.raw`
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const argv = process.argv.slice(2);
const input = argv[0];
const output = argv[argv.indexOf("-d") + 1];
const snapshotPath = argv[argv.indexOf("-o") + 1];
const depth = argv[argv.indexOf("--max-depth") + 1];
const bytes = await readFile(input);
const mode = bytes.toString();
const counterPath = input + ".runs";
let count = 0;
try { count = Number(await readFile(counterPath, "utf8")); } catch {}
await writeFile(counterPath, String(count + 1));
if (process.env.FACT_UNPACK_IMAGE !== "fake/fact:test") process.exit(91);
if (mode === "fail") {
  process.stderr.write((input + " extractor failure ").repeat(3000));
  process.exit(7);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  const payload = Buffer.from("extracted:" + mode + ":depth=" + depth);
  const inputHash = createHash("sha256").update(bytes).digest("hex");
  const fileHash = createHash("sha256").update(payload).digest("hex");
  await mkdir(join(output, "nested"), { recursive: true });
  await writeFile(join(output, "nested", "payload.txt"), payload);
  await writeFile(snapshotPath, JSON.stringify({
    input_file: basename(input),
    input_sha256: inputHash,
    file_tree: [{
      file_path: "/nested/payload.txt",
      file_hash: fileHash,
      file_name: "payload.txt",
      mime_type: "text/plain",
      full_type: "ASCII text",
      file_size: payload.length,
    }],
    unpack_metadata: { [fileHash]: { tried: ["fake"], used: "fake" } },
    errors: [],
  }));
  process.stdout.write("PROGRESS 1 1\n");
}
`;

async function createTestContext(input = "firmware") {
  const root = await mkdtemp(join(tmpdir(), "fs-unpack-driver-test-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  const canonicalRoot = await realpath(root);
  const firmwarePath = join(canonicalRoot, "firmware.bin");
  const wrapperPath = join(canonicalRoot, "fake-wrapper.mjs");
  await writeFile(firmwarePath, input, "utf8");
  await writeFile(wrapperPath, fakeWrapperSource, "utf8");
  const host = createFakePluginHost({ pluginId: "finite-state" });
  const ctx = createPluginContext(host.bb);
  const scope = {
    worktreeRoot: canonicalRoot,
    projectId: "project-1",
    projectVersionId: "pv-1",
    generationId: "gen-1",
  };
  ctx
    .db()
    .prepare(
      `INSERT INTO pull_generation (
    project_id, project_version_id, generation_id, status, requested_kinds_json, started_at
  ) VALUES (?, ?, ?, 'accepted', '[]', ?)`,
    )
    .run(
      scope.projectId,
      scope.projectVersionId,
      scope.generationId,
      new Date(0).toISOString(),
    );
  const deps: UnpackDeps = {
    scope,
    cache: createFirmwareCacheService(ctx),
    wrapper: {
      executablePath: process.execPath,
      factImage: "fake/fact:test",
      argvPrefix: [wrapperPath],
      timeoutMs: 5_000,
    },
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    createGenerationId: () => "stage-1",
  };
  return { root: canonicalRoot, firmwarePath, wrapperPath, host, deps };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("standalone unpack driver", () => {
  it("uses the documented argv shape with no shell and ingests the fake wrapper snapshot", async () => {
    const fixture = await createTestContext();
    const calls = vi.fn<NonNullable<UnpackDeps["spawnProcess"]>>(
      (command, args, options) => spawn(command, args, options),
    );
    const progress: Array<{ phase: string; done: number; total: number }> = [];
    fixture.deps.spawnProcess = calls;
    fixture.deps.publishProgress = (item) => progress.push(item);

    const result = await runStandaloneUnpack(
      fixture.deps,
      { pvId: "pv-1", firmwarePath: fixture.firmwarePath, maxDepth: 4 },
      new AbortController().signal,
    );

    expect(calls).toHaveBeenCalledOnce();
    expect(calls.mock.calls[0]![0]).toBe(process.execPath);
    expect(calls.mock.calls[0]![1]).toEqual(
      standaloneUnpackArgv(
        fixture.deps.wrapper,
        fixture.firmwarePath,
        join(
          fixture.root,
          ".fs-firmware",
          "pv-1",
          "staging",
          "stage-1",
          "rootfs",
        ),
        join(
          fixture.root,
          ".fs-firmware",
          "pv-1",
          "staging",
          "stage-1",
          "snapshot.json",
        ),
        4,
      ),
    );
    expect(calls.mock.calls[0]![2]).toMatchObject({ shell: false });
    expect(result).toMatchObject({
      reused: false,
      mount: { readiness: "fully_materialized" },
    });
    expect(
      await readFile(
        join(result.mount.rootfsPath, "nested", "payload.txt"),
        "utf8",
      ),
    ).toBe("extracted:firmware:depth=4");
    expect(progress.map((item) => item.phase)).toEqual(
      expect.arrayContaining([
        "hashing",
        "unpacking",
        "validating",
        "ingesting",
        "complete",
      ]),
    );
    await fixture.host.harness.lifecycle.dispose();
  });

  it("reports a configured wrapper prerequisite without attempting a shell fallback", async () => {
    const fixture = await createTestContext();
    fixture.deps.wrapper.executablePath = join(fixture.root, "missing-wrapper");
    await expect(
      runStandaloneUnpack(
        fixture.deps,
        { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UNPACK_WRAPPER_UNAVAILABLE" });
    await fixture.host.harness.lifecycle.dispose();
  });

  it("bounds and redacts nonzero-exit diagnostics", async () => {
    const fixture = await createTestContext("fail");
    const error = await runStandaloneUnpack(
      fixture.deps,
      { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
      new AbortController().signal,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "UNPACK_WRAPPER_FAILED" });
    expect((error as Error).message.length).toBeLessThan(34_000);
    expect((error as Error).message).not.toContain(fixture.root);
    const diagnostic = await readFile(
      join(
        fixture.root,
        ".fs-firmware",
        "pv-1",
        "staging",
        "stage-1",
        "diagnostic.json",
      ),
      "utf8",
    );
    expect(diagnostic).not.toContain(fixture.root);
    await fixture.host.harness.lifecycle.dispose();
  });

  it("aborts a running wrapper without promoting a partial rootfs", async () => {
    const fixture = await createTestContext("hang");
    const controller = new AbortController();
    const running = runStandaloneUnpack(
      fixture.deps,
      { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    await expect(running).rejects.toMatchObject({ code: "UNPACK_CANCELLED" });
    await expect(
      readFile(join(fixture.root, ".fs-firmware", "pv-1", "rootfs", "nested")),
    ).rejects.toBeTruthy();
    await fixture.host.harness.lifecycle.dispose();
  });

  it("times out a stuck wrapper", async () => {
    const fixture = await createTestContext("hang");
    fixture.deps.wrapper.timeoutMs = 25;
    await expect(
      runStandaloneUnpack(
        fixture.deps,
        { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UNPACK_TIMEOUT" });
    await fixture.host.harness.lifecycle.dispose();
  });

  it("reuses an unchanged verified digest without launching the wrapper again", async () => {
    const fixture = await createTestContext();
    const first = await runStandaloneUnpack(
      fixture.deps,
      { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
      new AbortController().signal,
    );
    const second = await runStandaloneUnpack(
      fixture.deps,
      { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
      new AbortController().signal,
    );
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(await readFile(`${fixture.firmwarePath}.runs`, "utf8")).toBe("1");
    await fixture.host.harness.lifecycle.dispose();
  });

  it("marks a changed prior mount stale and retains its coherent bytes when replacement fails", async () => {
    const fixture = await createTestContext();
    await runStandaloneUnpack(
      fixture.deps,
      { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
      new AbortController().signal,
    );
    await writeFile(fixture.firmwarePath, "fail", "utf8");
    fixture.deps.createGenerationId = () => "stage-2";

    await expect(
      runStandaloneUnpack(
        fixture.deps,
        { pvId: "pv-1", firmwarePath: fixture.firmwarePath },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UNPACK_WRAPPER_FAILED" });
    expect(
      await readFile(
        join(
          fixture.root,
          ".fs-firmware",
          "pv-1",
          "rootfs",
          "nested",
          "payload.txt",
        ),
        "utf8",
      ),
    ).toBe("extracted:firmware:depth=12");
    const retained = fixture.deps.cache.open(fixture.deps.scope);
    expect(retained.readMeta()?.stale).toBe(true);
    retained.close();
    await fixture.host.harness.lifecycle.dispose();
  });
});
