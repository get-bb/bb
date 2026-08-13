import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import type { DeviceClaim } from "../registry/claims.js";
import type { CaptureArtifact, InstrumentTransport, ProcessRunner } from "./transport.js";
import { InstrumentError, runInstrumentProcess } from "./transport.js";
import { createDigilentLogicDriver } from "./logic/digilent.js";
import { createSaleaeDriver } from "./logic/saleae.js";

export type { DeviceClaim } from "../registry/claims.js";
export type { InstrumentTransport } from "./transport.js";
export { DeviceLostError, InstrumentError } from "./transport.js";
export type { CaptureArtifact, InstrumentErrorCode } from "./transport.js";

export interface InstrumentCapabilities {
  kind: "logic" | "power" | "scope" | "probe" | "serial" | string;
  channels: number;
  maxSampleRateHz: number | null;
  features: readonly string[];
}

export interface CaptureArtifactSink {
  readonly directory: string;
  record(artifact: CaptureArtifact): Promise<void>;
}

export interface CaptureConfig {
  durationMs: number;
  sampleRateHz: number;
  channels: readonly number[];
  settings?: Readonly<Record<string, string | number | boolean | null>>;
  artifactSink: CaptureArtifactSink;
}

export interface PrerequisiteItem {
  key: string;
  configured: boolean;
  remediation: string;
}

export interface PrerequisiteReport {
  configured: boolean;
  needsConfiguration: readonly PrerequisiteItem[];
}

export interface InstrumentSession {
  readonly deviceId: string;
  readonly capabilities: InstrumentCapabilities;
  capture(config: CaptureConfig, signal: AbortSignal): Promise<CaptureArtifact>;
  close(): Promise<void>;
}

export interface InstrumentDriver {
  readonly id: string;
  detect(transport: InstrumentTransport): Promise<InstrumentCapabilities | null>;
  open(
    transport: InstrumentTransport,
    claim: DeviceClaim,
    signal: AbortSignal,
  ): Promise<InstrumentSession>;
  prerequisites(): PrerequisiteReport;
}

export interface InstrumentDriverDeps {
  verifyClaim(claim: DeviceClaim, expectedDeviceId: string): void;
  releaseClaim?: (claim: DeviceClaim) => void;
  runner?: ProcessRunner;
  prerequisiteReport?: () => PrerequisiteReport;
}

export function validateCaptureConfig(
  config: CaptureConfig,
  capabilities: InstrumentCapabilities,
  maximumDurationMs: number,
): void {
  if (!Number.isInteger(config.durationMs) || config.durationMs < 1 ||
      config.durationMs > maximumDurationMs) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      `Capture duration must be between 1 and ${maximumDurationMs} ms.`,
    );
  }
  if (!Number.isInteger(config.sampleRateHz) || config.sampleRateHz < 1 ||
      (capabilities.maxSampleRateHz !== null &&
        config.sampleRateHz > capabilities.maxSampleRateHz)) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Capture sample rate is outside the instrument capability bounds.",
    );
  }
  const channels = [...new Set(config.channels)];
  if (channels.length === 0 || channels.length !== config.channels.length ||
      channels.some((channel) => !Number.isInteger(channel) || channel < 0 ||
        channel >= capabilities.channels)) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Capture channels must be unique integers within the instrument channel range.",
    );
  }
  if (!isAbsolute(config.artifactSink.directory)) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Capture artifact directories must be absolute.",
    );
  }
}

function assertSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) || value === "." || value === "..") {
    throw new InstrumentError("CAPTURE_CONFIG_INVALID", `${label} is not a safe path segment.`);
  }
}

