import { z } from "zod";

export const experimentKeys = [
  "applicationLinks",
  "compactExpiredCache",
  "dismissReadNotifications",
  "narrowPluginCss",
  "serverMove",
  "performanceDiagnostics",
  "pluginUpdates",
  "resumeThreadsAfterRestart",
  "sidebarMultiSelect",
  "skipFocusedThreadNotifications",
  "threadContextCard",
  "threadRowMetadata",
  "timelinePush",
  "unreadDividerAtAnswer",
  "websocketCompression",
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
  applicationLinks: false,
  compactExpiredCache: false,
  dismissReadNotifications: false,
  narrowPluginCss: false,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: false,
  resumeThreadsAfterRestart: false,
  sidebarMultiSelect: false,
  skipFocusedThreadNotifications: false,
  threadContextCard: false,
  threadRowMetadata: false,
  timelinePush: false,
  unreadDividerAtAnswer: false,
  websocketCompression: false,
};

export const earlyAdopterExperiments: Experiments = {
  applicationLinks: true,
  compactExpiredCache: true,
  dismissReadNotifications: false,
  narrowPluginCss: false,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: true,
  resumeThreadsAfterRestart: false,
  sidebarMultiSelect: true,
  skipFocusedThreadNotifications: true,
  threadContextCard: false,
  threadRowMetadata: true,
  timelinePush: true,
  unreadDividerAtAnswer: true,
  websocketCompression: true,
};
