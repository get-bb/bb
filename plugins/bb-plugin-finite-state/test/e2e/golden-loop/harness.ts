import { execFile } from "node:child_process";
import dns from "node:dns";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import type { BbPluginApi } from "@bb/plugin-sdk";
import {
  createFakePluginHost,
  type CreateFakePluginHostOptions,
} from "@bb/plugin-sdk/testing";

import { requirePassed } from "./assertions.js";
import {
  createArtifactWriter,
  failedAssertion,
  type GoldenLoopMachineReport,
  type OfflineViolationReport,
  writeGoldenLoopReports,
} from "./reporter.js";
import {
  GOLDEN_LOOP_BEATS,
  validateGoldenLoopScenario,
  type BeatNumber,
  type BeatResult,
  type DeterministicClock,
  type GoldenLoopBeat,
  type GoldenLoopBeatContext,
  type GoldenLoopMode,
} from "./scenario.js";

const execFileAsync = promisify(execFile);
const BASE_TIME = Date.parse("2026-08-14T12:00:00.000Z");

type FakePluginHost = ReturnType<typeof createFakePluginHost>;

export interface ConnectedGoldenLoopConfig {
  readonly optIn: true;
  readonly tenant: string;
  readonly bench: string;
  readonly reset: () => Promise<void>;
}

export interface GoldenLoopHarnessOptions {
  readonly mode?: GoldenLoopMode;
  readonly repositoryRoot?: string;
  readonly seed?: string;
  readonly scenario: readonly GoldenLoopBeat[];
  readonly evidenceDirectory?: string;
  readonly allowedLoopbackPorts?: readonly number[];
  readonly allowedSocketPaths?: readonly string[];
  readonly connected?: ConnectedGoldenLoopConfig;
  readonly host?: Omit<CreateFakePluginHostOptions, "pluginId">;
  readonly configure?: (
    input: Readonly<{
      bb: BbPluginApi;
      host: FakePluginHost;
      worktree: string;
    }>,
  ) => Promise<void> | void;
  readonly human?: Partial<{
    reviewDiff(input: unknown): Promise<void>;
    resolveConflict(input: unknown): Promise<void>;
    push(input: unknown): Promise<void>;
  }>;
}

export interface GoldenLoopHarness {
  readonly mode: GoldenLoopMode;
  readonly worktree: string;
  readonly runDirectory: string;
  readonly report: GoldenLoopMachineReport | null;
  runBeat(number: BeatNumber): Promise<BeatResult>;
  runAll(): Promise<BeatResult[]>;
  human: {
    reviewDiff(input: unknown): Promise<void>;
    resolveConflict(input: unknown): Promise<void>;
    push(input: unknown): Promise<void>;
  };
  assertNoExternalNetwork(): void;
  preserveOnFailure(): Promise<string>;
  dispose(): Promise<void>;
}

export class GoldenLoopNetworkError extends Error {
  constructor(readonly violation: OfflineViolationReport) {
    super(
      `OFFLINE_NETWORK_VIOLATION beat=${violation.beat ?? "setup"} target=${violation.target} caller=${violation.caller}`,
    );
    this.name = "GoldenLoopNetworkError";
  }
}

function deterministicClock(): DeterministicClock {
  let milliseconds = BASE_TIME;
  return {
    now: () => new Date(milliseconds),
    advance(amount) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(
          "Deterministic clock advances must be non-negative integers",
        );
      }
      milliseconds += amount;
      return new Date(milliseconds);
    },
  };
}

