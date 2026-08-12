import { z } from "zod";

/**
 * User-opt-in experiments (the Settings → Experiments toggles). Distinct from
 * `FeatureFlags`: flags are operator-set via env at server start, experiments
 * are user-toggled at runtime and persisted server-side so server-owned
 * policy (e.g. skill injection) can honor them.
 *
 * Every experiment defaults to off — opting in is the point.
 */
/**
 * The complete experiment key list. Add an entry here without changing the
 * database schema; experiment values use key/value persistence.
 */
export const experimentKeys = [
  "claudeCodeMockCliTraffic",
  "editMessages",
  "newOnboarding",
  "toolsHub",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

export const defaultExperiments = experimentsSchema.parse(
  Object.fromEntries(experimentKeys.map((key) => [key, false])),
);
