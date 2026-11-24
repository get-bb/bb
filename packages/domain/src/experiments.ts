import { z } from "zod";

export const experimentKeys = [
  "compactExpiredCache",
  "serverMove",
  "performanceDiagnostics",
  "pluginUpdates",
  "serverRoutes",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

export const experimentUpdatesSchema = z.partialRecord(
  experimentKeySchema,
  z.boolean(),
);
export type ExperimentUpdates = z.infer<typeof experimentUpdatesSchema>;

export const defaultExperiments: Experiments = {
  compactExpiredCache: false,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: false,
  serverRoutes: false,
};

export const earlyAdopterExperiments: Experiments = {
  compactExpiredCache: true,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: true,
  serverRoutes: true,
};
