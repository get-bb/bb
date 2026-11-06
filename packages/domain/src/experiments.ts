import { z } from "zod";

export const experimentKeys = [
  "compactExpiredCache",
  "dismissReadNotifications",
  "narrowPluginCss",
  "serverMove",
  "performanceDiagnostics",
  "pluginUpdates",
  "resumeThreadsAfterRestart",
  "skipFocusedThreadNotifications",
  "threadContextCard",
  "threadRowMetadata",
  "timelinePush",
  "updateWhenIdle",
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
  dismissReadNotifications: false,
  narrowPluginCss: false,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: false,
  resumeThreadsAfterRestart: false,
  skipFocusedThreadNotifications: false,
  threadContextCard: false,
  threadRowMetadata: false,
  timelinePush: false,
  updateWhenIdle: false,
};

export const earlyAdopterExperiments: Experiments = {
  compactExpiredCache: true,
  dismissReadNotifications: false,
  narrowPluginCss: false,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: true,
  resumeThreadsAfterRestart: false,
  skipFocusedThreadNotifications: true,
  threadContextCard: false,
  threadRowMetadata: true,
  timelinePush: true,
  updateWhenIdle: true,
};
