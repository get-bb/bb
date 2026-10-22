import { z } from "zod";

export const experimentKeys = [
  "changelogPreview",
  "compactExpiredCache",
  "serverMove",
  "performanceDiagnostics",
  "timelinePush",
  "terminalRelayProcess",
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
  timelinePush: false,
  terminalRelayProcess: false,
};

export const earlyAdopterExperiments: Experiments = {
  changelogPreview: false,
  compactExpiredCache: true,
  serverMove: false,
  performanceDiagnostics: false,
  timelinePush: true,
  terminalRelayProcess: true,
};
