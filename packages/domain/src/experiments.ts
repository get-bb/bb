import { z } from "zod";

export const experimentKeys = [
  "changelogPreview",
  "compactExpiredCache",
  "serverMove",
  "performanceDiagnostics",
  "sidebarMultiSelect",
  "timelinePush",
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
  changelogPreview: false,
  compactExpiredCache: false,
  serverMove: false,
  performanceDiagnostics: false,
  sidebarMultiSelect: false,
  timelinePush: false,
};

export const earlyAdopterExperiments: Experiments = {
  changelogPreview: false,
  compactExpiredCache: true,
  serverMove: false,
  performanceDiagnostics: false,
  sidebarMultiSelect: true,
  timelinePush: true,
};
