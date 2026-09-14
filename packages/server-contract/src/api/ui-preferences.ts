import type {
  UiPreferenceEntries,
  UiPreferenceKey,
  UiPreferenceValue,
} from "@bb/domain";
import { z } from "zod";

export type PathUiPreferenceKey = { param: { key: string } };

export interface UiPreferencesResponse {
  preferences: UiPreferenceEntries;
}

export interface UiPreferenceResponse<
  Key extends UiPreferenceKey = UiPreferenceKey,
> {
  key: Key;
  revision: number;
  value: UiPreferenceValue<Key>;
}

export const updateUiPreferenceRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    value: z.unknown(),
  })
  .strict();
export type UpdateUiPreferenceRequest = z.infer<
  typeof updateUiPreferenceRequestSchema
>;
