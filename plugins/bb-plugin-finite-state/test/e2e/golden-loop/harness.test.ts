import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { registerActionTools } from "../../../lanes/agentic/tools/actions.js";
import { assertion } from "./assertions.js";
import { createGoldenLoopHarness, type GoldenLoopHarness } from "./harness.js";
import { semanticReport } from "./reporter.js";
import {
  GOLDEN_LOOP_BEATS,
  type BeatNumber,
  type GoldenLoopBeat,
} from "./scenario.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd: root,
    encoding: "utf8",
  });
  return result.stdout;
}

async function temporaryRepository(): Promise<
  Readonly<{
    root: string;
    cleanup(): Promise<void>;
  }>
> {
  const root = await mkdtemp(join(tmpdir(), "golden-loop-seed-"));
  await git(root, ["init", "--initial-branch=main"]);
  await writeFile(join(root, "seed.txt"), "golden-loop-seed\n", "utf8");
  await git(root, ["add", "seed.txt"]);
  await git(root, [
    "-c",
    "user.name=Golden Loop Seed",
    "-c",
    "user.email=seed@finite-state.test",
    "commit",
    "-m",
    "seed",
  ]);
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function scenario(
  overrides: Readonly<
    Partial<
      Record<
        BeatNumber,
        Partial<Omit<GoldenLoopBeat, "number" | "name" | "maxMs">>
      >
    >
  > = {},
): GoldenLoopBeat[] {
  return GOLDEN_LOOP_BEATS.map((metadata) => ({
    ...metadata,
    action: async () => {},
    assert: async () => [assertion("durable public state", true)],
    ...overrides[metadata.number],
  }));
}

async function removePreserved(harness: GoldenLoopHarness): Promise<void> {
  await harness.dispose();
  await rm(harness.runDirectory, { recursive: true, force: true });
}

describe.sequential("Golden Loop harness", () => {
  it("creates and disposes an isolated worktree without modifying the caller checkout", async () => {
    const repository = await temporaryRepository();
    const before = await git(repository.root, ["status", "--porcelain=v1"]);
    const harness = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      scenario: scenario({
        1: {
          action: async ({ worktree }) => {
            await writeFile(
              join(worktree, "journey.txt"),
              "isolated\n",
              "utf8",
            );
          },
        },
      }),
    });
    try {
      expect(harness.worktree).not.toBe(repository.root);
      expect((await harness.runBeat(1)).status).toBe("passed");
      expect(
        await readFile(join(harness.worktree, "journey.txt"), "utf8"),
      ).toBe("isolated\n");
      expect(await git(repository.root, ["status", "--porcelain=v1"])).toBe(
        before,
      );
      const worktree = harness.worktree;
      await harness.dispose();
      await expect(access(worktree)).rejects.toThrow();
      expect(await git(repository.root, ["status", "--porcelain=v1"])).toBe(
        before,
      );
    } finally {
      await harness.dispose();
      await repository.cleanup();
    }
  });

  it("reports an external request in offline mode with its beat and caller", async () => {
    const repository = await temporaryRepository();
    const harness = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      scenario: scenario({
        3: {
          action: async () => {
            await fetch("https://example.invalid/fs-79");
          },
        },
      }),
    });
    try {
      const result = await harness.runBeat(3);
      expect(result).toMatchObject({ beat: 3, status: "failed" });
      expect(result.assertions.at(-1)?.detail).toMatch(
        /OFFLINE_NETWORK_VIOLATION beat=3.*example\.invalid.*harness\.test/isu,
      );
      expect(() => harness.assertNoExternalNetwork()).toThrow(
        /beat=3.*example\.invalid/isu,
      );
      await expect(access(harness.runDirectory)).resolves.toBeUndefined();
    } finally {
      const registered = await git(repository.root, [
        "worktree",
        "list",
        "--porcelain",
      ]);
      await removePreserved(harness);
      expect(registered).toContain(harness.worktree);
      expect(
        await git(repository.root, ["worktree", "list", "--porcelain"]),
      ).not.toContain(harness.worktree);
      await repository.cleanup();
    }
  });

  it("guards configure-time egress and removes its partial worktree", async () => {
    const repository = await temporaryRepository();
    const before = await git(repository.root, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    try {
      await expect(
        createGoldenLoopHarness({
          repositoryRoot: repository.root,
          scenario: scenario(),
          configure: async () => {
            await fetch("https://example.invalid/configure-egress");
          },
        }),
      ).rejects.toThrow(
        /OFFLINE_NETWORK_VIOLATION beat=setup.*example\.invalid.*harness\.test/isu,
      );
      expect(
        await git(repository.root, ["worktree", "list", "--porcelain"]),
      ).toBe(before);
    } finally {
      await repository.cleanup();
    }
  });

  it("preserves sanitized evidence for a failed beat", async () => {
    const repository = await temporaryRepository();
    const harness = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      scenario: scenario({
        2: {
          action: async ({ artifacts }) => {
            await artifacts.writeJson("rpc-transcript.json", {
              authorization: "Bearer top-secret",
              nested: { apiKey: "also-secret", message: "safe" },
            });
            throw new Error("induced triage failure");
          },
        },
      }),
    });
    try {
      expect((await harness.runBeat(2)).status).toBe("failed");
      const transcript = await readFile(
        join(
          harness.runDirectory,
          "artifacts",
          "beat-02",
          "rpc-transcript.json",
        ),
        "utf8",
      );
      expect(transcript).toContain("[REDACTED]");
      expect(transcript).toContain("safe");
      expect(transcript).not.toContain("top-secret");
      expect(transcript).not.toContain("also-secret");
      await expect(
        access(join(harness.runDirectory, "artifacts", "PRESERVED.json")),
      ).resolves.toBeUndefined();
    } finally {
      await removePreserved(harness);
      await repository.cleanup();
    }
  });

  it("fails when an expected failure does not match its refusal signature", async () => {
    const repository = await temporaryRepository();
    const harness = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      scenario: scenario({
        7: {
          expectedFailure: {
            task: "FS-201",
            reason: "requirement puller is pending",
            signature: "No puller is registered for requirement",
          },
          action: async () => {
            throw new Error("version selection failed before requirement pull");
          },
        },
      }),
    });
    try {
      const result = await harness.runBeat(7);
      expect(result.status).toBe("failed");
      expect(result.assertions.at(-1)?.detail).toContain(
        "expected refusal containing",
      );
      await expect(
        access(
          join(
            harness.runDirectory,
            "artifacts",
            "beat-07",
            "expected-failure-mismatch.json",
          ),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await removePreserved(harness);
      await repository.cleanup();
    }
  });

  it("does not expose human push or conflict resolution through the agent registry", async () => {
    const repository = await temporaryRepository();
    let host: ReturnType<typeof createFakePluginHost> | undefined;
    let refusal = "";
    const harness = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      configure: ({ host: configured }) => {
        host = configured;
        registerActionTools(configured.bb, createPluginContext(configured.bb));
      },
      scenario: scenario({
        14: {
          action: async () => {
            for (const name of [
              "human.push",
              "human.resolveConflict",
            ] as const) {
              try {
                await host!.harness.behavior.callAgentTool(name, {});
              } catch (error) {
                refusal +=
                  error instanceof Error ? error.message : String(error);
              }
            }
          },
          assert: async () => [
            assertion(
              "human services absent from agent tools",
              refusal.length > 0 &&
                !host!.harness.inspection.registrations.agentTools.some(
                  ({ name }) => name.startsWith("human."),
                ),
              refusal,
            ),
          ],
        },
      }),
    });
    try {
      expect((await harness.runBeat(14)).status).toBe("passed");
      expect(
        host!.harness.inspection.registrations.agentTools.map(
          ({ name }) => name,
        ),
      ).not.toContain("human.push");
    } finally {
      await harness.dispose();
      await repository.cleanup();
    }
  });

  it("produces the same semantic report from the same seed and clock", async () => {
    const repository = await temporaryRepository();
    const first = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      scenario: scenario(),
    });
    const second = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      scenario: scenario(),
    });
    try {
      await first.runAll();
      await second.runAll();
      first.assertNoExternalNetwork();
      second.assertNoExternalNetwork();
      expect(semanticReport(first.report!)).toEqual(
        semanticReport(second.report!),
      );
      expect(first.report?.results).toHaveLength(14);
      expect(first.report?.ohMoments).toEqual(
        expect.objectContaining({
          "5": expect.any(Array),
          "7": expect.any(Array),
          "11": expect.any(Array),
          "12": expect.any(Array),
        }),
      );
    } finally {
      await first.dispose();
      await second.dispose();
      await repository.cleanup();
    }
  });

  it("reports connected mode as unavailable without falling back to fixtures", async () => {
    const repository = await temporaryRepository();
    const harness = await createGoldenLoopHarness({
      repositoryRoot: repository.root,
      mode: "connected",
      scenario: scenario(),
    });
    try {
      const results = await harness.runAll();
      expect(results.every(({ status }) => status === "skipped")).toBe(true);
      expect(results[0]?.assertions[0]?.detail).toMatch(
        /CONNECTED_MODE_UNAVAILABLE.*tenant.*bench.*reset/isu,
      );
      expect(harness.report?.status).toBe("failed");
    } finally {
      await harness.dispose();
      await repository.cleanup();
    }
  });
});
