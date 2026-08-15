import { z } from "zod";

/**
 * User-set experiments (the Settings → Experiments toggles). Distinct from
 * `FeatureFlags`: flags are operator-set via env at server start, experiments
 * are user-toggled at runtime and persisted server-side so server-owned
 * policy (e.g. skill injection) can honor them.
 */
/**
 * The complete experiment key list. Add an entry here without changing the
 * database schema; experiment values use key/value persistence.
 */
export const experimentKeys = [
  "claudeCodeMockCliTraffic",
  "editMessages",
  "newOnboarding",
  "providerSessionReaping",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

/**
 * Values for an installation that has never saved a toggle. `setExperiments`
 * persists every key, so one that has keeps its stored values instead.
 */
export const defaultExperiments: Experiments = {
  claudeCodeMockCliTraffic: false,
  editMessages: true,
  newOnboarding: false,
  providerSessionReaping: false,
};
