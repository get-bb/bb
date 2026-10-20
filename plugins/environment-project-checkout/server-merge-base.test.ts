import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { expect, it } from "vitest";
import { checkoutHostContract } from "./contract.js";
import { createCheckoutHostEntry } from "./host.js";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin from "./server.js";

const execFileAsync = promisify(execFile);

it("keeps inherited commits out of a new checkout branch's diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-checkout-merge-base-"));
  const repo = join(root, "repo");
  const dataDir = join(root, "plugin-data");
  async function git(...args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "bb",
        GIT_AUTHOR_EMAIL: "bb@example.com",
        GIT_COMMITTER_NAME: "bb",
        GIT_COMMITTER_EMAIL: "bb@example.com",
      },
    });
    return result.stdout;
  }
  const host = experimental_createHostEntryHarness(createCheckoutHostEntry(), {
    experimental_paths: { dataDir, tempDir: join(root, "tmp") },
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "environment-project-checkout",
    experimental_callHostRpc: (call) => {
      if (call.method !== "attach") throw new Error("Unexpected host method");
      return host.experimental_call(
        "attach",
        checkoutHostContract.attach.input.parse(call.input),
      );
    },
    sdk: { environments: { list: () => [] }, threads: { list: () => [] } },
  });
  try {
    await mkdir(repo);
    await mkdir(dataDir);
    await git("init", "--initial-branch=main");
    await git("commit", "--allow-empty", "-m", "initial");
    await git("switch", "-c", "topic-base");
    await writeFile(join(repo, "base-only.txt"), "inherited content\n");
    await git("add", "base-only.txt");
    await git("commit", "-m", "base change");
    await git("update-ref", "refs/remotes/origin/topic-base", "HEAD");
    await git("switch", "main");
    await plugin(bb);
    const provider = harness.registrations.environmentProviders.get(
      PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
    );
    if (!provider) throw new Error("Missing provider");
    const result = await provider.create({
      project: {
        id: "project-1",
        kind: "standard",
        name: "checkout regression",
        gitRemoteUrl: null,
        createdAt: 1,
        updatedAt: 1,
      },
      host: makeHostResponse({ id: "host-a" }),
      projectCheckout: { path: repo, experimental_ownsPath: false },
      gitRemote: null,
      inputs: { branch: { kind: "new", baseBranch: "origin/topic-base" } },
      thread: makeThreadResponse(),
      suggestedBranchName: "bb/checkout-regression",
      attempt: 1,
      pathKey: "merge-base-regression",
      experimental_claimPath: async () => true,
      report: { step() {}, log() {} },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("Checkout failed");
    expect((await git("branch", "--show-current")).trim()).toBe(
      "bb/checkout-regression",
    );
    expect(await git("diff", "--name-only", "main...HEAD")).toBe(
      "base-only.txt\n",
    );
    expect(
      await git(
        "diff",
        "--name-only",
        `${result.mergeBaseBranch ?? "main"}...HEAD`,
      ),
    ).toBe("");
    expect(result.mergeBaseBranch).toBe("origin/topic-base");
  } finally {
    await harness.lifecycle.dispose();
    await host.experimental_dispose();
    await rm(root, { recursive: true, force: true });
  }
});
