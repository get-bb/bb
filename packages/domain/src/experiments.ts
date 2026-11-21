import { z } from "zod";

export const experimentKeys = [
  "agentCpuPriority",
  "compactExpiredCache",
  "keyedPluginCss",
  "serverMove",
  "performanceDiagnostics",
  "pluginUpdates",
  "resumeDaemonSessions",
  "serverRoutes",
  "skipFocusedThreadNotifications",
  "threadContextCard",
  "walCheckpointWorker",
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
  agentCpuPriority: false,
  compactExpiredCache: false,
  keyedPluginCss: false,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: false,
  resumeDaemonSessions: false,
  serverRoutes: false,
  skipFocusedThreadNotifications: false,
  threadContextCard: false,
  walCheckpointWorker: false,
};

export const earlyAdopterExperiments: Experiments = {
  agentCpuPriority: true,
  compactExpiredCache: true,
  keyedPluginCss: true,
  serverMove: false,
  performanceDiagnostics: false,
  pluginUpdates: true,
  resumeDaemonSessions: true,
  serverRoutes: true,
  skipFocusedThreadNotifications: true,
  threadContextCard: true,
  walCheckpointWorker: true,
};
