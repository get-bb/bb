export const VERIFICATION_TIERS = [
  "static",
  "emulation",
  "hil",
  "manual",
  "hardware",
] as const;

export type VerificationTier = (typeof VERIFICATION_TIERS)[number];

export const RESULT_STATES = [
  "failed",
  "error",
  "inconclusive",
  "running",
  "pending",
  "verified",
  "skipped",
] as const;

export type VerificationResultState = (typeof RESULT_STATES)[number];

export type MatrixCellState =
  | VerificationResultState
  | "mapped_not_run"
  | "unmapped";

export interface VerificationCell {
  requirementId: string;
  tier: VerificationTier;
  state: MatrixCellState;
  checkCount: number;
  requiredCount: number;
  latestAt: string | null;
  runIds: string[];
}

export interface MatrixRow {
  requirementId: string;
  title: string;
  pattern: string | null;
  requirementType: string | null;
  priority: string | null;
  stale: boolean;
  unknownCheckCount: number;
  cells: Record<VerificationTier, VerificationCell>;
}

export interface MatrixRollup {
  requirements: number;
  verified: number;
  failed: number;
  error: number;
  inconclusive: number;
  running: number;
  pending: number;
  skipped: number;
}

export interface MatrixPageFields {
  row: MatrixRow;
  rollup: MatrixRollup;
  preferences: { showManual: boolean };
}

export const WORST_STATE_ORDER: readonly VerificationResultState[] = [
  "failed",
  "error",
  "inconclusive",
  "running",
  "pending",
  "verified",
  "skipped",
];

export const TIER_LABELS: Record<VerificationTier, string> = {
  static: "Static",
  emulation: "Emulation",
  hil: "HIL",
  manual: "Manual",
  hardware: "Hardware",
};

export const CELL_STATE_LABELS: Record<MatrixCellState, string> = {
  failed: "Failed",
  error: "Error",
  inconclusive: "Inconclusive",
  running: "Running",
  pending: "Pending",
  verified: "Verified",
  skipped: "Skipped",
  mapped_not_run: "Mapped, not run",
  unmapped: "No check mapped",
};

export function isVerificationTier(value: string): value is VerificationTier {
  return VERIFICATION_TIERS.some((tier) => tier === value);
}

export function isVerificationResultState(
  value: string,
): value is VerificationResultState {
  return RESULT_STATES.some((state) => state === value);
}

export function isUnprovenState(state: MatrixCellState): boolean {
  return state !== "verified" && state !== "skipped";
}
