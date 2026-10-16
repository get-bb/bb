import { expect, it } from "vitest";
import {
  appSettingsSchema,
  appSettingsUpdateSchema,
  defaultAppSettings,
} from "./app-settings.js";

it("defaults predictive echo off and accepts an update from an older client without the key", () => {
  expect(defaultAppSettings.terminalPredictiveEcho).toBe(false);
  expect(
    appSettingsSchema.parse({
      ...defaultAppSettings,
      terminalPredictiveEcho: true,
    }).terminalPredictiveEcho,
  ).toBe(true);
  const { terminalPredictiveEcho: omitted, ...olderSettings } =
    defaultAppSettings;
  expect(omitted).toBe(false);
  expect(appSettingsUpdateSchema.parse(olderSettings)).toEqual(olderSettings);
  expect(
    appSettingsUpdateSchema.parse({
      ...olderSettings,
      terminalPredictiveEcho: true,
    }),
  ).toMatchObject({
    terminalPredictiveEcho: true,
  });
});