async function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const result = await execFileAsync(executable, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function callerFromStack(): string {
  const lines = new Error().stack?.split("\n").slice(2) ?? [];
  const caller =
    lines
      .find(
        (line) =>
          !/golden-loop\/harness\.(?:js|ts):/u.test(line) &&
          !line.includes("node:internal") &&
          !line.includes("node_modules"),
      )
      ?.trim() ?? "unknown caller";
  return caller.replaceAll(process.cwd(), ".");
}

function targetFromSocketArgs(args: readonly unknown[]): Readonly<{
  host: string | null;
  port: number | null;
  path: string | null;
}> {
  const first = args[0];
  if (typeof first === "number") {
    return {
      host: typeof args[1] === "string" ? args[1] : "localhost",
      port: first,
      path: null,
    };
  }
  if (typeof first === "string") return { host: null, port: null, path: first };
  if (first !== null && typeof first === "object") {
    const options = first as Readonly<Record<string, unknown>>;
    return {
      host:
        typeof options["host"] === "string"
          ? options["host"]
          : typeof options["hostname"] === "string"
            ? options["hostname"]
            : "localhost",
      port:
        typeof options["port"] === "number"
          ? options["port"]
          : typeof options["port"] === "string"
            ? Number(options["port"])
            : null,
      path: typeof options["path"] === "string" ? options["path"] : null,
    };
  }
  return { host: null, port: null, path: null };
}

class OfflineNetworkGuard {
  readonly violations: OfflineViolationReport[] = [];
  private readonly restores: Array<() => void> = [];
  private beat: BeatNumber | null = null;

  constructor(
    private readonly ports: ReadonlySet<number>,
    private readonly socketPaths: ReadonlySet<string>,
  ) {}

  setBeat(beat: BeatNumber | null): void {
    this.beat = beat;
  }

  private authorize(
    target: Readonly<{
      host: string | null;
      port: number | null;
      path: string | null;
    }>,
  ): void {
    if (target.path !== null && this.socketPaths.has(resolve(target.path)))
      return;
    const host = target.host?.replace(/^\[|\]$/gu, "").toLowerCase() ?? null;
    const loopback =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (loopback && target.port !== null && this.ports.has(target.port)) return;
    const rendered =
      target.path ?? `${host ?? "unknown"}:${target.port ?? "unknown"}`;
    const violation = {
      beat: this.beat,
      caller: callerFromStack(),
      target: rendered,
    };
    this.violations.push(violation);
    throw new GoldenLoopNetworkError(violation);
  }

  private replace(object: object, key: PropertyKey, value: unknown): void {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor)
      throw new Error(`Cannot guard missing network primitive ${String(key)}`);
    Object.defineProperty(object, key, { ...descriptor, value });
    this.restores.push(() => Object.defineProperty(object, key, descriptor));
  }

  install(): void {
    if (this.restores.length > 0) return;
    const originalFetch = globalThis.fetch;
    this.replace(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        this.authorize({
          host: url.hostname,
          port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
          path: null,
        });
        return originalFetch(input, init);
      },
    );

    for (const [object, key] of [
      [net, "connect"],
      [net, "createConnection"],
    ] as const) {
      const original = object[key];
      this.replace(object, key, (...args: unknown[]) => {
        this.authorize(targetFromSocketArgs(args));
        return Reflect.apply(original, object, args);
      });
    }

    const requestTarget = (args: readonly unknown[], secure: boolean) => {
      const first = args[0];
      if (typeof first === "string" || first instanceof URL) {
        const url = new URL(first.toString());
        return {
          host: url.hostname,
          port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
          path: null,
        };
      }
      const socket = targetFromSocketArgs(args);
      return { ...socket, port: socket.port ?? (secure ? 443 : 80) };
    };
    for (const [object, key, secure] of [
      [http, "request", false],
      [http, "get", false],
      [https, "request", true],
      [https, "get", true],
    ] as const) {
      const original = object[key];
      this.replace(object, key, (...args: unknown[]) => {
        this.authorize(requestTarget(args, secure));
        return Reflect.apply(original, object, args);
      });
    }

    for (const key of ["lookup", "resolve"] as const) {
      const original = dns[key];
      this.replace(dns, key, (...args: unknown[]) => {
        const hostname =
          typeof args[0] === "string" ? args[0].toLowerCase() : "unknown";
        if (
          hostname !== "localhost" &&
          hostname !== "127.0.0.1" &&
          hostname !== "::1"
        ) {
          this.authorize({ host: hostname, port: 53, path: null });
        }
        return Reflect.apply(original, dns, args);
      });
    }
  }

  restore(): void {
    for (const restore of this.restores.reverse()) restore();
    this.restores.length = 0;
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  maximumMs: number,
  beat: BeatNumber,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(new Error(`Golden Loop beat ${beat} exceeded ${maximumMs} ms`)),
      maximumMs,
    );
  });
  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function createGoldenLoopHarness(
  options: GoldenLoopHarnessOptions,
): Promise<GoldenLoopHarness> {
  const mode = options.mode ?? "offline";
  const scenario = validateGoldenLoopScenario(options.scenario);
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const seed = options.seed ?? "HEAD";
  await run(
    "git",
    ["rev-parse", "--verify", `${seed}^{commit}`],
    repositoryRoot,
  );
  const runDirectory = await mkdtemp(
    join(tmpdir(), "finite-state-golden-loop-"),
  );
  const worktree = join(runDirectory, "worktree");
  const artifactRoot = join(runDirectory, "artifacts");
  await mkdir(artifactRoot, { recursive: true });
  await run(
    "git",
    ["worktree", "add", "--detach", worktree, seed],
    repositoryRoot,
  );

  const writer = createArtifactWriter(artifactRoot);
  const host = createFakePluginHost({
    ...options.host,
    pluginId: "finite-state",
  });
  const guard = new OfflineNetworkGuard(
    new Set(options.allowedLoopbackPorts ?? []),
    new Set((options.allowedSocketPaths ?? []).map((path) => resolve(path))),
  );
  const connectedUnavailable =
    mode === "connected" &&
    (!options.connected ||
      options.connected.optIn !== true ||
      options.connected.tenant.trim() === "" ||
      options.connected.bench.trim() === "");
  try {
    if (mode === "offline") guard.install();
    if (!connectedUnavailable) {
      if (mode === "connected") await options.connected!.reset();
      await options.configure?.({ bb: host.bb, host, worktree });
    }
  } catch (error) {
    try {
      await host.harness.lifecycle.dispose();
    } finally {
      try {
        await run(
          "git",
          ["worktree", "remove", "--force", worktree],
          repositoryRoot,
        );
      } finally {
        await rm(runDirectory, { recursive: true, force: true });
      }
    }
    throw error;
  } finally {
    guard.restore();
  }
  const clock = deterministicClock();
  const ids = new Map<string, number>();
  const jobs = new Map<string, number>();
  const hints: Array<
    Readonly<{ channel: string; payload: Readonly<Record<string, unknown>> }>
  > = [];
  const results = new Map<BeatNumber, BeatResult>();
  let preserved = false;
  let disposed = false;
  let report: GoldenLoopMachineReport | null = null;
  const startedAt = clock.now().toISOString();
  const startedPerformance = performance.now();
  const gitEnvironment: NodeJS.ProcessEnv = {
    GIT_AUTHOR_NAME: "Finite State Golden Loop",
    GIT_AUTHOR_EMAIL: "golden-loop@finite-state.test",
    GIT_COMMITTER_NAME: "Finite State Golden Loop",
    GIT_COMMITTER_EMAIL: "golden-loop@finite-state.test",
    GIT_AUTHOR_DATE: "2026-08-14T12:00:00Z",
    GIT_COMMITTER_DATE: "2026-08-14T12:00:00Z",
  };

  const relativeArtifact = (path: string) => relative(runDirectory, path);
  const tree = async () => {
    const [tracked, status] = await Promise.all([
      run("git", ["ls-files", "--stage"], worktree, gitEnvironment),
      run(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        worktree,
        gitEnvironment,
      ),
    ]);
    return { tracked: tracked.stdout, status: status.stdout };
  };

  const humanAction = async (
    name: "reviewDiff" | "resolveConflict" | "push",
    input: unknown,
  ) => {
    const artifact = await writer.writeJson(`human/${name}.json`, {
      actor: "human",
      input,
      at: clock.now().toISOString(),
    });
    await options.human?.[name]?.(input);
    return artifact;
  };

  const harness: GoldenLoopHarness = {
    mode,
    worktree,
    runDirectory,
    get report() {
      return report;
    },
    human: {
      reviewDiff: (input) =>
        humanAction("reviewDiff", input).then(() => undefined),
      resolveConflict: (input) =>
        humanAction("resolveConflict", input).then(() => undefined),
      push: (input) => humanAction("push", input).then(() => undefined),
    },
    async runBeat(number) {
      if (disposed) throw new Error("Golden Loop harness is disposed");
      const previous = results.get(number);
      if (previous) return previous;
      const beat = scenario.get(number);
      if (!beat) throw new Error(`Golden Loop beat ${number} is missing`);
      const started = clock.now().toISOString();
      const began = performance.now();
      const beatRoot = join(
        artifactRoot,
        `beat-${String(number).padStart(2, "0")}`,
      );
      const beatWriter = createArtifactWriter(beatRoot);
      const artifacts: string[] = [];
      const controller = new AbortController();
      const context: GoldenLoopBeatContext = {
        mode,
        beat: number,
        worktree,
        clock,
        ids: {
          next(namespace) {
            const next = (ids.get(namespace) ?? 0) + 1;
            ids.set(namespace, next);
            return `${namespace}-${String(next).padStart(4, "0")}`;
          },
        },
        jobs: {
          current: (jobId) => jobs.get(jobId) ?? 0,
          advance(jobId) {
            const next = (jobs.get(jobId) ?? 0) + 1;
            jobs.set(jobId, next);
            return next;
          },
        },
        realtime: {
          publish(channel, payload) {
            hints.push({ channel, payload });
          },
          drain() {
            return hints.splice(0, hints.length);
          },
        },
        interrupts: {
          signal: controller.signal,
          interrupt: (reason) =>
            controller.abort(reason ?? "golden-loop interrupt"),
        },
        git: {
          run: (args) => run("git", args, worktree, gitEnvironment),
        },
        artifacts: beatWriter,
      };
      if (connectedUnavailable) {
        const result: BeatResult = {
          beat: number,
          name: beat.name,
          status: "skipped",
          startedAt: started,
          durationMs: 0,
          assertions: [
            {
              name: "connected preflight",
              passed: false,
              detail:
                "CONNECTED_MODE_UNAVAILABLE: explicit tenant, bench, opt-in, and reset callback are required",
            },
          ],
          artifacts: [],
        };
        results.set(number, result);
        return result;
      }

      guard.setBeat(number);
      if (mode === "offline") guard.install();
      let assertions = [] as BeatResult["assertions"];
      let status: BeatResult["status"] = "passed";
      try {
        artifacts.push(
          relativeArtifact(
            await beatWriter.writeJson("tree-before.json", await tree()),
          ),
        );
        await withTimeout(
          (async () => {
            await beat.setup?.(context);
            await beat.action(context);
            assertions = await beat.assert(context);
            requirePassed(assertions);
            for (const captured of (await beat.capture?.(context)) ?? []) {
              artifacts.push(relativeArtifact(captured));
            }
          })(),
          beat.maxMs,
          number,
        );
        if (beat.expectedFailure) {
          status = "failed";
          assertions.push({
            name: `pending ${beat.expectedFailure.task}`,
            passed: false,
            detail: "unexpected pass; remove the stale expected-failure marker",
          });
          await harness.preserveOnFailure();
        }
      } catch (error) {
        if (beat.expectedFailure) {
          const observed =
            error instanceof Error ? error.message : String(error);
          const matches = observed.includes(beat.expectedFailure.signature);
          status = matches ? "skipped" : "failed";
          assertions.push({
            name: `${matches ? "pending" : "mismatched pending"} ${beat.expectedFailure.task}`,
            passed: false,
            detail: matches
              ? `${beat.expectedFailure.reason}; observed: ${observed}`
              : `expected refusal containing ${JSON.stringify(beat.expectedFailure.signature)}, observed: ${observed}`,
          });
          artifacts.push(
            relativeArtifact(
              await beatWriter.writeJson(
                matches
                  ? "expected-failure.json"
                  : "expected-failure-mismatch.json",
                {
                  task: beat.expectedFailure.task,
                  reason: beat.expectedFailure.reason,
                  signature: beat.expectedFailure.signature,
                  observed,
                },
              ),
            ),
          );
          if (!matches) await harness.preserveOnFailure();
        } else {
          status = "failed";
          assertions.push(failedAssertion(error));
          await harness.preserveOnFailure();
        }
      } finally {
        guard.restore();
        artifacts.push(
          relativeArtifact(
            await beatWriter.writeJson("tree-after.json", await tree()),
          ),
        );
      }
      for (const artifact of beatWriter.written()) {
        artifacts.push(relativeArtifact(artifact));
      }
      const result: BeatResult = {
        beat: number,
        name: beat.name,
        status,
        startedAt: started,
        durationMs: Math.round(performance.now() - began),
        assertions,
        artifacts: [...new Set(artifacts)],
      };
      results.set(number, result);
      return result;
    },
    async runAll() {
      for (const { number } of GOLDEN_LOOP_BEATS) await harness.runBeat(number);
      const ordered = GOLDEN_LOOP_BEATS.map(
        ({ number }) => results.get(number)!,
      );
      report = {
        schemaVersion: 1,
        mode,
        seed,
        startedAt,
        durationMs: Math.round(performance.now() - startedPerformance),
        status:
          ordered.some(({ status }) => status === "failed") ||
          ordered.every(({ status }) => status === "skipped")
            ? "failed"
            : "passed",
        results: ordered,
        offlineViolations: [...guard.violations],
        ohMoments: Object.fromEntries(
          ([5, 7, 11, 12] as const).map((number) => [
            String(number),
            results.get(number)?.artifacts ?? [],
          ]),
        ),
      };
      await writeGoldenLoopReports(writer, report);
      if (options.evidenceDirectory) {
        await cp(artifactRoot, resolve(options.evidenceDirectory), {
          recursive: true,
          force: true,
        });
      }
      return ordered;
    },
    assertNoExternalNetwork() {
      if (guard.violations.length > 0) {
        throw new GoldenLoopNetworkError(guard.violations[0]!);
      }
    },
    async preserveOnFailure() {
      preserved = true;
      await writer.writeJson("PRESERVED.json", {
        reason: "Golden Loop failure evidence",
        worktree:
          "unregistered during disposal; inspect captured tree and git artifacts",
      });
      return runDirectory;
    },
    async dispose() {
      if (disposed) return;
      guard.restore();
      try {
        await host.harness.lifecycle.dispose();
      } finally {
        try {
          await run(
            "git",
            ["worktree", "remove", "--force", worktree],
            repositoryRoot,
          );
          if (!preserved) {
            await rm(runDirectory, { recursive: true, force: true });
          }
        } finally {
          disposed = true;
        }
      }
    },
  };
  return harness;
}
