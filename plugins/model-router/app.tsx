// bb-plugin-model-router frontend — the "Auto" row in bb's provider/model
// picker.
//
// This is the whole frontend. Choosing the entry is not choosing a provider:
// bb submits the create request with `providerId` omitted and hands
// `pluginInput` to this plugin's `thread.create` gate, which is what actually
// picks the provider and model. There is nothing for a component to render,
// and the picker already hides the model and reasoning rows while an entry is
// selected.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

export default definePluginApp((app) => {
  app.slots.experimental_executionPickerEntry({
    // `default` is load-bearing, not a placeholder. `bb thread spawn
    // --provider auto:model-router` fills in the entry id `default` and sends
    // `{ entry: "default" }`, so registering that exact payload here is what
    // makes a CLI selection and a picker selection arrive at the gate as the
    // same value — the gate never has to know which one it is talking to.
    id: "default",
    label: "Auto",
    description: "Choose the model from the prompt.",
    // Zap is bb's own icon vocabulary; an unknown name would silently fall
    // back to the label's first letter in the picker strip.
    iconName: "Zap",
    pluginInput: { entry: "default" },
  });
});
