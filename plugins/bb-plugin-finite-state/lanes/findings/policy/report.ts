export const POLICY_SAMPLE_LIMIT = 5;
export const POLICY_DETAIL_LIMIT = 100;

export interface PolicyRuleReport {
  name: string;
  matched: number;
  wouldWrite: number;
  held: number;
  samples: string[];
}

export interface PolicyReport {
  runId: string;
  policySha256: string;
  dryRun: boolean;
  rules: PolicyRuleReport[];
  written: number;
  held: Array<{ stableKey: string; rule: string; why: string }>;
  skippedExisting: number;
  errors: Array<{ stableKey?: string; code: string; message: string }>;
}

export function boundedPush<T>(items: T[], value: T, limit = POLICY_DETAIL_LIMIT): void {
  if (items.length < limit) items.push(value);
}

export function sample(report: PolicyRuleReport, stableKey: string): void {
  if (report.samples.length < POLICY_SAMPLE_LIMIT) report.samples.push(stableKey);
}
