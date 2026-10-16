import { expect, it } from "vitest";
import { runVcsProcess } from "@bb/process-utils";
import { runGitWithNullRecordLimit } from "../src/git.js";
import { runGit as runProvisioningGit } from "bb-environment-provider-host/git";

it.each([
  [
    "streaming git",
    (signal: AbortSignal) =>
      runGitWithNullRecordLimit(
        ["--version"],
        { cwd: process.cwd(), signal },
        "single",
        1,
      ),
  ],
  [
    "provisioning git",
    (signal: AbortSignal) =>
      runProvisioningGit(["--version"], { cwd: process.cwd(), signal }),
  ],
] as const)(
  "%s shares admission and preserves cancellation while queued",
  async (_, run) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holders = Array.from({ length: 6 }, () =>
      runVcsProcess("git", ["status"], () => gate, { priority: "interactive" }),
    );
    const controller = new AbortController();
    try {
      const result = run(controller.signal);
      const rejected = expect(result).rejects.toMatchObject({
        code: "provision_cancelled",
      });
      await Promise.resolve();
      controller.abort();
      await rejected;
    } finally {
      release();
      await Promise.all(holders);
    }
  },
);
