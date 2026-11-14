import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  parseProviderProcessInputs,
  type ProviderProcessInputs,
} from "./recorded-scenarios.js";
export * from "./recorded-scenarios.js";
import { firstPartyReplayBridge } from "./first-party-replay.js";
import {
  replayRecording,
  type CreateParityAssembler,
  type ParityRun,
  type ReplayProviderProfile,
} from "./parity.js";
import {
  COMMITTED_RECORDINGS_ROOT,
  listRecordedCells,
  type RecordedCell,
} from "./recording.js";

export function scenarioRecordingsRoot(): string {
  return join(COMMITTED_RECORDINGS_ROOT, "scenarios");
}

export function listScenarioCells(): RecordedCell[] {
  return listRecordedCells(scenarioRecordingsRoot());
}

function readProviderExit(
  cell: RecordedCell,
): { run: number; seq: number; signal: "SIGKILL" | "SIGTERM" } | undefined {
  return z
    .object({
      providerExit: z
        .object({
          run: z.number(),
          seq: z.number(),
          signal: z.enum(["SIGKILL", "SIGTERM"]),
        })
        .optional(),
    })
    .parse(JSON.parse(readFileSync(join(cell.dir, "manifest.json"), "utf8")))
    .providerExit;
}

function probeChildPath(): string {
  return fileURLToPath(new URL("./provider-probe-child.mjs", import.meta.url));
}

function probeArgs(cell: RecordedCell, logDir: string): string[] {
  const exit = readProviderExit(cell);
  return [
    "--probe-log",
    logDir,
    "--recording",
    cell.dir,
    ...(exit === undefined
      ? []
      : [
          "--exit-after",
          `${exit.run}:${exit.seq}`,
          "--exit-signal",
          exit.signal,
        ]),
  ];
}

function probingProfile(
  base: ReplayProviderProfile,
  args: string[],
): ReplayProviderProfile {
  const probed = (replayCommand: string[]): string[] => [
    process.execPath,
    probeChildPath(),
    ...args,
    "--",
    ...replayCommand,
  ];
  return {
    ...base,
    env: (envArgs) => {
      const command = probed(envArgs.replayCommand);
      const wrapperPath = join(envArgs.stateDir, "probe-provider.mjs");
      writeFileSync(
        wrapperPath,
        [
          "#!/usr/bin/env node",
          `process.argv.splice(2, 0, ${JSON.stringify(command.slice(2)).slice(1, -1)});`,
          `await import(${JSON.stringify(pathToFileURL(probeChildPath()).href)});`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      return base.env({ ...envArgs, replayCommand: command, wrapperPath });
    },
    ...(base.rewriteRuntimeLine === undefined
      ? {}
      : {
          rewriteRuntimeLine: (line, rewriteArgs) =>
            base.rewriteRuntimeLine!(line, {
              replayCommand: probed(rewriteArgs.replayCommand),
            }),
        }),
  };
}

function readProviderInputs(logDir: string): ProviderProcessInputs[] {
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((file) => file.endsWith(".ndjson"))
    .map((file) =>
      parseProviderProcessInputs({
        pid: Number(file.replace(/\.ndjson$/, "")),
        entries: readFileSync(join(logDir, file), "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line)),
      }),
    )
    .sort(
      (left, right) =>
        (left.entries[0]?.ts ?? 0) - (right.entries[0]?.ts ?? 0) ||
        left.pid - right.pid,
    );
}

export interface ScenarioReplay {
  run: ParityRun;
  providerInputs: ProviderProcessInputs[];
  divergence: string[];
}

const REPLAY_CHILD_DIVERGENCE =
  /stalled for|past end of segment|bridge skipped recorded|releasing segment|no recorded segment \d/;

function replayDivergence(run: ParityRun, providerStderr: string): string[] {
  return [
    ...run.stalls,
    ...providerStderr
      .split("\n")
      .filter(
        (line) =>
          REPLAY_CHILD_DIVERGENCE.test(line) &&
          !line.includes("[replay-child #null]"),
      ),
  ];
}

export interface ReplayScenarioCellOptions {
  checkoutRoot: string;
  createAssembler: CreateParityAssembler;
  timeoutMs?: number;
  onStderr?: (text: string) => void;
}

export async function replayScenarioCell(
  cell: RecordedCell,
  options: ReplayScenarioCellOptions,
): Promise<ScenarioReplay> {
  const logDir = mkdtempSync(join(tmpdir(), "bb-scenario-probe-"));
  try {
    const bridge = firstPartyReplayBridge(cell.provider, options.checkoutRoot);
    const run = await replayRecording({
      recordingDir: cell.dir,
      providerId: cell.provider,
      bridge: bridge.launch,
      profile: probingProfile(bridge.profile, probeArgs(cell, logDir)),
      createAssembler: options.createAssembler,
      orderTimeoutMs: 1_000,
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.onStderr === undefined ? {} : { onStderr: options.onStderr }),
    });
    const providerStderr = readdirSync(logDir)
      .filter((file) => file.endsWith(".stderr"))
      .map((file) => readFileSync(join(logDir, file), "utf8"))
      .join("");
    return {
      run,
      providerInputs: readProviderInputs(logDir),
      divergence: replayDivergence(run, providerStderr),
    };
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
}

export interface ScenarioKnownGap {
  provider: string;
  cell: string;
  check: string;
  reason: string;
}

export function readScenarioKnownGaps(): ScenarioKnownGap[] {
  return z
    .array(
      z.object({
        provider: z.string(),
        cell: z.string(),
        check: z.string(),
        reason: z.string().min(1),
      }),
    )
    .parse(
      JSON.parse(
        readFileSync(join(scenarioRecordingsRoot(), "known-gaps.json"), "utf8"),
      ),
    );
}