async function assertNoSymlink(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new InstrumentError(
        "CAPTURE_CONFIG_INVALID",
        `Bench artifact root ${path} must not be a symbolic link.`,
      );
    }
  } catch (error) {
    if (error instanceof InstrumentError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export interface ProbeRunArtifactSinkOptions {
  db: Database.Database;
  worktreeRoot: string;
  projectId: string;
  projectVersionId: string | null;
  runId: string;
  publishChanged?: (
    channel: "probe:changed",
    hint: { projectId: string; projectVersionId: string | null; runId: string },
  ) => void;
  isIgnored?: (worktreeRoot: string, relativePath: string) => Promise<boolean>;
}

interface ProbeArtifactRow { artifacts: string | null }

function parseArtifactPaths(value: string | null): string[] {
  if (value === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "The probe run artifact list is malformed.",
      { cause: error },
    );
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "The probe run artifact list is malformed.",
    );
  }
  return parsed;
}

/**
 * WP-89 owns the eventual shared layout helper. Until it lands, this confined
 * seam follows the coordinator-ratified `.fs-bench/probe-runs/<run>/logic`
 * layout and fails closed unless the root is gitignored.
 */
export async function createProbeRunArtifactSink(
  options: ProbeRunArtifactSinkOptions,
): Promise<CaptureArtifactSink> {
  assertSegment(options.runId, "Probe run id");
  const worktreeRoot = await realpath(options.worktreeRoot);
  const relativeDirectory = join(".fs-bench", "probe-runs", options.runId, "logic");
  const ignored = await (options.isIgnored ?? defaultIgnoreCheck)(
    worktreeRoot,
    relativeDirectory,
  );
  if (!ignored) {
    throw new InstrumentError(
      "INSTRUMENT_NOT_CONFIGURED",
      ".fs-bench must be gitignored before instrument artifacts can be written.",
    );
  }
  const benchRoot = join(worktreeRoot, ".fs-bench");
  const artifactRoots = [
    benchRoot,
    join(benchRoot, "probe-runs"),
    join(benchRoot, "probe-runs", options.runId),
    join(benchRoot, "probe-runs", options.runId, "logic"),
  ];
  for (const root of artifactRoots) await assertNoSymlink(root);
  await mkdir(artifactRoots.at(-1)!, { recursive: true });
  for (const root of artifactRoots) await assertNoSymlink(root);
  const directory = await realpath(join(benchRoot, "probe-runs", options.runId, "logic"));
  const prefix = `${directory}${sep}`;

  return {
    directory,
    async record(artifact) {
      const artifactPath = await realpath(resolve(artifact.path));
      if (!artifactPath.startsWith(prefix)) {
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          "Instrument artifact escaped its probe-run directory.",
        );
      }
      await access(artifactPath, constants.R_OK);
      const projectVersionId = toStorageProjectVersionId(options.projectVersionId);
      const transaction = options.db.transaction((): boolean => {
        const row = options.db.prepare<[string, string, string], ProbeArtifactRow>(
          `SELECT artifacts FROM probe_run
            WHERE project_id = ? AND project_version_id = ? AND run_id = ?`,
        ).get(options.projectId, projectVersionId, options.runId);
        if (!row) {
          throw new InstrumentError(
            "INSTRUMENT_PROTOCOL_ERROR",
            `Probe run ${options.runId} was not found.`,
          );
        }
        const relativePath = relative(worktreeRoot, artifactPath).split(sep).join("/");
        const artifacts = parseArtifactPaths(row.artifacts);
        if (artifacts.includes(relativePath)) return false;
        artifacts.push(relativePath);
        options.db.prepare(
          `UPDATE probe_run SET artifacts = ?
            WHERE project_id = ? AND project_version_id = ? AND run_id = ?`,
        ).run(JSON.stringify(artifacts), options.projectId, projectVersionId, options.runId);
        return true;
      });
      if (transaction.immediate()) {
        options.publishChanged?.("probe:changed", {
          projectId: options.projectId,
          projectVersionId: options.projectVersionId,
          runId: options.runId,
        });
      }
    },
  };
}

async function defaultIgnoreCheck(worktreeRoot: string, relativePath: string): Promise<boolean> {
  const result = await runInstrumentProcess({
    command: "git",
    args: ["check-ignore", "--quiet", "--", relativePath],
    cwd: worktreeRoot,
    timeoutMs: 5_000,
    maxOutputBytes: 4_096,
  }, new AbortController().signal).catch(() => null);
  return result?.code === 0;
}

