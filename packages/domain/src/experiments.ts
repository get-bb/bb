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
  "changelogPreview",
  "editMessages",
  "mobileApp",
  "providerSessionReaping",
  "timelineWindowing",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

/**
 * The user's persisted experiment choices only. Omission means the user never
 * saved a value for the key — real semantics, not a hidden default: consumers
 * that need a concrete boolean overlay `defaultExperiments`, while
 * viewport-dependent defaults (`timelineWindowing` on compact viewports)
 * resolve client-side where the viewport is known. `setExperiments` persists
 * every key, so after the first explicit save the stored values win
 * everywhere.
 */
export const storedExperimentsSchema = z.partialRecord(
  experimentKeySchema,
  z.boolean(),
);
export type StoredExperiments = z.infer<typeof storedExperimentsSchema>;

/**
 * Values for an installation that has never saved a toggle. `setExperiments`
 * persists every key, so one that has keeps its stored values instead.
 */
export const defaultExperiments: Experiments = {
  changelogPreview: false,
  editMessages: true,
  mobileApp: false,
  providerSessionReaping: false,
  timelineWindowing: false,
};
