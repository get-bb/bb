import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../src/app-update/run-command.js";
import {
  fastForwardSource,
  inspectSourceCheckout,
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
let template: GitCheckoutFixture;

beforeAll(async () => {
  template = await createGitCheckout();
});

afterAll(() => {
  template?.cleanup();
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

async function createCheckout(): Promise<
  GitCheckoutFixture & { running: string }
> {
  const fixture = await createGitCheckout(template);
  fixtures.push(fixture);
  return {
    ...fixture,
    running: await git(fixture.checkout, "rev-parse", "HEAD"),
  };
}

describe("source checkout inspection", { timeout: 30_000 }, () => {
  it("reports nothing to update when main matches origin/main", async () => {
    const { checkout, running } = await createCheckout();

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });

    expect(check.blocked).toBeNull();
    expect(check.incoming).toBeNull();
    expect(check.current.version).toBe("1.0.0");
  });

  it("offers the fetched origin/main commit with its subjects and version", async () => {
    const { checkout, running, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    const tip = await publish(upstream, "1.2.0", "Fix bug");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });

    expect(check.blocked).toBeNull();
    expect(check.incoming).toEqual({
      commit: tip,
      commitCount: 2,
      subjects: ["Fix bug", "Add feature"],
      version: "1.2.0",
    });
  });

  it("counts incoming commits from the running commit after the checkout was pulled", async () => {
    const { checkout, running, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "pull", "-q", "--ff-only", "origin", "main");
    const tip = await publish(upstream, "1.2.0", "Fix bug");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });

    expect(check.blocked).toBeNull();
    expect(check.incoming).toEqual({
      commit: tip,
      commitCount: 2,
      subjects: ["Fix bug", "Add feature"],
      version: "1.2.0",
    });
  });

  it("offers origin/main when the checkout was pulled to it but bb still runs an older commit", async () => {
    const { checkout, running, upstream } = await createCheckout();
    const tip = await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "pull", "-q", "--ff-only", "origin", "main");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });

    expect(check.blocked).toBeNull();
    expect(check.incoming?.commit).toBe(tip);
    expect(check.incoming?.commitCount).toBe(1);
  });

  it("blocks updates over uncommitted tracked changes but not untracked files", async () => {
    const { checkout, running, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    writeRepoFile(checkout, "scratch.txt", "untracked");

    const untracked = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });
    expect(untracked.blocked).toBeNull();

    writeRepoFile(checkout, "packages/bb-app/package.json", "{}\n");
    const dirty = await inspectSourceCheckout({
      fetch: false,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });
    expect(dirty.blocked?.reason).toBe("uncommitted-changes");
    expect(dirty.incoming?.commitCount).toBe(1);
  });

  it("blocks updates on a branch other than main", async () => {
    const { checkout, running, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "checkout", "-q", "-b", "feature");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });

    expect(check.blocked?.reason).toBe("not-on-main");
  });

  it("blocks updates when local main has commits origin/main lacks", async () => {
    const { checkout, running, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    await commitVersion(checkout, "1.0.1", "Local work");

    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: checkout,
      runner: runCommand,
      running,
    });

    expect(check.blocked?.reason).toBe("diverged");
    expect(check.incoming?.commitCount).toBe(1);
  });

  it("reports a failed fetch instead of throwing", async () => {
    const { checkout, running } = await createCheckout();
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
      running,
    });

    expect(check.blocked?.reason).toBe("fetch-failed");
    expect(check.incoming).toBeNull();
  });
});

describe("source checkout switching", { timeout: 30_000 }, () => {
  it("fast-forwards to the offered commit", async () => {
    const { checkout, upstream } = await createCheckout();
    const to = await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "fetch", "-q", "origin", "main");

    await fastForwardSource({ repoRoot: checkout, runner: runCommand, to });
    expect(await git(checkout, "rev-parse", "HEAD")).toBe(to);
    expect(await git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("fast-forwards a checkout that was pulled partway to the offered commit", async () => {
    const { checkout, upstream } = await createCheckout();
    await publish(upstream, "1.1.0", "Add feature");
    await git(checkout, "pull", "-q", "--ff-only", "origin", "main");
    const to = await publish(upstream, "1.2.0", "Fix bug");
    await git(checkout, "fetch", "-q", "origin", "main");

    await fastForwardSource({ repoRoot: checkout, runner: runCommand, to });
    expect(await git(checkout, "rev-parse", "HEAD")).toBe(to);
  });

  it("refuses to fast-forward a checkout with commits the offered commit lacks", async () => {
    const { checkout, upstream } = await createCheckout();
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
      fastForwardSource({ repoRoot: checkout, runner: runCommand, to }),
    ).rejects.toThrow("does not contain");
  });
});
