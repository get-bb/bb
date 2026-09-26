import { z } from "zod";

export const experimentKeys = [
  "changelogPreview",
  "legacyJitiPluginLoader",
  "mobileApp",
  "serverMove",
  "sidebarProgressiveDisclosure",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

export const defaultExperiments: Experiments = {
  changelogPreview: false,
  legacyJitiPluginLoader: false,
  mobileApp: false,
  serverMove: false,
  sidebarProgressiveDisclosure: false,
};
