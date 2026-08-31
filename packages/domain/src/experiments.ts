import { z } from "zod";

export const experimentKeys = [
  "browserAutomation",
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

export const defaultExperiments: Experiments = {
  browserAutomation: false,
  changelogPreview: false,
  editMessages: true,
  mobileApp: false,
  providerSessionReaping: false,
  timelineWindowing: false,
};
