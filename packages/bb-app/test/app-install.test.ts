import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isOfficialSourceRemote,
  resolveAppInstall,
} from "../src/app-install.js";
import { runCommand } from "../src/app-update/run-command.js";
import {
  createGitCheckout,
  git,
  type GitCheckoutFixture,
} from "./app-update-git-fixture.js";

const fixtures: GitCheckoutFixture[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

async function checkoutWithOrigin(url: string): Promise<string> {
  const fixture = await createGitCheckout();
  fixtures.push(fixture);
  await git(fixture.checkout, "remote", "set-url", "origin", url);
  return fixture.checkout;
}

describe("app install resolution", { timeout: 30_000 }, () => {
  it("recognizes get-bb/bb over https and ssh, and nothing else", () => {
    expect(isOfficialSourceRemote("https://github.com/get-bb/bb.git")).toBe(
      true,
    );
    expect(isOfficialSourceRemote("https://github.com/get-bb/bb")).toBe(true);
    expect(isOfficialSourceRemote("git@github.com:get-bb/bb.git")).toBe(true);
    expect(isOfficialSourceRemote("ssh://git@github.com/get-bb/bb.git")).toBe(
      true,
    );
    expect(
      isOfficialSourceRemote("https://x-access-token@github.com/get-bb/bb.git"),
    ).toBe(true);
    expect(isOfficialSourceRemote("git@github.com:someone/bb.git")).toBe(false);
    expect(isOfficialSourceRemote("https://github.com/get-bb/bb-fork")).toBe(
      false,
    );
    expect(isOfficialSourceRemote("https://gitlab.com/get-bb/bb.git")).toBe(
      false,
    );
  });

  it("reports the HEAD commit only for official checkouts", async () => {
    const official = await checkoutWithOrigin("git@github.com:get-bb/bb.git");
    const fork = await checkoutWithOrigin("git@github.com:someone/bb.git");

    expect(
      await resolveAppInstall({
        desktop: false,
        runner: runCommand,
        sourceRoot: official,
      }),
    ).toEqual({
      commit: await git(official, "rev-parse", "HEAD"),
      kind: "source",
      origin: "official",
    });
    expect(
      await resolveAppInstall({
        desktop: false,
        runner: runCommand,
        sourceRoot: fork,
      }),
    ).toEqual({ kind: "source", origin: "fork" });
  });

  it("reports no origin for a checkout without a remote or git metadata", async () => {
    const noRemote = await checkoutWithOrigin("unused");
    await git(noRemote, "remote", "remove", "origin");
    const notGit = mkdtempSync(join(tmpdir(), "bb-app-install-"));
    tempDirs.push(notGit);

    for (const sourceRoot of [noRemote, notGit]) {
      expect(
        await resolveAppInstall({
          desktop: false,
          runner: runCommand,
          sourceRoot,
        }),
      ).toEqual({ kind: "source", origin: "none" });
    }
  });
});
