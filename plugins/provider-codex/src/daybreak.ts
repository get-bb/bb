import type { PluginProviderModelOptionDeclaration } from "@get-bb/plugin-sdk";

export const DAYBREAK_MODEL_OPTION_ID = "daybreak";
export const DAYBREAK_OFF = "off";
export const DAYBREAK_ON = "on";

export const DAYBREAK_MODEL_OPTION: PluginProviderModelOptionDeclaration = {
  id: DAYBREAK_MODEL_OPTION_ID,
  label: "Daybreak",
  description:
    "More permissive cybersecurity capabilities for approved security work. OpenAI checks access on every request.",
  values: [
    {
      id: DAYBREAK_OFF,
      label: "Off",
      modelUnavailableReason: "Turn on Daybreak to use this model",
    },
    {
      id: DAYBREAK_ON,
      label: "On",
      modelUnavailableReason: "Turn off Daybreak to use this model",
    },
  ],
  defaultValue: DAYBREAK_OFF,
};
