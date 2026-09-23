import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/app-update/run-command.js";
import {
  fastForwardSource,
  inspectSourceCheckout,
  revertSource,
} from "../src/app-update/source-checkout.js";
import {
  commitVersion,
  createGitCheckout,
  git,
  publish,
  writeRepoFile,
  type GitCheckoutFixture,
} from "./app-update-git-fixture.js";

const fixtures: GitCheckoutFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

async function createCheckout(): Promise<GitCheckoutFixture> {
  const fixture = await createGitCheckout();
  fixtures.push(fixture);
  return fixture;
}

describe("source checkout inspection", () => {
  it("reports nothing to update when main matches origin/main", async () => {
    const { checkout } = await createCheckout();

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
    });

    expect(check.blocked).toBeNull();
    expect(check.incoming).toBeNull();
    expect(check.current.version).toBe("1.0.0");
  });

  it("offers the fetched origin/main commit with its subjects and version", async () => {
    const { checkout, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    const tip = await publish(upstream, "1.2.0", "Fix bug");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
    });

    expect(check.blocked).toBeNull();
    expect(check.incoming).toEqual({
      commit: tip,
      commitCount: 2,
      subjects: ["Fix bug", "Add feature"],
      version: "1.2.0",
    });
  });

  it("blocks updates over uncommitted tracked changes but not untracked files", async () => {
    const { checkout, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    writeRepoFile(checkout, "scratch.txt", "untracked");

    const untracked = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
    });
    expect(untracked.blocked).toBeNull();

    writeRepoFile(checkout, "packages/bb-app/package.json", "{}\n");
    const dirty = await inspectSourceCheckout({
      fetch: false,
      repoRoot: checkout,
      runner: runCommand,
    });
    expect(dirty.blocked?.reason).toBe("uncommitted-changes");
    expect(dirty.incoming?.commitCount).toBe(1);
  });

  it("blocks updates on a branch other than main", async () => {
    const { checkout, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "checkout", "-q", "-b", "feature");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
    });

    expect(check.blocked?.reason).toBe("not-on-main");
  });

  it("blocks updates when local main has commits origin/main lacks", async () => {
    const { checkout, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    await commitVersion(checkout, "1.0.1", "Local work");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
    });

    expect(check.blocked?.reason).toBe("diverged");
    expect(check.incoming?.commitCount).toBe(1);
  });

  it("reports a failed fetch instead of throwing", async () => {
    const { checkout } = await createCheckout();
    await git(
      checkout,
      "remote",
      "set-url",
      "origin",
      join(checkout, "missing.git"),
    );

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
    });

    expect(check.blocked?.reason).toBe("fetch-failed");
    expect(check.incoming).toBeNull();
  });
});

describe("source checkout switching", () => {
  it("fast-forwards to the offered commit and resets back on rollback", async () => {
    const { checkout, upstream } = await createCheckout();
    const from = await git(checkout, "rev-parse", "HEAD");
    const to = await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "fetch", "-q", "origin", "main");

    await fastForwardSource({
      from,
      repoRoot: checkout,
      runner: runCommand,
      to,
    });
    expect(await git(checkout, "rev-parse", "HEAD")).toBe(to);

    await revertSource({ repoRoot: checkout, runner: runCommand, to: from });
    expect(await git(checkout, "rev-parse", "HEAD")).toBe(from);
    expect(await git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("refuses to fast-forward a checkout that moved after the request", async () => {
    const { checkout, upstream } = await createCheckout();
    const from = await git(checkout, "rev-parse", "HEAD");
    const to = await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "fetch", "-q", "origin", "main");
    await git(
      checkout,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Moved",
      "--no-verify",
    );

    await expect(
      fastForwardSource({ from, repoRoot: checkout, runner: runCommand, to }),
    ).rejects.toThrow("moved");
  });
});