export interface ReplayDriverOptions extends InstrumentDriverDeps {
  fixturePath: string;
  id?: string;
}

const REPLAY_CAPABILITIES: InstrumentCapabilities = {
  kind: "logic",
  channels: 8,
  maxSampleRateHz: 100_000_000,
  features: ["capture:replay", "decode:spi", "decode:i2c", "decode:uart", "decode:can"],
};

export function createReplayLogicDriver(options: ReplayDriverOptions): InstrumentDriver {
  return {
    id: options.id ?? "replay-fixture",
    async detect(transport) {
      return transport.kind === "bb-host" ? null : REPLAY_CAPABILITIES;
    },
    async open(_transport, claim, signal) {
      options.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      let closed = false;
      let released = false;
      const release = () => {
        closed = true;
        if (!released) {
          released = true;
          options.releaseClaim?.(claim);
        }
      };
      signal.addEventListener("abort", release, { once: true });
      return {
        deviceId: claim.deviceId,
        capabilities: REPLAY_CAPABILITIES,
        async capture(config, captureSignal) {
          if (closed) throw new InstrumentError("SESSION_CLOSED", "Instrument session is closed.");
          captureSignal.throwIfAborted();
          validateCaptureConfig(config, REPLAY_CAPABILITIES, 60_000);
          options.verifyClaim(claim, claim.deviceId);
          const path = join(config.artifactSink.directory, "replay-capture.json");
          await mkdir(dirname(path), { recursive: true });
          try {
            await copyReplayFixture(options.fixturePath, path);
            captureSignal.throwIfAborted();
            const artifact = {
              path,
              format: "finite-state-logic-json-v1",
              durationMs: config.durationMs,
              channels: config.channels.length,
            } satisfies CaptureArtifact;
            await config.artifactSink.record(artifact);
            return artifact;
          } catch (error) {
            release();
            throw error;
          } finally {
            if (captureSignal.aborted) release();
          }
        },
        async close() {
          signal.removeEventListener("abort", release);
          release();
        },
      };
    },
    prerequisites() { return { configured: true, needsConfiguration: [] }; },
  };
}

async function copyReplayFixture(fixturePath: string, targetPath: string): Promise<void> {
  const fixtureRoot = dirname(fixturePath);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch (error) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Replay capture fixture is not valid JSON.",
      { cause: error },
    );
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Replay capture fixture must be an object.");
  }
  const exports = Reflect.get(manifest, "decoderExports");
  if (typeof exports !== "object" || exports === null || Array.isArray(exports)) {
    throw new InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Replay decoder exports must be an object.");
  }
  for (const value of Object.values(exports)) {
    if (typeof value !== "string" || isAbsolute(value)) {
      throw new InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Replay decoder export path is unsafe.");
    }
    const source = resolve(fixtureRoot, value);
    const sourceRelative = relative(fixtureRoot, source);
    if (sourceRelative === ".." || sourceRelative.startsWith(`..${sep}`)) {
      throw new InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Replay decoder export escaped its fixture directory.");
    }
    const target = resolve(dirname(targetPath), value);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  await copyFile(fixturePath, targetPath);
}

const refuseUnwiredClaim = (): never => {
  throw new InstrumentError(
    "CLAIM_VERIFIER_NOT_CONFIGURED",
    "The instrument driver must be constructed with the registry claim verifier.",
  );
};

const defaultReplayFixture = fileURLToPath(
  new URL("./logic/fixtures/session.json", import.meta.url),
);

export const logicDrivers: readonly InstrumentDriver[] = Object.freeze([
  createSaleaeDriver({ verifyClaim: refuseUnwiredClaim }),
  createDigilentLogicDriver({ verifyClaim: refuseUnwiredClaim }),
  createReplayLogicDriver({
    verifyClaim: refuseUnwiredClaim,
    runner: runInstrumentProcess,
    fixturePath: defaultReplayFixture,
  }),
]);
