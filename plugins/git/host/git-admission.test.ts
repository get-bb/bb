import { expect, it } from "vitest";
import {
  experimental_runVcsProcess as runVcsProcess,
} from "@get-bb/plugin-sdk/host";
import { runGitWithNullRecordLimit } from "./git.js";

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
