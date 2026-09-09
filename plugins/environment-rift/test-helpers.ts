import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { onTestFinished } from "vitest";
import type { PluginEnvironmentProviderCreateContext } from "@get-bb/plugin-sdk/environment-provider";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHarness,
} from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createRiftHostEntry } from "./host.js";
import plugin from "./server.js";

export const exec = promisify(execFile);
export const hasRift = spawnSync("rift", ["--help"]).status === 0;
export const git = async (cwd: string, ...args: string[]) =>
  (await exec("git", args, { cwd })).stdout.trim();
export const commit = (cwd: string) =>
  git(
    cwd,
    "-c",
    "user.name=BB",
    "-c",
    "user.email=bb@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );

export async function createWorkspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bb-rift-")));
  const source = join(root, "repo");
  const dataDir = join(root, "data");
  onTestFinished(async () => {
    await exec("rift", ["remove", "-f", source]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(source);
  await mkdir(dataDir);
  await git(source, "init", "-b", "main");
  return { root, source, dataDir, tempDir: join(root, "temp") };
}

export function createHostHarness(
  paths: { dataDir: string; tempDir: string },
  entry = createRiftHostEntry(),
) {
  const host = experimental_createHostEntryHarness(entry, {
    experimental_paths: paths,
  });
  onTestFinished(() => host.experimental_dispose());
  return host;
}

export async function createProviderFixture(
  callHost: (
    call: FakePluginHarness["experimental_hostRpcCalls"][number],
  ) => unknown | Promise<unknown>,
  overrides: Partial<PluginEnvironmentProviderCreateContext> = {},
) {
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: callHost,
  });
  onTestFinished(() => harness.lifecycle.dispose());
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get("rift");
  if (provider === undefined) throw new Error("Provider not registered");
  const context: PluginEnvironmentProviderCreateContext = {
    thread: makeThreadResponse({ id: "thr_1", projectId: "project-1" }),
    project: {
      id: "project-1",
      kind: "standard",
      name: "bb",
      gitRemoteUrl: null,
      createdAt: 0,
      updatedAt: 0,
    },
    host: {
      id: "host-a",
      name: "Fake machine",
      type: "persistent",
      status: "connected",
      maxPermissionMode: "full",
      lastSeenAt: null,
      lastRejectedProtocolVersion: null,
      createdAt: 0,
      updatedAt: 0,
    },
    projectCheckout: { path: "/checkouts/bb" },
    gitRemote: null,
    inputs: { branch: { kind: "default" }, copy: "all" },
    suggestedBranchName: "bb/test",
    experimental_claimPath: async () => true,
    attempt: 1,
    pathKey: "thr_1",
    rebuild: false,
    previous: null,
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
    ...overrides,
  };
  return {
    context,
    harness,
    provider,
    report: context.report,
    signal: context.signal,
  };
}
