import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../../lib/store/index.js";
import type {
  AuthoringContext,
  BuildPlan,
  DestructiveConfirmation,
  FlashPlan,
} from "./runner.js";

export interface AuthoringFixture {
  host: ReturnType<typeof createFakePluginHost>;
  ctx: AuthoringContext;
  root: string;
  bin: string;
  dataDir: string;
  controller: AbortController;
  spawned: { build: number; flash: number };
  cleanup(): Promise<void>;
}

export async function createFixture(input: {
  buildScript?: string;
  flashScript?: string;
  buildTimeoutMs?: number;
  primaryArtifact?: string;
  confirmationValid?: boolean;
} = {}): Promise<AuthoringFixture> {
  const root = await mkdtemp(join(tmpdir(), "fs-authoring-root-"));
  const dataDir = await mkdtemp(join(tmpdir(), "fs-authoring-data-"));
  const bin = join(root, "fixture-bin");
  await mkdir(bin);
  const spawned = { build: 0, flash: 0 };
  const buildPath = join(bin, "fixture-build");
  const flashPath = join(bin, "fixture-flash");
  await writeFile(
    buildPath,
    `#!/bin/sh\n${input.buildScript ?? "/bin/mkdir -p build; printf firmware > build/app.bin; echo build-ok"}\n`,
    "utf8",
  );
  await writeFile(
    flashPath,
    `#!/bin/sh\n${input.flashScript ?? "echo flash-ok"}\n`,
    "utf8",
  );
  await chmod(buildPath, 0o700);
  await chmod(flashPath, 0o700);
  const host = createFakePluginHost({ pluginId: `fs-authoring-${crypto.randomUUID()}` });
  const db = openStore(host.bb).db;
  const controller = new AbortController();
  const buildPlan: BuildPlan = {
    command: ["fixture-build"],
    toolchain: "fixture-build",
    primaryArtifact: input.primaryArtifact ?? "build/app.bin",
    timeoutMs: input.buildTimeoutMs ?? 10_000,
    env: {},
  };
  const flashPlan: FlashPlan = {
    command: ["fixture-flash"],
    toolchain: "fixture-flash",
    timeoutMs: 10_000,
    env: {},
  };
  const ctx: AuthoringContext = {
    db,
    projectId: "project-a",
    projectVersionId: "version-a",
    execution: { worktreeRoot: root, verified: true },
    dataDir,
    signal: controller.signal,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    publish: () => undefined,
    path: bin,
    probes: [],
    probeTimeoutMs: 500,
    async resolveBuildPlan() {
      spawned.build += 1;
      return buildPlan;
    },
    async resolveDevice(device) {
      return device ?? "fixture-device";
    },
    async resolveFlashPlan() {
      spawned.flash += 1;
      return flashPlan;
    },
    validateDestructiveConfirmation(value) {
      return input.confirmationValid === true && value !== null && typeof value === "object";
    },
  };
  return {
    host,
    ctx,
    root,
    bin,
    dataDir,
    controller,
    spawned,
    async cleanup() {
      await host.harness.lifecycle.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function confirmationFixture(): DestructiveConfirmation {
  return Object.freeze({}) as DestructiveConfirmation;
}
