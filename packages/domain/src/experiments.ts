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
  "newOnboarding",
  "toolsHub",
  /**
   * Native thread rewind: lets a user edit an eligible past message and
   * continue in the same thread from a provider checkpoint. Gates rewind
   * mutations and the UI entry points; disabling it never hides or removes
   * existing branch history or recovery controls.
   */
  "rewind",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

export const defaultExperiments = experimentsSchema.parse(
  Object.fromEntries(experimentKeys.map((key) => [key, false])),
);
