import type { GoldenLoopArtifactWriter } from "./reporter.js";

export type GoldenLoopMode = "offline" | "connected";

export type BeatNumber =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14;

export interface GoldenLoopAssertion {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface BeatResult {
  beat: BeatNumber;
  name: string;
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  durationMs: number;
  assertions: GoldenLoopAssertion[];
  artifacts: string[];
}

export interface DeterministicClock {
  now(): Date;
  advance(milliseconds: number): Date;
}

export interface DeterministicIds {
  next(namespace: string): string;
}

export interface DeterministicJobs {
  current(jobId: string): number;
  advance(jobId: string): number;
}

export interface RealtimeHints {
  publish(channel: string, payload: Readonly<Record<string, unknown>>): void;
  drain(): readonly Readonly<{
    channel: string;
    payload: Readonly<Record<string, unknown>>;
  }>[];
}

export interface InterruptHooks {
  readonly signal: AbortSignal;
  interrupt(reason?: string): void;
}

export interface DisposableGit {
  run(
    args: readonly string[],
  ): Promise<Readonly<{ stdout: string; stderr: string }>>;
}

export interface GoldenLoopBeatContext {
  readonly mode: GoldenLoopMode;
  readonly beat: BeatNumber;
  readonly worktree: string;
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIds;
  readonly jobs: DeterministicJobs;
  readonly realtime: RealtimeHints;
  readonly interrupts: InterruptHooks;
  readonly git: DisposableGit;
  readonly artifacts: GoldenLoopArtifactWriter;
}

export interface GoldenLoopBeat {
  readonly number: BeatNumber;
  readonly name: string;
  readonly maxMs: number;
  readonly expectedFailure?: Readonly<{
    task: string;
    reason: string;
    signature: string;
  }>;
  setup?(context: GoldenLoopBeatContext): Promise<void>;
  action(context: GoldenLoopBeatContext): Promise<void>;
  assert(context: GoldenLoopBeatContext): Promise<GoldenLoopAssertion[]>;
  capture?(context: GoldenLoopBeatContext): Promise<readonly string[]>;
}

/**
 * Stable orchestration slots. The seven sweep regressions are first-class
 * beats; the other merged-surface beats pin their shared journey boundaries.
 */
export const GOLDEN_LOOP_BEATS = [
  { number: 1, name: "FS-167 fresh sync review", maxMs: 60_000 },
  { number: 2, name: "FS-168 bulk triage writes", maxMs: 60_000 },
  { number: 3, name: "FS-171 bench dispatch durability", maxMs: 60_000 },
  { number: 4, name: "FS-172 recoverable SBOM pull", maxMs: 90_000 },
  { number: 5, name: "FS-193 quarantined finding recovery", maxMs: 90_000 },
  { number: 6, name: "FS-194 single triage write and undo", maxMs: 60_000 },
  { number: 7, name: "FS-201 requirement-to-bench loop", maxMs: 90_000 },
  { number: 8, name: "BOM inventory durable read", maxMs: 60_000 },
  { number: 9, name: "Canvas authored model", maxMs: 60_000 },
  {
    number: 10,
    name: "FS-196 default-pull kind isolation and refetch hint",
    maxMs: 60_000,
  },
  { number: 11, name: "Bench run evidence", maxMs: 90_000 },
  { number: 12, name: "Demo cards rendered state", maxMs: 60_000 },
  { number: 13, name: "Reviewable git commit", maxMs: 60_000 },
  { number: 14, name: "Human review and push boundary", maxMs: 60_000 },
] as const satisfies readonly {
  number: BeatNumber;
  name: string;
  maxMs: number;
}[];

const ALL_BEATS = new Set<BeatNumber>(
  GOLDEN_LOOP_BEATS.map(({ number }) => number),
);

export function validateGoldenLoopScenario(
  beats: readonly GoldenLoopBeat[],
): ReadonlyMap<BeatNumber, GoldenLoopBeat> {
  const byNumber = new Map<BeatNumber, GoldenLoopBeat>();
  for (const beat of beats) {
    if (byNumber.has(beat.number)) {
      throw new Error(`Golden Loop beat ${beat.number} is duplicated`);
    }
    const contract = GOLDEN_LOOP_BEATS.find(
      ({ number }) => number === beat.number,
    );
    if (!contract || !ALL_BEATS.has(beat.number)) {
      throw new Error(`Golden Loop beat ${beat.number} is outside 1..14`);
    }
    if (beat.name !== contract.name || beat.maxMs !== contract.maxMs) {
      throw new Error(
        `Golden Loop beat ${beat.number} metadata differs from GOLDEN_LOOP_BEATS`,
      );
    }
    byNumber.set(beat.number, beat);
  }
  const missing = GOLDEN_LOOP_BEATS.filter(
    ({ number }) => !byNumber.has(number),
  ).map(({ number }) => number);
  if (missing.length > 0) {
    throw new Error(`Golden Loop beats missing: ${missing.join(", ")}`);
  }
  return byNumber;
}
