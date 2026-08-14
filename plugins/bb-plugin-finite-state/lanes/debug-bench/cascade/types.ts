import type {
  BenchRunRequest,
  BenchRunStarted,
} from "../../bench/execute/run.js";
import type { FirmwareReadinessSnapshot } from "../../firmware/forge/readiness.js";

export const HYPOTHESIS_CLASSES = [
  "logic",
  "state",
  "timing",
  "power",
  "analog",
  "environmental",
] as const;
export type HypothesisClass = (typeof HYPOTHESIS_CLASSES)[number];

export const CASCADE_TIERS = ["d0", "d1", "d2", "d3"] as const;
export type CascadeTier = (typeof CASCADE_TIERS)[number];

export const VERDICT_OUTCOMES = [
  "confirmed",
  "refuted",
  "inconclusive",
] as const;
export type VerdictOutcome = (typeof VERDICT_OUTCOMES)[number];

export interface Hypothesis {
  id: string;
  text: string;
  class: HypothesisClass;
  likelihood: number;
  easeOfVerification: number;
}

export interface EvidenceArtifact {
  kind: string;
  path: string;
}

export interface VerdictAnnotation {
  code:
    | "BLOB_ONLY_ANALYSIS"
    | "CLASS_REQUIRES_PHYSICAL"
    | "EMULATION_FAILED"
    | "NONDETERMINISTIC_OUTPUT";
  message: string;
}

export interface TierVerdict {
  tier: CascadeTier;
  hypothesisId: string;
  outcome: VerdictOutcome;
  forcedEscalation: boolean;
  evidence: EvidenceArtifact[];
  producedBy: { command: string[]; inputs: Record<string, string> };
  annotations?: VerdictAnnotation[];
  rehostingRunId?: string;
}

export type EscalationDecision =
  | { action: "answered"; verdict: TierVerdict }
  | {
      action: "escalate";
      toTier: CascadeTier;
      because: "inconclusive" | "class_requires_physical";
    }
  | { action: "stop"; reason: string };

export interface D3Handoff {
  hypothesis: Hypothesis;
  discriminatingObservation: string;
  suggestedInstrumentKind: "probe" | "logic" | "power" | "scope" | "serial";
}

export interface CascadeSessionStep {
  sequence: number;
  hypothesisId: string;
  verdict: TierVerdict;
  decision: EscalationDecision;
}

export interface CascadeDiagnosis {
  summary: string;
  outcome: VerdictOutcome;
  evidence: EvidenceArtifact[];
}

export interface CascadeSession {
  sessionId: string;
  probeRunId: string;
  projectId: string;
  projectVersionId: string | null;
  hypotheses: Hypothesis[];
  steps: CascadeSessionStep[];
  diagnosis: CascadeDiagnosis | null;
  revision: number;
  startedAt: string;
  finishedAt: string | null;
}

export type StaticQuery =
  | {
      kind: "call_path";
      hypothesis: Hypothesis;
      projectVersionId: string;
      fromSymbol: string;
      toSymbol: string;
    }
  | {
      kind: "init_sequence";
      hypothesis: Hypothesis;
      projectVersionId: string;
      siliconFamily: string;
      expectedSequence: readonly string[];
    };

export interface StaticAnalysisResult {
  status: "completed" | "failed";
  matched: boolean;
  observedSequence?: readonly string[];
  command: readonly string[];
  evidence: readonly EvidenceArtifact[];
  failureReason?: string;
}

export interface CorpusObservation {
  siliconFamily: string;
  initSequence: readonly string[];
  evidence: readonly EvidenceArtifact[];
}

export type ReproSymptom =
  | { kind: "boot_hang"; marker: string }
  | { kind: "crash_signature"; signature: string }
  | { kind: "log_pattern"; pattern: string };

export interface ReproRequest {
  hypothesis: Hypothesis;
  bench: BenchRunRequest & { tier: "tier1" };
  symptom: ReproSymptom;
}

export interface RehostingObservation {
  output: string;
  command: readonly string[];
  evidence: readonly EvidenceArtifact[];
}

export type RehostingRunState =
  | { state: "running" }
  | { state: "completed" }
  | { state: "failed"; failureReason?: string };

export interface RenodeReplayRequest {
  kind: "boot_chain" | "golden_regression" | "model_platform";
  hypothesis: Hypothesis;
  scenarioPath: string;
  goldenLogPath: string;
  platformPath: string;
  outputArtifactPath: string;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RenodeDriver {
  executable: string;
  probe(signal: AbortSignal): Promise<boolean>;
  run(
    argv: readonly string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<ProcessResult>;
}

export interface CascadeDeps {
  loadFirmwareReadiness(
    projectVersionId: string,
    signal: AbortSignal,
  ): Promise<FirmwareReadinessSnapshot>;
  stp: {
    configured: boolean;
    run(
      rootfsPath: string,
      query: StaticQuery,
      signal: AbortSignal,
    ): Promise<StaticAnalysisResult>;
  };
  corpus?: {
    findInitSequence(
      siliconFamily: string,
      signal: AbortSignal,
    ): Promise<CorpusObservation | null>;
  };
  runBench(
    request: BenchRunRequest,
    signal: AbortSignal,
  ): Promise<BenchRunStarted>;
  waitForRehostingTerminal(
    runId: string,
    signal: AbortSignal,
  ): Promise<RehostingRunState>;
  readRehostingObservation(
    runId: string,
    signal: AbortSignal,
  ): Promise<RehostingObservation>;
  renode: RenodeDriver;
  scenariosRoot: string;
  artifactsRoot: string;
  isTrackedFile(path: string, signal: AbortSignal): Promise<boolean>;
  readText(path: string, signal: AbortSignal): Promise<string>;
  writeText(path: string, text: string, signal: AbortSignal): Promise<void>;
}

export class CascadeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly needsConfiguration: string | null = null,
  ) {
    super(message);
    this.name = "CascadeError";
  }
}

export class VerdictValidationError extends CascadeError {
  constructor(
    message: string,
    readonly coercedVerdict: TierVerdict,
  ) {
    super("CASCADE_CONFIRM_REQUIRES_PHYSICAL", message);
    this.name = "VerdictValidationError";
  }
}
